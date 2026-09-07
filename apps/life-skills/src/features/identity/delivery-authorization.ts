import { AppError } from "../../lib/errors.ts";
import type { IdentityStore } from "./store.ts";
import { one } from "./store.ts";
import { accountById } from "./data.ts";
import { audienceAccess } from "../cases/policy.ts";
import { loadAudience,loadCase,loadGuardians } from "../cases/data.ts";
import { defaultPreference,inQuietHours } from "./preferences.ts";
import type { DeliveryAuthorization,NotificationEffectReference } from "./interfaces.ts";
import type { IdentityClock,NotificationPreference } from "./types.ts";
export interface SourceValidityReader {isCurrentAndPending(effect:NotificationEffectReference):Promise<boolean>;}
/** LS-090 must supply a real source-version/completion reader. Default deliberately denies. */
export class IdentityDeliveryAuthorization implements DeliveryAuthorization {
 constructor(private readonly store:IdentityStore,private readonly clock:IdentityClock,private readonly source:SourceValidityReader={async isCurrentAndPending(){return false;}}) {}
 async mayDeliver(effect:NotificationEffectReference):Promise<boolean> {
  if(!await this.source.isCurrentAndPending(effect)) return false;
  try{return await this.store.transaction(async tx=>{
   const account=await accountById(tx,effect.workspaceId,effect.recipientAccountId),audience=await loadAudience(tx,effect.workspaceId,effect.caseId,effect.audienceId);
   if(!account || !audience) return false;
   audienceAccess(account,await loadCase(tx,effect.workspaceId,effect.caseId),await loadGuardians(tx,effect.workspaceId,effect.caseId),audience);
   const row=await one<NotificationPreference>(tx,`SELECT event_type AS "eventType",channel,enabled,locale,timezone,quiet_start AS "quietStart",quiet_end AS "quietEnd"
    FROM ls_identity.preferences WHERE workspace_id=$1 AND account_id=$2 AND event_type=$3 AND channel=$4`,[effect.workspaceId,effect.recipientAccountId,effect.neutralMessageKey,effect.channel]);
   const preference=row ?? defaultPreference(effect.neutralMessageKey,effect.channel,account.locale);
   if(!preference.enabled || inQuietHours(preference,this.clock.now())) return false;
   if(effect.channel==='email') return Boolean(account.emailVerifiedAt);
   if(effect.channel==='whatsapp') return Boolean(account.phoneVerifiedAt);
   if(effect.channel==='push') return Boolean(await one(tx,"SELECT id FROM ls_identity.push_subscriptions WHERE workspace_id=$1 AND account_id=$2 AND revoked_at IS NULL AND payload_ciphertext IS NOT NULL LIMIT 1",[effect.workspaceId,effect.recipientAccountId]));
   return effect.channel==='in_app';
  });}catch(error){if(error instanceof AppError && error.code==='NOT_FOUND') return false;throw new AppError("UNAVAILABLE");}
 }
}
