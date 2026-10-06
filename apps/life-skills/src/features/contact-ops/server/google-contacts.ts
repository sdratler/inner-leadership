import "server-only";
import {z} from "zod";
import {normalizePhone,normalizeEmail} from "../core/contact-resolution.ts";

export const GOOGLE_LEAD_GROUP="Life Skills Lead";
const CONTACTS_SCOPE="https://www.googleapis.com/auth/contacts",EMAIL_SCOPE="https://www.googleapis.com/auth/userinfo.email";
const personName=z.string().regex(/^people\/[A-Za-z0-9_-]{1,120}$/),groupName=z.string().regex(/^contactGroups\/[A-Za-z0-9_-]{1,120}$/);
const personSchema=z.object({resourceName:personName,etag:z.string().min(1).max(1000),
 names:z.array(z.object({displayName:z.string().max(1000).optional()})).max(10).default([]),
 phoneNumbers:z.array(z.object({value:z.string().max(100),canonicalForm:z.string().max(100).optional()})).max(30).default([]),
 memberships:z.array(z.object({contactGroupMembership:z.object({contactGroupResourceName:groupName}).optional()})).max(500).default([])});
const groupSchema=z.object({resourceName:groupName,etag:z.string().min(1).max(1000),name:z.string().max(1000),
 groupType:z.string(),memberCount:z.number().int().min(0).optional(),memberResourceNames:z.array(personName).max(200).default([])});
export type GoogleContact=z.infer<typeof personSchema>;
export type GoogleContactsConfig={clientId:string;clientSecret:string;refreshToken:string;ownerEmail:string;ownerSubject:string};
export type GoogleContactsFailure="unavailable"|"permission"|"account"|"bounded_limit"|"conflict"|"readback_unverified";
export class GoogleContactsError extends Error{constructor(readonly code:GoogleContactsFailure){super("GOOGLE_CONTACTS_"+code.toUpperCase());}}
/** Contacts has its own explicit owner grant. Never fall back to the Office
 * Gmail/Drive refresh token or infer Contacts authority from a client ID. */
export function googleContactsConfig(env:Record<string,string|undefined>):GoogleContactsConfig|null{
 if(env.LS_CONTACTS_GOOGLE_ENABLED!=="true")return null;
 const values=[env.LS_AUTH_GOOGLE_CLIENT_ID,env.LS_AUTH_GOOGLE_CLIENT_SECRET,env.LS_CONTACTS_GOOGLE_REFRESH_TOKEN];
 if(!values.every(v=>typeof v==="string"&&/^[^\s\r\n]{1,4096}$/.test(v))||
  !env.LS_CONTACTS_GOOGLE_OWNER_EMAIL||normalizeEmail(env.LS_CONTACTS_GOOGLE_OWNER_EMAIL)!==env.LS_CONTACTS_GOOGLE_OWNER_EMAIL||
  !/^[0-9]{10,40}$/.test(env.LS_CONTACTS_GOOGLE_OWNER_SUBJECT??""))throw new GoogleContactsError("unavailable");
 return {clientId:values[0]!,clientSecret:values[1]!,refreshToken:values[2]!,
  ownerEmail:env.LS_CONTACTS_GOOGLE_OWNER_EMAIL,ownerSubject:env.LS_CONTACTS_GOOGLE_OWNER_SUBJECT!};
}
const FIELDS="names,phoneNumbers,memberships";
const hasPhone=(person:GoogleContact,phone:string)=>person.phoneNumbers.some(n=>normalizePhone(n.canonicalForm??n.value)===phone);
const member=(person:GoogleContact,group:string)=>person.memberships.some(m=>m.contactGroupMembership?.contactGroupResourceName===group);
const display=(person:GoogleContact)=>person.names.map(n=>n.displayName??"");
/** Bounded People API transport. No schedule, CRM import, identity grant,
 * clinical fields, automatic create retry, account sign-in or provider send.
 * The caller must hold the existing durable native-authority projection gate. */
export class GoogleContactsClient{
 private token:string|null=null;private validUntil=0;
 private writes:Promise<void>=Promise.resolve();
 constructor(private readonly config:GoogleContactsConfig,private readonly fetcher:typeof fetch=fetch,
  private readonly now:()=>number=Date.now){}
 private async json(url:string,init:RequestInit={},max=524288):Promise<unknown>{
  let response:Response;try{response=await this.fetcher(url,{...init,redirect:"error",cache:"no-store",signal:AbortSignal.timeout(8000)});}
  catch{throw new GoogleContactsError("unavailable");}
  if(!response.ok){await response.body?.cancel().catch(()=>{});throw new GoogleContactsError(response.status===401||response.status===403?"permission":"unavailable");}
  if(!response.body||response.headers.get("content-type")?.split(";")[0]?.trim()!=="application/json")throw new GoogleContactsError("unavailable");
  const reader=response.body.getReader(),parts:Uint8Array[]=[];let size=0;
  try{while(true){const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>max){await reader.cancel();throw new GoogleContactsError("bounded_limit");}parts.push(part.value);}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.byteLength;}return JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));
  }catch(e){if(e instanceof GoogleContactsError)throw e;throw new GoogleContactsError("unavailable");}finally{reader.releaseLock();}
 }
 private parsed<T>(schema:z.ZodType<T>,value:unknown):T{const p=schema.safeParse(value);if(!p.success)throw new GoogleContactsError("unavailable");return p.data;}
 private async access():Promise<string>{
  if(this.token&&this.now()<this.validUntil)return this.token;
  const grant=this.parsed(z.object({access_token:z.string().regex(/^[^\s\r\n]{1,4096}$/),scope:z.string().max(10000),expires_in:z.number().int().min(30).max(86400)}),
   await this.json("https://oauth2.googleapis.com/token",{method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({client_id:this.config.clientId,client_secret:this.config.clientSecret,refresh_token:this.config.refreshToken,grant_type:"refresh_token"}).toString()},16384));
  const scopes=new Set(grant.scope.split(" "));if(!scopes.has(CONTACTS_SCOPE)||!scopes.has(EMAIL_SCOPE))throw new GoogleContactsError("permission");
  const owner=this.parsed(z.object({id:z.string(),email:z.string(),verified_email:z.literal(true)}),
   await this.json("https://www.googleapis.com/oauth2/v2/userinfo",{headers:{Authorization:"Bearer "+grant.access_token}},16384));
  if(owner.id!==this.config.ownerSubject||owner.email!==this.config.ownerEmail)throw new GoogleContactsError("account");
  this.token=grant.access_token;this.validUntil=this.now()+Math.min(grant.expires_in-15,300)*1000;return this.token;
 }
 private async call(path:string,init:RequestInit={}):Promise<unknown>{
  const token=await this.access();return this.json("https://people.googleapis.com/v1/"+path,
   {...init,headers:{Authorization:"Bearer "+token,"content-type":"application/json",...init.headers}});
 }
 async readPerson(resource:string):Promise<GoogleContact>{
  if(!personName.safeParse(resource).success||resource==="people/me")throw new GoogleContactsError("conflict");
  const person=this.parsed(personSchema,await this.call(resource+"?personFields="+FIELDS+"&sources=READ_SOURCE_TYPE_CONTACT"));
  if(person.resourceName!==resource)throw new GoogleContactsError("conflict");return person;
 }
 private async readGroup(resource:string,maxMembers=0){
  if(!groupName.safeParse(resource).success)throw new GoogleContactsError("conflict");
  const group=this.parsed(groupSchema,await this.call(resource+"?maxMembers="+maxMembers+"&groupFields=name,groupType,memberCount"));
  if(group.resourceName!==resource||group.name!==GOOGLE_LEAD_GROUP||group.groupType!=="USER_CONTACT_GROUP")throw new GoogleContactsError("conflict");return group;
 }
 /** Exact group only. More than 200 members or a changed snapshot is not a
  * partial import. No unrelated address-book contact becomes a CRM lead. */
 async readLeadGroup(resource:string):Promise<{etag:string;contacts:GoogleContact[]}>{
  const before=await this.readGroup(resource,200);if(before.memberCount===undefined||before.memberCount>200||
   before.memberCount!==before.memberResourceNames.length||new Set(before.memberResourceNames).size!==before.memberResourceNames.length)throw new GoogleContactsError("bounded_limit");
  let contacts:GoogleContact[]=[];
  if(before.memberResourceNames.length){const query=new URLSearchParams({personFields:FIELDS,sources:"READ_SOURCE_TYPE_CONTACT"});for(const r of before.memberResourceNames)query.append("resourceNames",r);
   const batch=this.parsed(z.object({responses:z.array(z.object({requestedResourceName:personName,person:personSchema,status:z.object({code:z.literal(0).optional()}).optional()})).max(200)}),await this.call("people:batchGet?"+query));
   if(batch.responses.length!==before.memberResourceNames.length||new Set(batch.responses.map(r=>r.requestedResourceName)).size!==batch.responses.length)throw new GoogleContactsError("readback_unverified");
   for(const r of batch.responses)if(!before.memberResourceNames.includes(r.requestedResourceName)||r.person.resourceName!==r.requestedResourceName||!member(r.person,resource))throw new GoogleContactsError("readback_unverified");contacts=batch.responses.map(r=>r.person);
  }
  const after=await this.readGroup(resource,200);if(after.etag!==before.etag||after.memberCount!==before.memberCount||JSON.stringify([...after.memberResourceNames].sort())!==JSON.stringify([...before.memberResourceNames].sort()))throw new GoogleContactsError("conflict");
  return {etag:after.etag,contacts};
 }
 /** A search miss is NOT verified absence: Google's prefix/cache search is
  * bounded to 30 results. Never automatically create on a search miss. */
 async findByPhone(phone:string):Promise<{state:"existing"|"ambiguous"|"absence_unverified";contacts:GoogleContact[]}>{
  if(normalizePhone(phone)!==phone)throw new GoogleContactsError("conflict");
  const query=new URLSearchParams({query:"",pageSize:"30",readMask:FIELDS,sources:"READ_SOURCE_TYPE_CONTACT"});await this.call("people:searchContacts?"+query);
  query.set("query",phone);const response=this.parsed(z.object({results:z.array(z.object({person:personSchema})).max(30).default([])}),await this.call("people:searchContacts?"+query));
  const contacts=response.results.map(r=>r.person).filter(p=>hasPhone(p,phone));
  if(new Set(contacts.map(c=>c.resourceName)).size!==contacts.length||response.results.length===30)throw new GoogleContactsError("bounded_limit");
  return {state:contacts.length===1?"existing":contacts.length>1?"ambiguous":"absence_unverified",contacts};
 }
 /** Add only the exact lead label. Read before/after; preserve name and every
  * other label. Idempotent membership write, not a new contact/message. */
 async labelExisting(groupResource:string,personResource:string,phone:string):Promise<{state:"applied";resourceName:string;displayNameConflict:false;replayed:boolean}>{
  const previous=this.writes;let release!:()=>void;this.writes=new Promise<void>(resolve=>{release=resolve;});await previous;
  try{return await this.addLabel(groupResource,personResource,phone);}finally{release();}
 }
 private async addLabel(groupResource:string,personResource:string,phone:string):Promise<{state:"applied";resourceName:string;displayNameConflict:false;replayed:boolean}>{
  if(normalizePhone(phone)!==phone)throw new GoogleContactsError("conflict");await this.readGroup(groupResource);
  const before=await this.readPerson(personResource);if(!hasPhone(before,phone))throw new GoogleContactsError("conflict");const replayed=member(before,groupResource);
  if(!replayed){const response=this.parsed(z.object({notFoundResourceNames:z.array(personName).default([]),canNotRemoveLastContactGroupResourceNames:z.array(personName).default([])}),
    await this.call(groupResource+"/members:modify",{method:"POST",body:JSON.stringify({resourceNamesToAdd:[personResource]})}));
   if(response.notFoundResourceNames.length||response.canNotRemoveLastContactGroupResourceNames.length)throw new GoogleContactsError("readback_unverified");}
  const after=await this.readPerson(personResource);if(!hasPhone(after,phone)||!member(after,groupResource)||JSON.stringify(display(after))!==JSON.stringify(display(before))||
   before.memberships.some(m=>m.contactGroupMembership&&!member(after,m.contactGroupMembership.contactGroupResourceName)))throw new GoogleContactsError("readback_unverified");
  await this.readGroup(groupResource);return {state:"applied",resourceName:personResource,displayNameConflict:false,replayed};
 }
}
