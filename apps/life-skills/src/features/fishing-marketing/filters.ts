import type {FishingMarketingSnapshot} from "./contract.ts";
export type ProgramFilter="all"|"fishing"|"bna";
export type ChannelFilter="all"|"groups"|"page"|"other";
export type StateFilter="all"|"draft"|"scheduled"|"pending"|"published"|"problem";
export function marketingFilters(input:{program?:unknown;channel?:unknown;state?:unknown}){
 const allowed=<T extends string>(value:unknown,choices:readonly T[],fallback:T):T=>typeof value==="string"&&choices.includes(value as T)?value as T:fallback;
 return {program:allowed(input.program,["all","fishing","bna"] as const,"all"),channel:allowed(input.channel,["all","groups","page","other"] as const,"all"),state:allowed(input.state,["all","draft","scheduled","pending","published","problem"] as const,"all")};
}
export function fishingRecordState(record:{state:string;publicationEvidence:string}):Exclude<StateFilter,"all">{
 if(record.publicationEvidence==="browser_readback"||record.publicationEvidence==="operator_recorded_readback")return "published";
 if(record.state==="ready"||record.state==="draft")return "draft";
 if(["submitted","moderator_pending","pending_admin_approval"].includes(record.state))return "pending";
 if(record.state==="scheduled")return "scheduled";
 return "problem";
}
export function filterFishingRecords(snapshot:FishingMarketingSnapshot,state:StateFilter){
 return {items:snapshot.items.filter(item=>state==="all"||fishingRecordState(item)===state),history:snapshot.history.filter(item=>state==="all"||fishingRecordState(item)===state)};
}
