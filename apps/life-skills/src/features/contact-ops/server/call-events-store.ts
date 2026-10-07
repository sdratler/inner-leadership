import "server-only";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import {asId} from "../../../lib/ids.ts";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";
import {lockWorkspace} from "../../identity/data.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import {systemClock,type IdentityClock} from "../../identity/types.ts";
import {normalizedCallEventSchema,type CallEvent,type CallActivity} from "../core/call-events.ts";
import {acquisitionCandidateMetadataSchema} from "../core/acquisition.ts";
import {AcquisitionCandidateStore} from "./acquisition-store.ts";
import {NativeInboundProjection} from "./inbound-projection.ts";
import {privateDigest} from "./digests.ts";
import {readCutoverState,cutoverStateSchema,cutoverStateAad} from "./cutover-state.ts";
import {writeDestination} from "../core/cutover.ts";
import {MAX_NATIVE_CONTACTS} from "../core/limits.ts";

export async function linkCallActivity(tx:SqlSession,workspace:string,candidateId:string,personId:string):Promise<boolean>{
 const rows=await tx.query<{personId:string}>(`INSERT INTO ls_contact_ops.call_activity_links(workspace_id,candidate_id,person_id)
  VALUES($1,$2,$3) ON CONFLICT(workspace_id,candidate_id) DO NOTHING RETURNING person_id AS "personId"`,[workspace,candidateId,personId]);
 if(rows.length>1)throw new AppError("UNAVAILABLE");if(rows.length===1)return true;
 const prior=await tx.query<{personId:string}>(`SELECT person_id AS "personId" FROM ls_contact_ops.call_activity_links
  WHERE workspace_id=$1 AND candidate_id=$2`,[workspace,candidateId]);
 if(prior.length!==1||prior[0]!.personId!==personId)throw new AppError("CONFLICT");return false;
}
/** Caller is the ordinary authorized directory, in its existing authority-locked
 * read transaction. Latest FIVE persisted calls per already-authorized person,
 * not a phone/history scan or clinical join. Never return another person's call. */
export async function readCallActivities(tx:SqlSession,workspace:string,people:readonly string[],keyring:Keyring):Promise<Map<string,{items:CallActivity[];hasMore:boolean}>>{
 if(people.length>MAX_NATIVE_CONTACTS||people.some(id=>!z.string().uuid().safeParse(id).success))throw new AppError("UNAVAILABLE");
 const authorized=new Set(people);
 const rows=await tx.query<{personId:string;id:string;binding:string;message:string;ciphertext:string;occurredAt:Date}>(`SELECT p.person AS "personId",c.*
  FROM jsonb_array_elements_text($2::jsonb) p(person) CROSS JOIN LATERAL(
   SELECT a.id,a.provider_binding_id AS binding,a.provider_message_key AS message,a.metadata_ciphertext AS ciphertext,a.occurred_at AS "occurredAt"
   FROM ls_contact_ops.call_activity_links l JOIN ls_contact_ops.inbound_activity_candidates a ON a.workspace_id=l.workspace_id AND a.id=l.candidate_id
   WHERE l.workspace_id=$1 AND l.person_id=p.person::uuid ORDER BY a.occurred_at DESC,a.id DESC LIMIT 6) c`,[workspace,JSON.stringify(people)]);
 if(rows.length>people.length*6)throw new AppError("UNAVAILABLE");const result=new Map<string,{items:CallActivity[];hasMore:boolean}>();
 for(const row of rows){
  if(!authorized.has(row.personId))throw new AppError("UNAVAILABLE");
  let metadata;try{metadata=acquisitionCandidateMetadataSchema.parse(JSON.parse(unseal(row.ciphertext,
   `ls_contact_ops/acquisition-candidate/v1/${workspace}/${row.binding}/${row.message}`,keyring)));}catch{throw new AppError("UNAVAILABLE");}
  if(metadata.source!=="android_nomad"||metadata.id!==row.id||metadata.occurredAt!==row.occurredAt.toISOString()||metadata.durationSeconds===undefined)throw new AppError("UNAVAILABLE");
  const value=result.get(row.personId)??{items:[],hasMore:false};result.set(row.personId,value);
  if(value.items.length<5)value.items.push({id:metadata.id,occurredAt:metadata.occurredAt,callState:"incoming",durationSeconds:metadata.durationSeconds});else value.hasMore=true;
 }
 return result;
}
/** Dedicated authenticated Nomad binding only. Receipt is durable even before
 * cutover; no Sheet/native double writer or silent fallback. Native authority
 * links only an unambiguous existing live CRM adult. Unknowns remain candidates.
 * A replay may reconcile a previously receipt-only call AFTER native activation;
 * owner dispositions and old links are never replaced after phone reassignment.
 */
export class CallEventsStore{
 constructor(private readonly db:IdentityStore,private readonly workspace:string,private readonly deviceBinding:string,
  private readonly keyring:Keyring,private readonly integrityKey:string,private readonly clock:IdentityClock=systemClock){
  asId(workspace,"workspace");if(!z.string().uuid().safeParse(deviceBinding).success)throw new AppError("UNAVAILABLE");
 }
 async capture(input:CallEvent):Promise<{replayed:boolean}>{
  const parsed=normalizedCallEventSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");const event=parsed.data;
  const binding=privateDigest({domain:"nomad-device-v1",workspace:this.workspace,device:this.deviceBinding},this.integrityKey);
  const sender=privateDigest({domain:"contact-endpoint-v1",workspace:this.workspace,phone:event.phone},this.integrityKey);
  const message=privateDigest({domain:"nomad-call-v1",binding,sender,occurredAt:event.occurredAt},this.integrityKey);
  const messageDigest=privateDigest({domain:"nomad-call-payload-v1",workspace:this.workspace,event},this.integrityKey);
  const candidates=new AcquisitionCandidateStore(this.db,this.keyring,this.integrityKey,this.clock);
  return this.db.transaction(async tx=>{
   await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${this.workspace}:contact-authority`]);
   await lockWorkspace(tx,asId(this.workspace,"workspace"));
   const authority=await readCutoverState(tx,this.workspace,this.keyring,true);
   const receipt=await candidates.captureMetadataInTransaction(tx,this.workspace,event,{binding,message,thread:sender,sender,messageDigest});
   let linked=false;
   if(writeDestination(authority.phase)==="native"){
    const done=await tx.query(`SELECT candidate_id FROM ls_contact_ops.call_activity_links WHERE workspace_id=$1 AND candidate_id=$2
     UNION ALL SELECT candidate_id FROM ls_contact_ops.lead_promotion_operations WHERE workspace_id=$1 AND candidate_id=$2`,[this.workspace,receipt.id]);
    if(!done.length){
     const person=await new NativeInboundProjection(this.workspace,this.keyring,this.integrityKey,this.clock).knownCallPersonInTransaction(tx,event.phone,sender);
     if(person)linked=await linkCallActivity(tx,this.workspace,receipt.id,person);
    }
    if(!receipt.replayed||linked){
     if(authority.nativeWritesSinceSwitch>=Number.MAX_SAFE_INTEGER-1)throw new AppError("UNAVAILABLE");
     const next=cutoverStateSchema.parse({...authority,nativeWritesSinceSwitch:authority.nativeWritesSinceSwitch+1});
     const rows=await tx.query(`UPDATE ls_contact_ops.cutover SET state_ciphertext=$3,updated_at=clock_timestamp()
      WHERE workspace_id=$1 AND epoch=$2 RETURNING epoch::text`,[this.workspace,authority.epoch,seal(JSON.stringify(next),cutoverStateAad(this.workspace,authority.epoch),this.keyring)]);
     if(rows.length!==1)throw new AppError("CONFLICT");
    }
   }
   return {replayed:receipt.replayed}; // no number, name, identity or case in provider acknowledgement
  });
 }
}
