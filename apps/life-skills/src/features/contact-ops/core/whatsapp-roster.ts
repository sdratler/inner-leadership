export const WHATSAPP_ROSTER_LIMITS=Object.freeze({bytes:65536,members:100,declaredCount:100000});
const roles=new Set(["owner","admin","member","unknown"] as const),reasons=new Set(["provider_page","bounded_snapshot","unknown"] as const);
const phonePattern=/^\+[1-9]\d{7,14}$/,identifierPattern=/^[A-Za-z0-9._:@-]+$/;
export type WhatsAppRosterRole="owner"|"admin"|"member"|"unknown";
export type WhatsAppRosterMatch={state:"matched";personId:string;displayName:string|null}|{state:"unmatched"|"ambiguous";reason:string}|{state:"unavailable";reason:"before_cutover"};
export type NativePhoneMatch={state:"existing"|"unmatched"|"ambiguous"|"reserved";people:{personId:string;displayName:string;version:number|null;eligible:boolean}[]};
export type WhatsAppRoster={schemaVersion:1;channelId:string;group:{id:string;title:string};observedAt:string;receivedAt:string;actorRole:WhatsAppRosterRole;
 completeness:{state:"complete"|"partial";declaredCount:number|null;returnedCount:number;reason:null|"provider_page"|"bounded_snapshot"|"unknown"};
 matchingScope:"native_crm_only"|"provider_only_before_cutover";messagingPermission:"unknown";outboundEligible:false;
 members:{memberId:string;phone:string|null;displayName:string|null;role:WhatsAppRosterRole;match:WhatsAppRosterMatch}[]};
export class WhatsAppRosterContractError extends Error{constructor(readonly code:string){super(code);this.name="WhatsAppRosterContractError";}}
const fail=(code:string):never=>{throw new WhatsAppRosterContractError(code)};
const object=(value:unknown):Record<string,unknown>=>{if(!value||typeof value!=="object"||Array.isArray(value))fail("INVALID_CONTRACT");return value as Record<string,unknown>};
const text=(value:unknown,max:number,nullable=false):string|null=>{if(nullable&&value===null)return null;if(typeof value!=="string")fail("INVALID_CONTRACT");const result=value as string;if(!result.length||result.length>max||result.trim()!==result||/[<>\p{Cc}\p{Cf}]/u.test(result))fail("INVALID_CONTRACT");return result};
const identifier=(value:unknown):string=>{const result=text(value,128) as string;if(!identifierPattern.test(result))fail("INVALID_CONTRACT");return result};
const timestamp=(value:unknown):string=>{if(typeof value!=="string")fail("INVALID_CONTRACT");const result=value as string;if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(result))fail("INVALID_CONTRACT");const time=Date.parse(result);if(!Number.isFinite(time)||new Date(time).toISOString()!==result)fail("INVALID_CONTRACT");return result};
const role=(value:unknown):WhatsAppRosterRole=>{if(!roles.has(value as WhatsAppRosterRole))fail("INVALID_CONTRACT");return value as WhatsAppRosterRole};
const deepFreeze=<T>(value:T):T=>{if(value&&typeof value==="object"){Object.values(value as object).forEach(deepFreeze);Object.freeze(value)}return value};

export type NormalizedWhatsAppRoster=Omit<WhatsAppRoster,"matchingScope"|"messagingPermission"|"outboundEligible"|"members">&{members:{memberId:string;phone:string|null;displayName:string|null;role:WhatsAppRosterRole}[]};
export function normalizeWhatsAppRosterJson(raw:string,expected:{channelId:string;groupId:string},receivedAt:string):NormalizedWhatsAppRoster{
 if(typeof raw!=="string")fail("INVALID_CONTRACT");if(Buffer.byteLength(raw,"utf8")>WHATSAPP_ROSTER_LIMITS.bytes)fail("BODY_TOO_LARGE");
 let source:unknown;try{source=JSON.parse(raw)}catch{fail("INVALID_JSON")}
 const s=object(source),group=object(s.group),complete=object(s.completeness),channelId=identifier(s.channelId),groupId=identifier(group.id);
 if(channelId!==identifier(expected.channelId)||groupId!==identifier(expected.groupId)||s.schemaVersion!==1)fail("BINDING_MISMATCH");
 const observedAt=timestamp(s.observedAt),received=timestamp(receivedAt);if(Date.parse(observedAt)>Date.parse(received)+60000)fail("FUTURE_OBSERVATION");
 if(!Array.isArray(s.members)||s.members.length>WHATSAPP_ROSTER_LIMITS.members)fail("ROSTER_TOO_LARGE");const seen=new Set<string>(),sourceMembers=s.members as unknown[];
 const members=sourceMembers.map((value:unknown)=>{const member=object(value),memberId=identifier(member.memberId);if(seen.has(memberId))fail("DUPLICATE_MEMBER");seen.add(memberId);
  const phone=member.phone;if(phone!==null&&(typeof phone!=="string"||!phonePattern.test(phone)))fail("INVALID_PHONE");
  return {memberId,phone:phone as string|null,displayName:text(member.displayName,120,true),role:role(member.role)}});
 const declared=complete.declaredCount;if(declared!==null&&(!Number.isSafeInteger(declared)||Number(declared)<0||Number(declared)>WHATSAPP_ROSTER_LIMITS.declaredCount))fail("INVALID_CONTRACT");
 const declaredCount=declared as number|null;if(declaredCount!==null&&declaredCount<members.length)fail("INCONSISTENT_COMPLETENESS");
 const rawState=complete.state;if(rawState!=="complete"&&rawState!=="partial")fail("INVALID_CONTRACT");const state=rawState as "complete"|"partial";
 if(state==="complete"&&(declaredCount!==members.length||complete.reason!==null))fail("INCONSISTENT_COMPLETENESS");
 if(state==="partial"&&!reasons.has(complete.reason as "provider_page"|"bounded_snapshot"|"unknown"))fail("INCONSISTENT_COMPLETENESS");
 return deepFreeze({schemaVersion:1,channelId,group:{id:groupId,title:text(group.title,120) as string},observedAt,receivedAt:received,actorRole:role(s.actorRole),
  completeness:{state,declaredCount,returnedCount:members.length,reason:complete.reason as null|"provider_page"|"bounded_snapshot"|"unknown"},members});
}
function projectMatch(match:NativePhoneMatch):WhatsAppRosterMatch{
 if(!match||!["existing","unmatched","ambiguous","reserved"].includes(match.state)||!Array.isArray(match.people)||match.people.length>WHATSAPP_ROSTER_LIMITS.members)fail("INVALID_MATCH_RESULT");
 if(match.state==="reserved")return {state:"ambiguous",reason:"reserved_identity"};
 if(match.state==="unmatched"){if(match.people.length)fail("INVALID_MATCH_RESULT");return {state:"unmatched",reason:"no_native_match"}}
 if(match.state==="ambiguous"){if(match.people.length<2)fail("INVALID_MATCH_RESULT");return {state:"ambiguous",reason:"multiple_native_matches"}}
 if(match.people.length!==1)fail("INVALID_MATCH_RESULT");const person=match.people[0]!;
 if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(person.personId)||typeof person.displayName!=="string"||person.displayName.length>120)fail("INVALID_MATCH_RESULT");
 let displayName:string|null=null;try{displayName=text(person.displayName,120) as string}catch{displayName=null}
 return {state:"matched",personId:person.personId,displayName};
}
export function projectWhatsAppRoster(roster:NormalizedWhatsAppRoster,matches:Map<string,NativePhoneMatch>):WhatsAppRoster{
 const phones=[...new Set(roster.members.map(member=>member.phone).filter((phone):phone is string=>Boolean(phone)))];
 if(!(matches instanceof Map)||matches.size!==phones.length||phones.some(phone=>!matches.has(phone)))fail("INCOMPLETE_MATCH_RESULT");
 const counts=new Map<string,number>();for(const member of roster.members)if(member.phone)counts.set(member.phone,(counts.get(member.phone)??0)+1);
 const projected=new Map(phones.map(phone=>[phone,projectMatch(matches.get(phone)!)]));
 return deepFreeze({...roster,matchingScope:"native_crm_only",messagingPermission:"unknown",outboundEligible:false,
  members:roster.members.map(member=>({...member,match:member.phone===null?{state:"unmatched",reason:"phone_unavailable"}:
   (counts.get(member.phone)??0)>1?{state:"ambiguous",reason:"duplicate_roster_phone"}:projected.get(member.phone)!}))});
}
/** Before the separately gated native cutover, the fixed provider roster may
 * be shown read-only, but no unqueried directory can be represented as a
 * negative People match. */
export function projectProviderOnlyWhatsAppRoster(roster:NormalizedWhatsAppRoster):WhatsAppRoster{
 return deepFreeze({...roster,matchingScope:"provider_only_before_cutover",messagingPermission:"unknown",outboundEligible:false,
  members:roster.members.map(member=>({...member,match:{state:"unavailable",reason:"before_cutover"} as const}))});
}
