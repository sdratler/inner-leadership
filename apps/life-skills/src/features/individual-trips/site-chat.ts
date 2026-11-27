import 'server-only';
import { createHmac,randomUUID,timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { AppError } from '../../lib/errors.ts';
import { failureResponse,readJson,successResponse } from '../../lib/http/json.ts';
import { enforceRateLimit,opaqueRateLimitKey,type RateLimitStore } from '../../lib/security/rate-limit.ts';
import { tripCommandSchema,type TripState,type TripDeparture,type TripReply } from './contract.ts';
import { departureCapacity,tripDemand } from './engine.ts';
import type { IndividualTripStore } from './store.ts';
import type { IndividualTripOwnerChat } from './owner-chat.ts';
import { isTripSiteCaller,TRIP_SITE_ID,TRIP_SITE_COMMAND_TYPES } from './site-chat-contract.ts';

export const tripSiteViewSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('status')}).strict(),
 z.object({type:z.literal('departures'),limit:z.number().int().min(1).max(25).optional()}).strict(),
 z.object({type:z.literal('departure'),departureId:z.uuid(),includeWaitlist:z.boolean().optional(),includeRoster:z.boolean().optional()}).strict(),
 z.object({type:z.literal('demand')}).strict(),
]);
export const signedTripSiteSchema=z.object({siteId:z.literal(TRIP_SITE_ID),callerId:z.string().refine(isTripSiteCaller),nonce:z.uuid(),timestamp:z.number().int().positive(),
 action:z.enum(['read','command']),view:tripSiteViewSchema.optional(),command:z.unknown().optional()}).strict();
export type SignedTripSiteInput=z.infer<typeof signedTripSiteSchema>;
export interface TripSiteConfig {siteId:typeof TRIP_SITE_ID;signingKey:string;}
export function tripSiteConfig(env:Readonly<Record<string,string|undefined>>,trips:IndividualTripStore):TripSiteConfig|null {
 if(env.LS_INDIVIDUAL_TRIPS_SITE_CHAT_ENABLED!=='true'||env.LS_INDIVIDUAL_TRIPS_ENABLED!=='true'||
  env.LS_INDIVIDUAL_TRIPS_WORKSPACE_ID!==trips.config.workspaceId||env.LS_INDIVIDUAL_TRIPS_OWNER_ACCOUNT_ID!==trips.config.ownerAccountId||
  !/^[A-Za-z0-9_-]{43}$/.test(env.LS_INDIVIDUAL_TRIPS_SITE_SIGNING_KEY??''))return null;
 return{siteId:TRIP_SITE_ID,signingKey:env.LS_INDIVIDUAL_TRIPS_SITE_SIGNING_KEY!};
}
/** UTF-16 lexical keys, preserved arrays, JSON primitive encoding. Sign raw
 * strict JSON before command schema defaults; the key is ASCII, not decoded. */
export function canonicalTripSite(value:unknown,depth=0):string{
 if(depth>40)throw new AppError('INVALID_REQUEST');
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(item=>canonicalTripSite(item,depth+1)).join(',')+']';
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonicalTripSite((value as Record<string,unknown>)[key],depth+1)).join(',')+'}';
}
export function tripSiteSignature(secret:string,input:SignedTripSiteInput):string{return createHmac('sha256',secret).update('fishing-trip-site-v1\n'+canonicalTripSite(input)).digest('base64url');}
function plan(state:TripState,item:TripDeparture){
 return{id:item.id,revision:item.revision,title:item.title,kind:item.kind,status:item.status,timeZone:item.timeZone,desiredChildLimit:item.desiredChildLimit,activityChildLimit:item.activityChildLimit,
  sonAttending:item.sonAttending,nonpayingChildCount:item.otherNonpayingChildren.length,transport:{...item.transport},ownerResourceId:item.ownerResourceId,minimumPaid:item.minimumPaid,
  operationalReady:item.operationalReady,pickupHub:{...item.pickupHub},departureAt:item.departureAt,returnAt:item.returnAt,fishingStartAt:item.fishingStartAt,fishingEndAt:item.fishingEndAt,
  mediaGroup:item.mediaGroup,equipment:item.equipment,water:item.water,capacity:departureCapacity(state,item)};
}
export function projectTripSiteRead(state:TripState,view:z.infer<typeof tripSiteViewSchema>={type:'status'}){
 if(view.type==='status')return{view:'status',counts:{departures:state.departures.length,waitlistedChildren:new Set(state.waitlist.filter(row=>row.status==='waiting').map(row=>row.childId)).size,interestedChildren:tripDemand(state).uniqueChildren}};
 if(view.type==='demand'){const demand=tripDemand(state);return{view:'demand',demand:{uniqueChildren:demand.uniqueChildren,byDate:demand.byDate.slice(0,60),truncated:demand.byDate.length>60}};}
 if(view.type==='departures'){const items=[...state.departures].sort((a,b)=>a.departureAt.localeCompare(b.departureAt)||a.id.localeCompare(b.id)),limit=view.limit??20;
  return{view:'departures',departures:items.slice(0,limit).map(item=>plan(state,item)),truncated:items.length>limit};}
 const item=state.departures.find(row=>row.id===view.departureId);if(!item)throw new AppError('NOT_FOUND');
 const result:{view:'departure';departure:ReturnType<typeof plan>;waitlist?:unknown;roster?:unknown}={view:'departure',departure:plan(state,item)};
 if(view.includeWaitlist){
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:item.timeZone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(item.departureAt));
  const date=['year','month','day'].map(type=>parts.find(part=>part.type===type)!.value).join('-');
  const entries=state.waitlist.filter(row=>row.departureId===item.id).map(row=>{const family=state.households.find(h=>h.id===row.householdId),child=family?.children.find(c=>c.id===row.childId);
   return{id:row.id,householdId:row.householdId,childId:row.childId,name:child?.name??'',status:row.status};});
  const candidates=state.households.flatMap(family=>family.children.filter(child=>child.mediaUse===(item.mediaGroup==='yes')&&family.availability.some(request=>request.childId===child.id&&request.status==='interested'&&request.options.some(option=>option.date===date&&option.kind===item.kind)))
   .map(child=>({householdId:family.id,childId:child.id,name:child.name,age:child.age,mediaUse:child.mediaUse})));
  result.waitlist={entries:entries.slice(0,100),candidates:candidates.slice(0,100),truncated:entries.length>100||candidates.length>100};
 }
 if(view.includeRoster){
  const children=state.offers.filter(offer=>offer.departureId===item.id).flatMap(offer=>offer.children.filter(child=>child.status==='confirmed').map(child=>({childId:child.childId,name:child.childName,present:item.attendance.some(row=>row.childId===child.childId&&row.present)})));
  const nonpayingChildren=[...(item.sonAttending?[{childId:'organizer-son',name:'Organizer’s son'}]:[]),...item.otherNonpayingChildren.map(child=>({childId:child.id,name:child.name}))].map(child=>({...child,present:item.attendance.some(row=>row.childId===child.childId&&row.present)}));
  result.roster={children:children.slice(0,60),nonpayingChildren,truncated:children.length>60};
 }
 return result;
}
/** A stateless Site gets only minimized native views. Every command delegates to
 * existing grant signatures/nonces/session guards and the same native store. */
export class IndividualTripSiteChat {
 constructor(private readonly trips:IndividualTripStore,private readonly chat:IndividualTripOwnerChat,private readonly config:TripSiteConfig,private readonly limits:RateLimitStore){}
 async connect(actor:import('../identity/types.ts').Actor,input:unknown){return this.chat.connectSite(actor,input);}
 async revoke(actor:import('../identity/types.ts').Actor,callerId:string){return this.chat.revokeSite(actor,callerId);}
 async connections(actor:import('../identity/types.ts').Actor){return this.chat.siteConnections(actor);}
 async execute(raw:unknown,signature:string|null){
  const parsed=signedTripSiteSchema.safeParse(raw);if(!parsed.success)throw new AppError('INVALID_REQUEST');const input=parsed.data;
  if(!signature||!/^[A-Za-z0-9_-]{43}$/.test(signature)||Math.abs(this.trips.clock.now().getTime()-input.timestamp)>60000||
   !timingSafeEqual(Buffer.from(signature),Buffer.from(tripSiteSignature(this.config.signingKey,input))))throw new AppError('UNAUTHENTICATED');
  if(input.action==='read'&&input.command!==undefined||input.action==='command'&&(input.command===undefined||input.view!==undefined))throw new AppError('INVALID_REQUEST');
  await enforceRateLimit(this.limits,opaqueRateLimitKey('fishing-site:'+input.callerId,this.trips.identity.rateLimitKey),150,900000);
  const command=input.action==='command'?tripCommandSchema.safeParse(input.command):null;
  if(command&&!command.success)throw new AppError('INVALID_REQUEST');
  if(command?.success&&!(TRIP_SITE_COMMAND_TYPES as readonly string[]).includes(command.data.type))throw new AppError('FORBIDDEN');
  const delegated=await this.chat.executeSite({callerId:input.callerId,nonce:input.nonce,timestamp:input.timestamp,action:input.action,...(command?.success?{command:command.data}:{})});
  const reply=delegated.value as TripReply;
  return{connected:true,siteId:TRIP_SITE_ID,revision:delegated.value.revision,grantExpiresAt:delegated.expiresAt,allowedCommands:TRIP_SITE_COMMAND_TYPES,
   ...(input.action==='read'?projectTripSiteRead(delegated.value as TripState,input.view):{result:{revision:reply.revision,status:reply.status,...(reply.id?{id:reply.id}:{}),...(reply.replayed!==undefined?{replayed:reply.replayed}:{})}})};
 }
 async handle(request:Request):Promise<Response>{
  const id=randomUUID();let response:Response;
  try{if(request.method!=='POST'||new URL(request.url).origin!==this.trips.config.origin||new URL(request.url).pathname!=='/api/individual-trips/site-chat'||new URL(request.url).search)throw new AppError('NOT_FOUND');
   response=successResponse(await this.execute(await readJson(request,signedTripSiteSchema),request.headers.get('x-fishing-site-signature')),id);
  }catch(error){response=failureResponse(error,id);if(response.status===401){const body=await response.json();response=Response.json({...body,pairingRequired:true},{status:401});}}
  response.headers.set('Cache-Control','private, no-store');response.headers.set('Referrer-Policy','no-referrer');response.headers.set('X-Content-Type-Options','nosniff');return response;
 }
}
