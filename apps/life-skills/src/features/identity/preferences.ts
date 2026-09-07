import { AppError } from "../../lib/errors.ts";
import { freshActor,lockWorkspace } from "./data.ts";
import type { IdentityStore } from "./store.ts";
import type { IdentityConfig } from "./config.ts";
import { seal,unseal } from "./crypto.ts";
import type { Actor,AccountId,NotificationPreference,NotificationEvent,NotificationChannel,Locale,IdentityClock } from "./types.ts";
import { notificationEvents,notificationChannels } from "./types.ts";
import { requireOwnPreference } from "../cases/policy.ts";
import { recordAction } from "./history.ts";
export function defaultPreference(eventType:NotificationEvent,channel:NotificationChannel,locale:Locale):NotificationPreference {
 return {eventType,channel,enabled:channel==='in_app',locale,timezone:'Asia/Jerusalem',quietStart:null,quietEnd:null};
}
export function validatePreference(p:NotificationPreference):void {
 if(!notificationEvents.includes(p.eventType) || !notificationChannels.includes(p.channel) || typeof p.enabled!=='boolean' || !['he','en'].includes(p.locale)) throw new AppError("INVALID_REQUEST");
 if(p.timezone.length>80) throw new AppError("INVALID_REQUEST");
 try {new Intl.DateTimeFormat('en',{timeZone:p.timezone}).format(new Date(0));} catch{throw new AppError("INVALID_REQUEST");}
 if((p.quietStart===null)!==(p.quietEnd===null)) throw new AppError("INVALID_REQUEST");
 if(p.quietStart!==null && (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(p.quietStart) || !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(p.quietEnd!))) throw new AppError("INVALID_REQUEST");
}
export function inQuietHours(p:NotificationPreference,now:Date):boolean {
 validatePreference(p);
 if(p.channel==='in_app' || p.quietStart===null || p.quietStart===p.quietEnd) return false;
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:p.timezone,hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now);
 const minute=`${parts.find(x=>x.type==='hour')?.value}:${parts.find(x=>x.type==='minute')?.value}`;
 return p.quietStart < p.quietEnd! ? minute>=p.quietStart && minute<p.quietEnd! : minute>=p.quietStart || minute<p.quietEnd!;
}
export class IdentityPreferenceService {
 constructor(private readonly store:IdentityStore,private readonly config:IdentityConfig,private readonly clock:IdentityClock) {}
 async list(actor:Actor,target:AccountId):Promise<NotificationPreference[]> {
  return this.store.transaction(async tx=>{
   const current=await freshActor(tx,actor,this.clock.now());requireOwnPreference(current,target);
   const rows=await tx.query<NotificationPreference>(`SELECT event_type AS "eventType",channel,enabled,locale,timezone,quiet_start AS "quietStart",quiet_end AS "quietEnd"
    FROM ls_identity.preferences WHERE workspace_id=$1 AND account_id=$2`,[actor.workspaceId,target]);
   return notificationEvents.flatMap(event=>notificationChannels.map(channel=>rows.find(p=>p.eventType===event && p.channel===channel) ?? defaultPreference(event,channel,current.locale)));
  });
 }
 async replace(actor:Actor,target:AccountId,preferences:readonly NotificationPreference[],requestId:string):Promise<void> {
  if(preferences.length<1 || preferences.length>16 || new Set(preferences.map(x=>x.eventType+':'+x.channel)).size!==preferences.length) throw new AppError("INVALID_REQUEST");
  for(const p of preferences) validatePreference(p);
  const context={requestId,now:this.clock.now()};
  await this.store.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);const current=await freshActor(tx,actor,context.now);requireOwnPreference(current,target);
   for(const p of preferences) await tx.query(`INSERT INTO ls_identity.preferences
    (workspace_id,account_id,event_type,channel,enabled,locale,timezone,quiet_start,quiet_end,updated_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(workspace_id,account_id,event_type,channel)
    DO UPDATE SET enabled=EXCLUDED.enabled,locale=EXCLUDED.locale,timezone=EXCLUDED.timezone,
    quiet_start=EXCLUDED.quiet_start,quiet_end=EXCLUDED.quiet_end,updated_at=EXCLUDED.updated_at`,[actor.workspaceId,target,p.eventType,p.channel,p.enabled,p.locale,p.timezone,p.quietStart,p.quietEnd,context.now]);
   await recordAction(tx,context,actor.workspaceId,actor.id,'preferences_changed');
  });
 }
 async contacts(actor:Actor):Promise<{email:string;emailVerified:boolean;phone:string|null;phoneVerified:boolean}> {
  return this.store.transaction(async tx=>{
   const current=await freshActor(tx,actor,this.clock.now());
   return {email:unseal(current.emailCiphertext,`email:${actor.workspaceId}:${actor.id}`,this.config.keyring),emailVerified:Boolean(current.emailVerifiedAt),
    phone:current.phoneCiphertext ? unseal(current.phoneCiphertext,`phone:${actor.workspaceId}:${actor.id}`,this.config.keyring):null,phoneVerified:Boolean(current.phoneVerifiedAt)};
  });
 }
 async setUnverifiedPhone(actor:Actor,phone:string|null,verifiedPasswordHash:string,requestId:string):Promise<void> {
  if(phone!==null && !/^\+[1-9][0-9]{7,14}$/.test(phone)) throw new AppError("INVALID_REQUEST");
  const context={requestId,now:this.clock.now()};
  await this.store.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);const current=await freshActor(tx,actor,context.now);
   if(current.passwordHash!==verifiedPasswordHash) throw new AppError("UNAUTHENTICATED");
   await tx.query("UPDATE ls_identity.accounts SET phone_ciphertext=$3,phone_verified_at=NULL,updated_at=$4 WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,actor.id,phone===null?null:seal(phone,`phone:${actor.workspaceId}:${actor.id}`,this.config.keyring),context.now]);
   await recordAction(tx,context,actor.workspaceId,actor.id,'contact_change_queued');
  });
 }
}
