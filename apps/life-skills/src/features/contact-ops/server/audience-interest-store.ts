import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";
import {lockWorkspace} from "../../identity/data.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import {normalizePhone} from "../core/contact-resolution.ts";
import {audienceCommandSchema,audienceInterestStateSchema,audienceObservationKindSchema,type AudienceCommand,type AudienceRow} from "../core/audience-interest.ts";
import {privateDigest} from "./digests.ts";
import {ContactCutoverStore} from "./cutover-store.ts";
import {NativeContactDirectory} from "./native-directory.ts";
import {crmProfileAad,crmProfileSchema} from "./native-store.ts";
import {contactSuppressed} from "../../prospects/native-edit.ts";

const profileSchema=z.object({displayName:z.string().min(1).max(120),phone:z.string().min(1).max(40)}).strict();
const interestSchema=z.object({state:audienceInterestStateSchema,observedAt:z.string().datetime({offset:true}),sourceRef:z.string().min(1).max(500)}).strict();
const observationSchema=z.object({kind:audienceObservationKindSchema,evidence:z.string().min(1).max(1000),observedAt:z.string().datetime({offset:true}),sourceRef:z.string().min(1).max(500)}).strict();
const aadProfile=(workspace:string,person:string)=>`ls_contact_ops/audience-profile/v1/${workspace}/${person}`;
const aadInterest=(workspace:string,person:string)=>`ls_contact_ops/audience-interest/v1/${workspace}/${person}/bna_content`;
const aadObservation=(workspace:string,id:string)=>`ls_contact_ops/audience-observation/v1/${workspace}/${id}`;
type StoredProfile={personId:string;profileCiphertext:string;personCiphertext:string;markerBatch:string|null;accountDemoBatch:string|null;crmCiphertext:string|null;crmMode:string|null};
type StoredInterest={personId:string;payloadCiphertext:string|null;version:number|null;observedAt:Date|null};

function decode<T>(schema:z.ZodType<T>,ciphertext:string,aad:string,keyring:Keyring):T{
 try{return schema.parse(JSON.parse(unseal(ciphertext,aad,keyring)));}catch{throw new AppError("UNAVAILABLE");}
}
function encodeProfile(workspace:string,person:string,value:z.infer<typeof profileSchema>,keyring:Keyring){return seal(JSON.stringify(value),aadProfile(workspace,person),keyring);}

/** Native, private administrative content-interest store. It has no provider,
 * Sheet, account, case, enrollment or message port. The cutover authority lock
 * serializes identity matching and interest writes with the existing CRM.
 */
export class AudienceInterestStore{
 private readonly authority:ContactCutoverStore;
 private readonly directory:NativeContactDirectory;
 constructor(private readonly db:IdentityStore,private readonly keyring:Keyring,private readonly integrityKey:string,
  private readonly clock:IdentityClock=systemClock){this.authority=new ContactCutoverStore(db,keyring,integrityKey,clock);this.directory=new NativeContactDirectory(db,keyring,clock);}

 async list(actor:Actor,input:{expectedEpoch:number;search:string;state:"all"|"expressed"|"withdrawn";page:number;pageSize:number;personId?:string}){
  if(!Number.isSafeInteger(input.expectedEpoch)||input.expectedEpoch<0||input.search.length>200||!(["all","expressed","withdrawn"] as const).includes(input.state)||
   !Number.isSafeInteger(input.page)||input.page<1||!Number.isSafeInteger(input.pageSize)||input.pageSize<1||input.pageSize>100||
   (input.personId!==undefined&&!z.string().uuid().safeParse(input.personId).success))throw new AppError("INVALID_REQUEST");
  return this.authority.withDestination(actor,{destination:"native",intent:"read",expectedEpoch:input.expectedEpoch},async tx=>{
   const rows=await this.readRows(tx,actor);const text=input.search.trim().toLocaleLowerCase();
   const filtered=input.personId?rows.filter(row=>row.personId===input.personId):rows.filter(row=>(input.state==="all"||row.state===input.state)&&(!text||[row.displayName,row.phone,row.sourceRef??""].some(value=>value.toLocaleLowerCase().includes(text))));
   const pages=Math.max(1,Math.ceil(filtered.length/input.pageSize)),page=Math.min(input.page,pages);
   return {items:filtered.slice((page-1)*input.pageSize,page*input.pageSize),total:filtered.length,page,pageSize:input.pageSize,pages,authorityEpoch:input.expectedEpoch};
  });
 }

 async record(actor:Actor,raw:AudienceCommand){
  const parsed=audienceCommandSchema.safeParse(raw);if(!parsed.success)throw new AppError("INVALID_REQUEST");const command=parsed.data;
  const normalized=command.phone?normalizePhone(command.phone):null;if(command.phone&&!normalized)throw new AppError("INVALID_REQUEST");
  const digestInput=JSON.parse(JSON.stringify({command:{...command,...(normalized?{phone:normalized}:{})},actor:actor.id,workspace:actor.workspaceId})) as object;
  const digest=privateDigest(digestInput,this.integrityKey);
  return this.authority.withDestination(actor,{destination:"native",intent:"write",expectedEpoch:command.expectedEpoch},async tx=>{
   await lockWorkspace(tx,actor.workspaceId);
   const prior=await tx.query<{digest:string;actorId:string;personId:string;version:number}>(`SELECT payload_digest AS digest,actor_account_id AS "actorId",person_id AS "personId",result_version AS version
    FROM ls_contact_ops.audience_operation_receipts WHERE workspace_id=$1 AND operation_id=$2`,[actor.workspaceId,command.operationId]);
   if(prior[0]){if(prior[0].digest!==digest||prior[0].actorId!==actor.id)throw new AppError("CONFLICT");return {personId:prior[0].personId,version:prior[0].version,replayed:true,authorityEpoch:command.expectedEpoch};}
   const personId=await this.resolvePerson(tx,actor,command,normalized);
   const current=await tx.query<{version:number}>(`SELECT version FROM ls_contact_ops.audience_interests WHERE workspace_id=$1 AND person_id=$2 AND topic='bna_content' FOR UPDATE`,[actor.workspaceId,personId]);
   const currentVersion=current[0]?.version??0;if(command.expectedVersion!==(currentVersion===0?null:currentVersion))throw new AppError("CONFLICT");
   let version=currentVersion;
   if(command.action==="record_interest"){
    const payload=seal(JSON.stringify({state:command.state,observedAt:command.observedAt,sourceRef:command.sourceRef}),aadInterest(actor.workspaceId,personId),this.keyring);
    if(currentVersion===0){const inserted=await tx.query<{version:number}>(`INSERT INTO ls_contact_ops.audience_interests(workspace_id,person_id,topic,payload_ciphertext,actor_account_id,observed_at)
      VALUES($1,$2,'bna_content',$3,$4,$5) RETURNING version`,[actor.workspaceId,personId,payload,actor.id,command.observedAt]);version=inserted[0]!.version;}
    else{const updated=await tx.query<{version:number}>(`UPDATE ls_contact_ops.audience_interests SET payload_ciphertext=$3,version=version+1,actor_account_id=$4,observed_at=$5,updated_at=clock_timestamp()
      WHERE workspace_id=$1 AND person_id=$2 AND topic='bna_content' AND version=$6 RETURNING version`,[actor.workspaceId,personId,payload,actor.id,command.observedAt,currentVersion]);
     if(updated.length!==1)throw new AppError("CONFLICT");version=updated[0]!.version;}
   }
   if(command.observation){
    const observationId=randomUUID(),sourceDigest=privateDigest({personId,topic:command.topic,sourceRef:command.sourceRef,observation:command.observation},this.integrityKey);
    const payload=seal(JSON.stringify({...command.observation,observedAt:command.observedAt,sourceRef:command.sourceRef}),aadObservation(actor.workspaceId,observationId),this.keyring);
    await tx.query(`INSERT INTO ls_contact_ops.audience_observations(workspace_id,observation_id,person_id,topic,source_digest,payload_ciphertext,actor_account_id,observed_at)
     VALUES($1,$2,$3,'bna_content',$4,$5,$6,$7) ON CONFLICT(workspace_id,person_id,topic,source_digest) DO NOTHING`,[actor.workspaceId,observationId,personId,sourceDigest,payload,actor.id,command.observedAt]);
   }
   await tx.query(`INSERT INTO ls_contact_ops.audience_operation_receipts(workspace_id,operation_id,person_id,actor_account_id,payload_digest,result_version)
    VALUES($1,$2,$3,$4,$5,$6)`,[actor.workspaceId,command.operationId,personId,actor.id,digest,version]);
   return {personId,version,replayed:false,authorityEpoch:command.expectedEpoch};
  });
 }

 private async resolvePerson(tx:SqlSession,actor:Actor,command:AudienceCommand,phone:string|null):Promise<string>{
  if(command.personId){await this.ensureProfile(tx,actor,command.personId,phone);return command.personId;}
  if(!phone||!command.displayName)throw new AppError("INVALID_REQUEST");
  const audience=await tx.query<{personId:string;ciphertext:string}>(`SELECT person_id AS "personId",payload_ciphertext AS ciphertext FROM ls_contact_ops.audience_profiles WHERE workspace_id=$1 ORDER BY person_id LIMIT 502`,[actor.workspaceId]);
  if(audience.length>500)throw new AppError("UNAVAILABLE");
  const audienceMatches=audience.filter(row=>decode(profileSchema,row.ciphertext,aadProfile(actor.workspaceId,row.personId),this.keyring).phone===phone);
  if(audienceMatches.length>1)throw new AppError("CONFLICT");
  const crm=await this.directory.acquisitionMatchesInTransaction(tx,actor,[phone]),match=crm.get(phone);
  if(!match||match.state==="reserved"||match.state==="ambiguous"||audienceMatches.length&&match.state==="existing"&&match.people[0]?.personId!==audienceMatches[0]!.personId)throw new AppError("CONFLICT");
  const existing=audienceMatches[0]?.personId??(match.state==="existing"?match.people[0]?.personId:undefined);
  if(existing){await this.ensureProfile(tx,actor,existing,phone);return existing;}
  const personId=randomUUID(),now=this.clock.now();
  await tx.query(`INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)`,
   [personId,actor.workspaceId,seal(JSON.stringify({displayName:command.displayName}),`person:${actor.workspaceId}:${personId}`,this.keyring),now]);
  await tx.query(`INSERT INTO ls_contact_ops.audience_profiles(workspace_id,person_id,payload_ciphertext,record_mode) VALUES($1,$2,$3,'live')`,
   [actor.workspaceId,personId,encodeProfile(actor.workspaceId,personId,{displayName:command.displayName,phone},this.keyring)]);
  return personId;
 }

 private async ensureProfile(tx:SqlSession,actor:Actor,personId:string,phone:string|null){
  const identity=await tx.query<StoredProfile>(`SELECT i.id AS "personId",i.profile_ciphertext AS "personCiphertext",a.payload_ciphertext AS "profileCiphertext",
   d.batch_id AS "markerBatch",(SELECT max(a.demo_batch_id) FROM ls_identity.account_subjects s JOIN ls_identity.accounts a
    ON a.workspace_id=s.workspace_id AND a.id=s.account_id WHERE s.workspace_id=i.workspace_id AND s.person_id=i.id) AS "accountDemoBatch",
   c.payload_ciphertext AS "crmCiphertext",c.record_mode AS "crmMode"
   FROM ls_identity.people i LEFT JOIN ls_contact_ops.audience_profiles a ON a.workspace_id=i.workspace_id AND a.person_id=i.id
   LEFT JOIN ls_demo.records d ON d.workspace_id=i.workspace_id AND d.entity_kind='person' AND d.entity_key=i.id::text
   LEFT JOIN ls_contact_ops.profiles c ON c.workspace_id=i.workspace_id AND c.person_id=i.id
   WHERE i.workspace_id=$1 AND i.id=$2`,[actor.workspaceId,personId]);
  if(identity.length!==1)throw new AppError("NOT_FOUND");const row=identity[0]!;
  if(row.markerBatch||row.accountDemoBatch||row.crmMode==="demo")throw new AppError("FORBIDDEN");
  const person=decode(z.object({displayName:z.string().min(1).max(120)}),row.personCiphertext,`person:${actor.workspaceId}:${personId}`,this.keyring);
  if(row.profileCiphertext){const saved=decode(profileSchema,row.profileCiphertext,aadProfile(actor.workspaceId,personId),this.keyring);if(phone&&saved.phone!==phone)throw new AppError("CONFLICT");return;}
  if(!phone)throw new AppError("INVALID_REQUEST");
  await tx.query(`INSERT INTO ls_contact_ops.audience_profiles(workspace_id,person_id,payload_ciphertext,record_mode) VALUES($1,$2,$3,'live')`,
   // Canonical identity owns the displayed name. A phone observation must not
   // rename an existing sales/client person.
   [actor.workspaceId,personId,encodeProfile(actor.workspaceId,personId,{displayName:person.displayName,phone},this.keyring)]);
 }

 private async readRows(tx:SqlSession,actor:Actor):Promise<AudienceRow[]>{
  const profiles=await tx.query<StoredProfile & StoredInterest>(`SELECT a.person_id AS "personId",a.payload_ciphertext AS "profileCiphertext",i.profile_ciphertext AS "personCiphertext",
   d.batch_id AS "markerBatch",(SELECT max(ac.demo_batch_id) FROM ls_identity.account_subjects s JOIN ls_identity.accounts ac
    ON ac.workspace_id=s.workspace_id AND ac.id=s.account_id WHERE s.workspace_id=i.workspace_id AND s.person_id=i.id) AS "accountDemoBatch",
   c.payload_ciphertext AS "crmCiphertext",c.record_mode AS "crmMode",x.payload_ciphertext AS "payloadCiphertext",x.version,x.observed_at AS "observedAt"
   FROM ls_contact_ops.audience_profiles a JOIN ls_identity.people i ON i.workspace_id=a.workspace_id AND i.id=a.person_id
   LEFT JOIN ls_demo.records d ON d.workspace_id=a.workspace_id AND d.entity_kind='person' AND d.entity_key=a.person_id::text
   LEFT JOIN ls_contact_ops.profiles c ON c.workspace_id=a.workspace_id AND c.person_id=a.person_id
   LEFT JOIN ls_contact_ops.audience_interests x ON x.workspace_id=a.workspace_id AND x.person_id=a.person_id AND x.topic='bna_content'
   WHERE a.workspace_id=$1 ORDER BY a.person_id LIMIT 501`,[actor.workspaceId]);
  if(profiles.length>500||profiles.some(row=>row.markerBatch||row.accountDemoBatch||row.crmMode==="demo"))throw new AppError("UNAVAILABLE");
  const observations=await tx.query<{personId:string;id:string;ciphertext:string}>(`SELECT person_id AS "personId",observation_id AS id,payload_ciphertext AS ciphertext
   FROM ls_contact_ops.audience_observations WHERE workspace_id=$1 ORDER BY observed_at DESC,observation_id LIMIT 1001`,[actor.workspaceId]);
  if(observations.length>1000)throw new AppError("UNAVAILABLE");const byPerson=new Map<string,AudienceRow["observations"]>();
  for(const item of observations){const value=decode(observationSchema,item.ciphertext,aadObservation(actor.workspaceId,item.id),this.keyring);const list=byPerson.get(item.personId)??[];if(list.length<20)list.push(value);byPerson.set(item.personId,list);}
  return profiles.map(row=>{const profile=decode(profileSchema,row.profileCiphertext,aadProfile(actor.workspaceId,row.personId),this.keyring);
   const person=decode(z.object({displayName:z.string().min(1).max(120)}),row.personCiphertext,`person:${actor.workspaceId}:${row.personId}`,this.keyring);
   const interest=row.payloadCiphertext?decode(interestSchema,row.payloadCiphertext,aadInterest(actor.workspaceId,row.personId),this.keyring):null;
   const crm=row.crmCiphertext?decode(crmProfileSchema,row.crmCiphertext,crmProfileAad(actor.workspaceId,row.personId),this.keyring):null;
   const doNotContact=Boolean(crm?.doNotContact)||contactSuppressed(crm?.stage??"")||Object.values(crm?.leadUpdates??{}).some(value=>contactSuppressed(value.outcome??""));
   return {personId:row.personId,displayName:profile.displayName||person.displayName,phone:profile.phone,topic:"bna_content" as const,state:interest?.state??null,
    version:row.version??0,observedAt:interest?.observedAt??null,sourceRef:interest?.sourceRef??null,observations:byPerson.get(row.personId)??[],
    messagingPermission:"unknown" as const,outboundEligible:false as const,doNotContact,mode:"live" as const};}).sort((a,b)=>a.displayName.localeCompare(b.displayName)||a.personId.localeCompare(b.personId));
 }
}
