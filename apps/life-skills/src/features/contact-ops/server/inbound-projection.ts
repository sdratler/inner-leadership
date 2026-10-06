import "server-only";
import {randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import {asId,type WorkspaceId} from "../../../lib/ids.ts";
import type {SqlSession} from "../../identity/store.ts";
import {lockWorkspace} from "../../identity/data.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import {systemClock,type IdentityClock} from "../../identity/types.ts";
import type {InboundInquiry} from "../core/inbound.ts";
import {inboundProjectionEnabled,inboundFollowUp,inboundMessageMaterial,nextInboundActivity} from "../core/inbound-projection.ts";
import {normalizePhone,resolveEndpoint,type EndpointClaim} from "../core/contact-resolution.ts";
import {MAX_NATIVE_CONTACTS} from "../core/limits.ts";
import {crmProfileAad,crmProfileSchema,type CrmProfile} from "./native-store.ts";
import {digest,privateDigest} from "./digests.ts";
import {readCutoverState,cutoverStateSchema,cutoverStateAad} from "./cutover-state.ts";
import {contactSuppressed,contactArchived} from "../../prospects/native-edit.ts";
import {qualifiedNewInbound} from "../core/acquisition.ts";
import {AcquisitionCandidateStore} from "./acquisition-store.ts";

const key=z.string().regex(/^[a-f0-9]{64}$/);
const receiptKeys=z.object({binding:key,event:key,message:key,thread:key,sender:key,payloadDigest:key,messageDigest:key}).strict();
export type InboundProjectionKeys=z.infer<typeof receiptKeys>;
const resolutionSchema=z.object({state:z.enum(["projected","needs_resolution"]),reason:z.enum(["new_contact","known_thread","verified_endpoint","ambiguous_endpoint"]),
 personId:z.string().uuid().nullable(),candidateIds:z.array(z.string().uuid()).max(MAX_NATIVE_CONTACTS)}).strict().refine(v=>
 new Set(v.candidateIds).size===v.candidateIds.length&&(v.state==="projected"?
 v.personId!==null&&v.reason!=="ambiguous_endpoint"&&v.candidateIds.length===0:
 v.personId===null&&v.reason==="ambiguous_endpoint"&&v.candidateIds.length>0));
type Resolution=z.infer<typeof resolutionSchema>;
type ProfileRow={personId:string;ciphertext:string;version:number;mode:"live"|"demo";demoBatch:string|null};
type LegacyClaimRow={personId:string;leadId:string;fileId:string;sheetId:number;ciphertext:string};
const resolutionAad=(workspace:string,binding:string,message:string)=>`ls_contact_ops/inbound-projection/v1/${workspace}/${binding}/${message}`;
const sourceSchema=z.object({payload:z.object({stageText:z.string(),sourceFields:z.record(z.string(),z.string())})});
const phoneField=(fields:Record<string,string>)=>Object.entries(fields).find(([header])=>header.trim()==="Phone")?.[1]??"";
const whatsappOrigin=(personId:string,inquiry:InboundInquiry,keys:InboundProjectionKeys)=>({
 origin:"native_whatsapp",leadId:"LS-WAPI-native-"+personId,phone:inquiry.fromNumber,
 language:/[\u0590-\u05ff]/.test(inquiry.messageText)?"he":inquiry.messageText.trim()?"en":"",source:"WhatsApp",
 createdAt:inquiry.occurredAt,providerBindingKey:keys.binding,providerThreadKey:keys.thread});

/** Internal trusted-receipt composition, NOT a public role/session bypass. Only
 * ContactInboundStore calls this after the configured binding and exact durable
 * payload have been verified. No separate commit, network, sends or case access.
 * The ordinary practitioner CRM keeps its existing fresh-actor checks. */
export class NativeInboundProjection {
 private readonly workspace:WorkspaceId;
 private claimSnapshot:{tx:SqlSession;byPhone:Map<string,EndpointClaim[]>}|null=null;
 constructor(workspace:string,private readonly keyring:Keyring,
  private readonly integrityKey:string,private readonly clock:IdentityClock=systemClock,
  private readonly drainPhones:readonly string[]=[]){
  this.workspace=asId(workspace,"workspace");
  if(drainPhones.length>100||drainPhones.some(phone=>normalizePhone(phone)!==phone))throw new AppError("INVALID_REQUEST");
 }
 private decode<T>(schema:z.ZodType<T>,ciphertext:string,aad:string):T{
  try{return schema.parse(JSON.parse(unseal(ciphertext,aad,this.keyring)));}catch{throw new AppError("UNAVAILABLE");}
 }
 private async profile(tx:SqlSession,personId:string):Promise<{row:ProfileRow;profile:CrmProfile}|null>{
  const rows=await tx.query<ProfileRow>(`SELECT person_id AS "personId",payload_ciphertext AS ciphertext,
   version,record_mode AS mode,demo_batch_id AS "demoBatch" FROM ls_contact_ops.profiles
   WHERE workspace_id=$1 AND person_id=$2 FOR UPDATE`,[this.workspace,personId]);
  if(rows.length>1)throw new AppError("UNAVAILABLE");
  const row=rows[0];if(!row)return null;
  if(row.mode!=="live"||row.demoBatch!==null||!Number.isSafeInteger(row.version)||row.version<1||row.version>=2147483647)throw new AppError("CONFLICT");
  const profile=this.decode(crmProfileSchema,row.ciphertext,crmProfileAad(this.workspace,personId));
  if(profile.personId!==personId)throw new AppError("UNAVAILABLE");return {row,profile:profile as CrmProfile};
 }
 /** Imported restrictions remain authoritative even when the editable profile
  * has no opt-out flag, or a later inquiry has a different outcome. Match the
  * directory's conservative source protection; never infer consent from inbound.
  */
 private async sourceSuppressed(tx:SqlSession,profile:CrmProfile):Promise<boolean>{
  const links=await tx.query<{leadId:string;fileId:string;sheetId:number;ciphertext:string}>(`SELECT
   legacy_lead_id AS "leadId",source_file_id AS "fileId",source_sheet_id AS "sheetId",snapshot_ciphertext AS ciphertext
   FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND person_id=$2 ORDER BY legacy_lead_id LIMIT $3`,
   [this.workspace,profile.personId,101]);
  if(links.length>100||new Set(links.map(link=>link.leadId)).size!==links.length||
   [...profile.legacyIds].sort().join("\0")!==links.map(link=>link.leadId).sort().join("\0"))throw new AppError("UNAVAILABLE");
  let suppressed=false;
  for(const link of links){
   const source=this.decode(sourceSchema,link.ciphertext,`ls_contact_ops/legacy/v1/${this.workspace}/${link.fileId}/${link.sheetId}/${link.leadId}`);
   const field=(name:string)=>Object.entries(source.payload.sourceFields).find(([header])=>header.trim()===name)?.[1]??"";
   if(field("Lead ID").trim()!==link.leadId)throw new AppError("UNAVAILABLE");
   suppressed=contactSuppressed(source.payload.stageText)||contactSuppressed(field("Outcome"))||suppressed;
  }
  return suppressed;
 }
 /** An imported/unverified/shared phone is never upgraded to verified merely
  * because a business message arrived. Reserved inactive/demo accounts still
  * block new-person creation; no phone/name/account/case merging happens here. */
 private async claims(tx:SqlSession,phone:string,senderKey:string):Promise<EndpointClaim[]>{
  const endpoint=(number:string)=>privateDigest({domain:"contact-endpoint-v1",workspace:this.workspace,phone:number},this.integrityKey);
  if(endpoint(phone)!==senderKey)throw new AppError("CONFLICT");
  if(this.claimSnapshot?.tx===tx&&this.claimSnapshot.byPhone.has(phone))return this.claimSnapshot.byPhone.get(phone)!;
  // A drain's workspace lock keeps account/source endpoint claims stable. Cache
  // ONLY its <=100 target phones within this exact transaction, never sessions.
  const targets=new Set([...this.drainPhones,phone]);if(targets.size>100)throw new AppError("UNAVAILABLE");
  const byPhone=new Map([...targets].map(number=>[number,[] as EndpointClaim[]]));
  const add=(personId:string,value:string,verified:boolean,shared:boolean)=>{
   const normalized=normalizePhone(value),claims=normalized?byPhone.get(normalized):undefined;
   if(claims&&normalized)claims.push({personId,workspaceId:this.workspace,endpointKey:endpoint(normalized),verified,shared,revoked:false});
  };
  let after:string|null=null,total=0;
  const batchSize=100;
  for(;;){
   const profiles:ProfileRow[]=await tx.query<ProfileRow>(`SELECT person_id AS "personId",payload_ciphertext AS ciphertext,
    version,record_mode AS mode,demo_batch_id AS "demoBatch" FROM ls_contact_ops.profiles
    WHERE workspace_id=$1 AND ($2::uuid IS NULL OR person_id>$2::uuid) ORDER BY person_id LIMIT $3`,[this.workspace,after,batchSize]);
   if(!profiles.length)break;
   total+=profiles.length;
   if(total>MAX_NATIVE_CONTACTS||profiles.length>batchSize||profiles.some((r,i)=>i>0&&r.personId<=profiles[i-1]!.personId)||after!==null&&profiles[0]!.personId<=after)throw new AppError("UNAVAILABLE");
   // Use the existing legacy_links_by_person index and group each bounded batch
   // once: O(profiles + links), not a workspace-wide filter for every profile.
   const links:LegacyClaimRow[]=await tx.query<LegacyClaimRow>(`SELECT person_id AS "personId",
    legacy_lead_id AS "leadId",source_file_id AS "fileId",source_sheet_id AS "sheetId",snapshot_ciphertext AS ciphertext
    FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND person_id IN (SELECT value::uuid FROM jsonb_array_elements_text($2::jsonb))
    ORDER BY person_id,legacy_lead_id LIMIT $3`,[this.workspace,JSON.stringify(profiles.map(row=>row.personId)),profiles.length*100+1]);
   if(links.length>profiles.length*100)throw new AppError("UNAVAILABLE");
   const grouped=new Map<string,LegacyClaimRow[]>(profiles.map(row=>[row.personId,[]]));
   for(const link of links){const owned=grouped.get(link.personId);if(!owned)throw new AppError("UNAVAILABLE");owned.push(link);}
   for(const row of profiles){
    const profile=this.decode(crmProfileSchema,row.ciphertext,crmProfileAad(this.workspace,row.personId));
    if(profile.personId!==row.personId||!["live","demo"].includes(row.mode)||(row.mode==="live"?row.demoBatch!==null:!row.demoBatch))throw new AppError("UNAVAILABLE");
    const owned=grouped.get(row.personId)!;
    if(new Set(owned.map(link=>link.leadId)).size!==owned.length||[...profile.legacyIds].sort().join("\0")!==owned.map(link=>link.leadId).sort().join("\0"))throw new AppError("UNAVAILABLE");
    for(const link of owned){
     const source=this.decode(sourceSchema,link.ciphertext,`ls_contact_ops/legacy/v1/${this.workspace}/${link.fileId}/${link.sheetId}/${link.leadId}`);
     if(Object.entries(source.payload.sourceFields).find(([header])=>header.trim()==="Lead ID")?.[1]?.trim()!==link.leadId)throw new AppError("UNAVAILABLE");
     add(row.personId,phoneField(source.payload.sourceFields),false,row.mode==="demo");
    }
    if(profile.nativeInquiry)add(row.personId,profile.nativeInquiry.phone,false,row.mode==="demo");
    if(profile.whatsappInquiry)add(row.personId,profile.whatsappInquiry.phone,false,row.mode==="demo");
   }
   after=profiles.at(-1)!.personId;if(profiles.length<batchSize)break;
  }
  const accounts=await tx.query<{id:string;personId:string|null;phoneCiphertext:string;verifiedAt:Date|null;state:string;demo:boolean}>(`SELECT a.id,
   s.person_id AS "personId",a.phone_ciphertext AS "phoneCiphertext",a.phone_verified_at AS "verifiedAt",a.state,
   (d.account_id IS NOT NULL OR a.demo_batch_id IS NOT NULL) AS demo FROM ls_identity.accounts a
   LEFT JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id
   LEFT JOIN ls_demo.accounts d
    ON d.workspace_id=a.workspace_id AND d.account_id=a.id
   WHERE a.workspace_id=$1 AND a.phone_ciphertext IS NOT NULL ORDER BY a.id LIMIT $2`,[this.workspace,MAX_NATIVE_CONTACTS+1]);
  if(accounts.length>MAX_NATIVE_CONTACTS)throw new AppError("UNAVAILABLE");
  for(const account of accounts){
   if(!account.personId)throw new AppError("UNAVAILABLE");
   let claimed:string|null;
   try{claimed=normalizePhone(unseal(account.phoneCiphertext,`phone:${this.workspace}:${account.id}`,this.keyring));}catch{throw new AppError("UNAVAILABLE");}
   if(!claimed)throw new AppError("UNAVAILABLE");
   add(account.personId,claimed,account.state==="active"&&account.verifiedAt!==null&&!account.demo,account.demo);
  }
  this.claimSnapshot={tx,byPhone};return byPhone.get(phone)!;
 }
 /** A call may append administrative activity to ONE existing live adult CRM
  * profile. Reuse the same bounded endpoint claims/reservations as WhatsApp;
  * no account/case is matched or granted, and no name is an identity key. The
  * caller holds the native authority and workspace locks. Unverified CRM phones
  * are only a call routing hint, never permission to send or log in. */
 async knownCallPersonInTransaction(tx:SqlSession,phone:string,senderKey:string):Promise<string|null>{
  const claims=await this.claims(tx,phone,senderKey),ids=[...new Set(claims.map(c=>c.personId))];
  if(ids.length!==1||claims.some(c=>c.shared||c.revoked))return null;
  const personId=ids[0]!;
  const modes=await tx.query<{kind:string;mode:string;archived:boolean;demo:boolean}>(`SELECT i.kind,p.record_mode AS mode,
   (p.archived_at IS NOT NULL) AS archived,(d.entity_key IS NOT NULL) AS demo
   FROM ls_contact_ops.profiles p JOIN ls_identity.people i ON i.workspace_id=p.workspace_id AND i.id=p.person_id
   LEFT JOIN ls_demo.records d ON d.workspace_id=p.workspace_id AND d.entity_kind='person' AND d.entity_key=p.person_id::text
   WHERE p.workspace_id=$1 AND p.person_id=$2`,[this.workspace,personId]);
  if(modes.length!==1||modes[0]!.kind!=="adult"||modes[0]!.mode!=="live"||modes[0]!.archived||modes[0]!.demo)return null;
  const existing=await this.profile(tx,personId);if(!existing)return null;
  const p=existing.profile;
  if(p.doNotContact||contactSuppressed(p.stage)||contactArchived(p.stage)||
   Object.values(p.leadUpdates??{}).some(v=>contactSuppressed(v.outcome??""))||await this.sourceSuppressed(tx,p))return null;
  return personId;
 }
 async projectInTransaction(tx:SqlSession,inquiry:InboundInquiry,input:InboundProjectionKeys):Promise<{state:"receipt_only"|"projected"|"needs_resolution"|"needs_review";replayed:boolean}>{
  const keys=receiptKeys.parse(input);
  const expectedBinding=privateDigest({domain:"contact-binding-v1",binding:digest({provider:inquiry.provider,
   channelId:inquiry.channelId,businessNumber:inquiry.businessNumber}),workspace:this.workspace},this.integrityKey);
  const expectedEvent=privateDigest({domain:"contact-event-v1",binding:expectedBinding,id:inquiry.providerEventId},this.integrityKey);
  const expectedMessage=privateDigest({domain:"contact-message-v1",binding:expectedBinding,id:inquiry.providerMessageId},this.integrityKey);
  const expectedPayload=privateDigest({domain:"contact-payload-v1",workspace:this.workspace,inquiry},this.integrityKey);
  if(JSON.stringify(keys)!==JSON.stringify(inboundProjectionKeys(this.workspace,expectedBinding,expectedEvent,expectedMessage,expectedPayload,inquiry,this.integrityKey)))throw new AppError("CONFLICT");
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${this.workspace}:contact-authority`]);
  const authority=await readCutoverState(tx,this.workspace,this.keyring,true);
  if(!inboundProjectionEnabled(authority.phase))return {state:"receipt_only",replayed:false};
  const raw=await tx.query<{digest:string}>(`SELECT payload_digest AS digest FROM ls_contact_ops.message_receipts
   WHERE workspace_id=$1 AND channel='whatsapp' AND provider_binding_id=$2 AND provider_event_key=$3
    AND provider_message_key=$4`,[this.workspace,keys.binding,keys.event,keys.message]);
  if(raw.length!==1||raw[0]!.digest!==keys.payloadDigest)throw new AppError("CONFLICT");
  const prior=await tx.query<{digest:string;thread:string;ciphertext:string;state:string;reason:string;personId:string|null}>(`SELECT message_digest AS digest,provider_thread_key AS thread,
   resolution_ciphertext AS ciphertext,state,reason,person_id AS "personId" FROM ls_contact_ops.inbound_projections
   WHERE workspace_id=$1 AND provider_binding_id=$2 AND provider_message_key=$3`,[this.workspace,keys.binding,keys.message]);
  if(prior[0]){
   if(prior.length!==1||prior[0].digest!==keys.messageDigest||prior[0].thread!==keys.thread)throw new AppError("CONFLICT");
   const outcome=this.decode(resolutionSchema,prior[0].ciphertext,resolutionAad(this.workspace,keys.binding,keys.message));
   if(outcome.state!==prior[0].state||outcome.reason!==prior[0].reason||outcome.personId!==prior[0].personId)throw new AppError("UNAVAILABLE");
   return {state:outcome.state,replayed:true};
  }
  const candidates=new AcquisitionCandidateStore({transaction:work=>work(tx)},this.keyring,this.integrityKey,this.clock);
  if(await candidates.priorInTransaction(tx,this.workspace,keys))return {state:"needs_review",replayed:true};
  if(authority.nativeWritesSinceSwitch>=Number.MAX_SAFE_INTEGER-1)throw new AppError("UNAVAILABLE");
  await lockWorkspace(tx,this.workspace);
  const thread=await tx.query<{personId:string;sender:string}>(`SELECT person_id AS "personId",sender_endpoint_key AS sender
   FROM ls_contact_ops.inbound_threads WHERE workspace_id=$1 AND provider_binding_id=$2 AND provider_thread_key=$3`,[this.workspace,keys.binding,keys.thread]);
  if(thread.length>1||thread[0]&&thread[0].sender!==keys.sender)throw new AppError("CONFLICT");
  let outcome:Resolution,existing:Awaited<ReturnType<NativeInboundProjection["profile"]>>=null;
  if(thread[0]){
   existing=await this.profile(tx,thread[0].personId);if(!existing)throw new AppError("UNAVAILABLE");
   const claims=await this.claims(tx,inquiry.fromNumber,keys.sender);
   // A stable business thread is not permission to ignore a newly shared or
   // reassigned endpoint. Hold the message, preserving prior thread history.
   if(claims.some(claim=>claim.personId!==thread[0]!.personId||claim.shared)){
    outcome={state:"needs_resolution",reason:"ambiguous_endpoint",personId:null,
     candidateIds:[...new Set([thread[0].personId,...claims.map(claim=>claim.personId)])].sort()};existing=null;
   }else outcome={state:"projected",reason:"known_thread",personId:thread[0].personId,candidateIds:[]};
  }else{
   const match=resolveEndpoint(this.workspace,keys.sender,await this.claims(tx,inquiry.fromNumber,keys.sender));
   if(match.kind==="ambiguous")outcome={state:"needs_resolution",reason:"ambiguous_endpoint",personId:null,candidateIds:[...match.candidateIds]};
   else{
    if(match.kind==="new"&&!qualifiedNewInbound(inquiry)){
     const candidate=await candidates.captureInTransaction(tx,this.workspace,inquiry,keys);
     if(!candidate.replayed){
      const next=cutoverStateSchema.parse({...authority,nativeWritesSinceSwitch:authority.nativeWritesSinceSwitch+1});
      const advanced=await tx.query<{epoch:string}>("UPDATE ls_contact_ops.cutover SET state_ciphertext=$3,updated_at=clock_timestamp() WHERE workspace_id=$1 AND epoch=$2 RETURNING epoch::text",
       [this.workspace,authority.epoch,seal(JSON.stringify(next),cutoverStateAad(this.workspace,authority.epoch),this.keyring)]);
      if(advanced.length!==1)throw new AppError("CONFLICT");
     }
     return {state:"needs_review",replayed:candidate.replayed};
    }
    const personId=match.kind==="matched"?match.personId:randomUUID();
    existing=await this.profile(tx,personId);
    if(existing?.profile.whatsappInquiry){
     // A different thread/endpoint is not permission to relabel an existing
     // immutable WhatsApp inquiry. Keep the new receipt for explicit review.
     outcome={state:"needs_resolution",reason:"ambiguous_endpoint",personId:null,candidateIds:[personId]};existing=null;
    }else{
    if(!existing){
     const capacity=await tx.query<{n:number}>("SELECT count(*)::int AS n FROM ls_contact_ops.profiles WHERE workspace_id=$1",[this.workspace]);
     if(capacity.length!==1||capacity[0]!.n>=MAX_NATIVE_CONTACTS)throw new AppError("UNAVAILABLE");
     if(match.kind==="new")await tx.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)",
      [personId,this.workspace,seal(JSON.stringify({displayName:inquiry.pushName||inquiry.fromNumber}),`person:${this.workspace}:${personId}`,this.keyring),this.clock.now()]);
     const profile=crmProfileSchema.parse({personId,stage:"New inquiry",nextAction:null,followUpDate:null,notes:"",legacyIds:[],
      whatsappInquiry:whatsappOrigin(personId,inquiry,keys)});
     await tx.query("INSERT INTO ls_contact_ops.profiles(workspace_id,person_id,payload_ciphertext,record_mode,demo_batch_id) VALUES($1,$2,$3,'live',NULL)",
      [this.workspace,personId,seal(JSON.stringify(profile),crmProfileAad(this.workspace,personId),this.keyring)]);
     existing=await this.profile(tx,personId);if(!existing)throw new AppError("UNAVAILABLE");
    }
    outcome={state:"projected",reason:match.kind==="new"?"new_contact":"verified_endpoint",personId,candidateIds:[]};
    await tx.query("INSERT INTO ls_contact_ops.inbound_threads(workspace_id,provider_binding_id,provider_thread_key,sender_endpoint_key,person_id) VALUES($1,$2,$3,$4,$5)",
     [this.workspace,keys.binding,keys.thread,keys.sender,personId]);
    }
   }
  }
  if(existing&&outcome.personId){
   const saved=existing.profile,today=new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Jerusalem"}).format(this.clock.now());
   // Only an explicit owner match retains the chosen existing lead instead of
   // manufacturing an additional inquiry. Existing provider-origin/history
   // behavior remains unchanged for automatically verified endpoint matches.
   const ownerMatch=await tx.query(`SELECT d.operation_id FROM ls_contact_ops.lead_promotion_operations d
    JOIN ls_contact_ops.inbound_activity_candidates c ON c.workspace_id=d.workspace_id AND c.id=d.candidate_id
    WHERE d.workspace_id=$1 AND d.person_id=$2 AND d.state='MATCHED' AND c.provider_binding_id=$3
     AND c.provider_thread_key=$4 AND c.sender_endpoint_key=$5 LIMIT 1`,[this.workspace,outcome.personId,keys.binding,keys.thread,keys.sender]);
   const keepOwnerMatchedLead=ownerMatch.length===1&&Boolean(saved.nativeInquiry||saved.legacyIds.length);
   const sourceSuppressed=await this.sourceSuppressed(tx,saved);
   const suppressed=sourceSuppressed||saved.doNotContact===true||contactSuppressed(saved.stage)||Object.values(saved.leadUpdates??{}).some(v=>contactSuppressed(v.outcome??""));
   const merged=crmProfileSchema.parse({...saved,...inboundFollowUp(saved,today,suppressed),
    // Each person has its own explicit provider inquiry. Historical/manual
    // references remain separate; never smear a new message across all leads.
    ...(saved.whatsappInquiry||keepOwnerMatchedLead?{}:
     {whatsappInquiry:whatsappOrigin(outcome.personId,inquiry,keys)}),
    inboundActivity:nextInboundActivity(saved.inboundActivity,inquiry,keys.message)});
   if(merged.notes!==saved.notes)throw new AppError("UNAVAILABLE");
   const updated=await tx.query<{version:number}>("UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3,version=version+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND person_id=$2 AND version=$4 RETURNING version",
    [this.workspace,outcome.personId,seal(JSON.stringify(merged),crmProfileAad(this.workspace,outcome.personId),this.keyring),existing.row.version]);
   if(updated.length!==1)throw new AppError("CONFLICT");
   if(this.claimSnapshot?.tx===tx){
    // The only endpoint mutation performed by this locked drain is its newly
    // created WhatsApp inquiry. Add that UNVERIFIED claim before another item;
    // a new thread must still hold it instead of guessing identity/consent.
    const claims=this.claimSnapshot.byPhone.get(inquiry.fromNumber);
    if(claims&&!claims.some(claim=>claim.personId===outcome.personId&&!claim.verified&&!claim.shared))claims.push({personId:outcome.personId,
     workspaceId:this.workspace,endpointKey:keys.sender,verified:false,shared:false,revoked:false});
   }
  }
  await tx.query(`INSERT INTO ls_contact_ops.inbound_projections(workspace_id,channel,provider_binding_id,provider_message_key,provider_event_key,
   provider_thread_key,message_digest,state,reason,person_id,authority_epoch,resolution_ciphertext)
   VALUES($1,'whatsapp',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,[this.workspace,keys.binding,keys.message,keys.event,keys.thread,keys.messageDigest,
   outcome.state,outcome.reason,outcome.personId,authority.epoch,seal(JSON.stringify(resolutionSchema.parse(outcome)),resolutionAad(this.workspace,keys.binding,keys.message),this.keyring)]);
  const next=cutoverStateSchema.parse({...authority,nativeWritesSinceSwitch:authority.nativeWritesSinceSwitch+1});
  const advanced=await tx.query<{epoch:string}>("UPDATE ls_contact_ops.cutover SET state_ciphertext=$3,updated_at=clock_timestamp() WHERE workspace_id=$1 AND epoch=$2 RETURNING epoch::text",
   [this.workspace,authority.epoch,seal(JSON.stringify(next),cutoverStateAad(this.workspace,authority.epoch),this.keyring)]);
  if(advanced.length!==1)throw new AppError("CONFLICT");
  return {state:outcome.state,replayed:false};
 }
}

/** One canonical derivation for capture/replay/draining already stored receipts.
 * Key material and message bodies never appear in an HTTP acknowledgement. */
export function inboundProjectionKeys(workspace:string,binding:string,event:string,message:string,payloadDigest:string,inquiry:InboundInquiry,integrityKey:string):InboundProjectionKeys{
 return receiptKeys.parse({binding,event,message,payloadDigest,
  thread:privateDigest({domain:"contact-thread-v1",binding,id:inquiry.providerThreadId},integrityKey),
  sender:privateDigest({domain:"contact-endpoint-v1",workspace,phone:inquiry.fromNumber},integrityKey),
  messageDigest:privateDigest({domain:"contact-message-content-v1",workspace,
   inquiry:inboundMessageMaterial(inquiry)},integrityKey)});
}
