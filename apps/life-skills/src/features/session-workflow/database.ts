import { createHash, randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import { caseAccess } from "../cases/policy.ts";
import { loadCase, loadGuardians } from "../cases/data.ts";
import { freshActor, lockWorkspace } from "../identity/data.ts";
import { seal, unseal, type Keyring } from "../identity/crypto.ts";
import { one, type IdentityStore, type SqlSession } from "../identity/store.ts";
import type { Actor, IdentityClock } from "../identity/types.ts";
import { blankMetrics, validateMetricRecord, validateObservationEvidence, type PrivateObservationEvidence, type MetricRecord, type MetricValues } from "./metrics.ts";
import { recapFromReviewedFields, recipientRecap, shareDigest, validateRecap } from "./recap.ts";
import type { AudioState, BroadFocus, ProcessingStage, RoutineRecap, RecipientRoutineRecap, SharedPractice, Transcript, PrivateAnalysis, Locale } from "./types.ts";
import { readPrivateTranscript, readPrivateAnalysis, sealPrivateRecord,privateRecordAad, type PrivateSessionReadMetadata, type StoredTranscriptRow, type StoredAnalysisRow } from "./private-records.ts";
import {MAX_SPEAKER_RECORD_BYTES,appendSpeakerCorrection,type SpeakerCorrectionInput} from "./speaker-corrections.ts";
import { nonempty, validIso } from "./policy.ts";
import { consentVersionSchema, type ConsentVersion, type ConsentRecordInput } from "./consent-contract.ts";
import {MAX_DISCLOSURE_RECORDS,disclosureSchema,disclosureInputSchema,disclosureUseSchema,disclosureRevokeSchema,type DisclosureInput,type DisclosureView} from "./disclosure-contract.ts";
import {recapDraftSchema,recapVersionViewSchema,recapSharePreviewSchema,recapPublicationSchema,routineRecapSchema,type RecapDraftInput,type RecapVersionView,type RecapSharePreview,type RecapPublication,type RecapPracticeChoices} from "./recap-contract.ts";
import {nativeRecapPracticeChoices,reviewedNativeRecapPractices,assertRecapPracticeRecipients} from "./recap-practices.ts";

type SessionRow = { sessionId:string; caseId:string; appointmentId:string; practitionerAccountId:string; state:"open"|"completed"|"archived"; startsAt:Date; endsAt:Date };
type ConsentRow = { id:string; version:number; signedByAccountId:string; signedAt:Date; policyVersion:string; authorityState:"checked"|"needs_review"|"restricted"; recordingAllowed:boolean; transcriptionAllowed:boolean; aiProcessingAllowed:boolean; childInformed:boolean; withdrawnAt:Date|null };
type DisclosureRow={id:string;sessionId:string|null;recipientCiphertext:string;purposeCiphertext:string;topicCiphertext:string;authorityEvidenceCiphertext:string;channel:DisclosureInput["channel"];authorizedByAccountId:string;recordedByPractitionerId:string;childDiscussionRecorded:boolean;authorizedAt:Date;expiresAt:Date;revokedAt:Date|null;usedAt:Date|null};
const disclosureColumns='id,session_id AS "sessionId",recipient_ciphertext AS "recipientCiphertext",purpose_ciphertext AS "purposeCiphertext",topic_ciphertext AS "topicCiphertext",authority_evidence_ciphertext AS "authorityEvidenceCiphertext",channel,authorized_by_account_id AS "authorizedByAccountId",recorded_by_practitioner_id AS "recordedByPractitionerId",child_discussion_recorded AS "childDiscussionRecorded",authorized_at AS "authorizedAt",expires_at AS "expiresAt",revoked_at AS "revokedAt",used_at AS "usedAt"';

/** Account membership is necessary, not a legal finding that one parent's signature suffices. */
async function disclosureSigner(tx:SqlSession,actor:Actor,caseId:string,accountId:string):Promise<{kind:"minor"|"adult"}|null>{return one(tx,`SELECT cp.kind FROM ls_identity.accounts a JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id JOIN ls_cases.cases c ON c.workspace_id=a.workspace_id AND c.id=$2 JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id JOIN ls_identity.people cp ON cp.workspace_id=cl.workspace_id AND cp.id=cl.person_id LEFT JOIN ls_cases.case_guardians g ON g.workspace_id=a.workspace_id AND g.case_id=c.id AND g.account_id=a.id WHERE a.workspace_id=$1 AND a.id=$3 AND a.state='active' AND c.state<>'archived' AND ((a.role='parent' AND cp.kind='minor' AND g.account_id IS NOT NULL AND g.revoked_at IS NULL) OR (a.role='adult_client' AND cp.kind='adult' AND s.person_id=cl.person_id))`,[actor.workspaceId,caseId,accountId]);}

function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function aad(kind:string, workspaceId:string, caseId:string, id:string, version:number|string):string { return `session:${kind}:${workspaceId}:${caseId}:${id}:${version}`; }
function sealJson(value:unknown,aadValue:string,ring:Keyring):string {
  const bytes=Buffer.from(JSON.stringify(value),"utf8"),chunks:string[]=[];
  for(let offset=0;offset<bytes.length;offset+=32_000)chunks.push(seal(bytes.subarray(offset,offset+32_000).toString("base64url"),`${aadValue}:${chunks.length}`,ring));
  return JSON.stringify({v:1,chunks});
}
function unsealJson<T>(encoded:string,aadValue:string,ring:Keyring):T {
  try { const parsed=JSON.parse(encoded) as {v:number;chunks:string[]}; if(parsed.v!==1||!Array.isArray(parsed.chunks)||!parsed.chunks.length)throw new Error();
    return JSON.parse(Buffer.concat(parsed.chunks.map((chunk,index)=>Buffer.from(unseal(chunk,`${aadValue}:${index}`,ring),"base64url"))).toString("utf8")) as T;
  } catch(error){ if(error instanceof AppError)throw error; throw new AppError("UNAVAILABLE"); }
}
async function sessionRow(tx:SqlSession,workspaceId:string,sessionId:string,lock=false):Promise<SessionRow>{
  const row=await one<SessionRow>(tx,`SELECT s.id AS "sessionId",s.case_id AS "caseId",s.appointment_id AS "appointmentId",s.practitioner_account_id AS "practitionerAccountId",s.state,a.starts_at AS "startsAt",a.ends_at AS "endsAt" FROM ls_sessions.sessions s JOIN ls_calendar.appointments a ON a.workspace_id=s.workspace_id AND a.case_id=s.case_id AND a.id=s.appointment_id WHERE s.workspace_id=$1 AND s.id=$2 ${lock?"FOR UPDATE OF s":""}`,[workspaceId,sessionId]);
  if(!row)throw new AppError("NOT_FOUND");return row;
}
async function owner(tx:SqlSession,actor:Actor,caseId:string,clock:IdentityClock){const current=await freshActor(tx,actor,clock.now());caseAccess(current,await loadCase(tx,actor.workspaceId,caseId as never),await loadGuardians(tx,actor.workspaceId,caseId as never),"write");if(current.role!=="practitioner")throw new AppError("NOT_FOUND");return current;}
async function command<T>(tx:SqlSession,ring:Keyring,actor:Actor,row:SessionRow,operation:string,key:string,body:unknown,work:()=>Promise<T>):Promise<T>{
  if(!/^[0-9a-f-]{36}$/i.test(key))throw new AppError("INVALID_REQUEST");const bodyDigest=digest(body);
  const prior=await one<{bodyDigest:string;resultCiphertext:string}>(tx,'SELECT body_digest AS "bodyDigest",result_ciphertext AS "resultCiphertext" FROM ls_sessions.command_receipts WHERE workspace_id=$1 AND actor_account_id=$2 AND operation=$3 AND idempotency_key=$4',[actor.workspaceId,actor.id,operation,key]);
  if(prior){if(prior.bodyDigest!==bodyDigest)throw new AppError("CONFLICT");return unsealJson<T>(prior.resultCiphertext,aad("command",actor.workspaceId,row.caseId,key,operation),ring);}
  const result=await work();await tx.query('INSERT INTO ls_sessions.command_receipts(workspace_id,case_id,session_id,actor_account_id,operation,idempotency_key,body_digest,result_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[actor.workspaceId,row.caseId,row.sessionId,actor.id,operation,key,bodyDigest,sealJson(result,aad("command",actor.workspaceId,row.caseId,key,operation),ring)]);return result;
}

export interface SessionListItem { sessionId:string|null; appointmentId:string; startsAt:string; endsAt:string; state:string|null; processingState:string|null; audioState:string|null; }
export interface SessionDetail {
  workspaceId:string;caseId:string;sessionId:string;clientDisplayName:string;selectedAppointmentId:string;appointments:{id:string;label:string}[];
  processing:{state:ProcessingStage|null;audioState:AudioState|null;message:string;permissionToRecord:boolean;consent:{id:string;version:number;signedByAccountId:string;signedAt:string;policyVersion:string;authorityState:ConsentRow["authorityState"];recordingAllowed:boolean;transcriptionAllowed:boolean;aiProcessingAllowed:boolean;childInformed:boolean;withdrawnAt:string|null}|null};
  transcript:Transcript|null;analysis:PrivateAnalysis|null;privateRecords?:PrivateSessionReadMetadata;metrics:MetricValues;metricsRevision:number;recap:RoutineRecap|null;recapDigest:string|null;
  recipients:{accountId:string;name:string}[];
  consentSigners:{accountId:string;name:string}[];
}
export interface SharedRecapView {publicationId:string;sessionId:string;sharedAt:string;recap:RecipientRoutineRecap;}
export type RecordConsentInput = ConsentRecordInput;
type SavedRecapRow={version:number;bodyCiphertext:string;contentDigest:string};
type RoutineRecipientRow={accountId:string;role:"parent"|"child"|"adult_client";profileCiphertext:string;personId:string};
async function routineRecipientRows(tx:SqlSession,actor:Actor,caseId:string):Promise<RoutineRecipientRow[]>{
  const rows=await tx.query<RoutineRecipientRow>(`SELECT a.id AS "accountId",a.role,p.profile_ciphertext AS "profileCiphertext",p.id AS "personId"
   FROM ls_identity.accounts a JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id
   JOIN ls_identity.people p ON p.workspace_id=s.workspace_id AND p.id=s.person_id
   LEFT JOIN ls_cases.case_guardians g ON g.workspace_id=a.workspace_id AND g.account_id=a.id AND g.case_id=$2
   JOIN ls_cases.cases c ON c.workspace_id=a.workspace_id AND c.id=$2
   JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id
   JOIN ls_identity.people cp ON cp.workspace_id=cl.workspace_id AND cp.id=cl.person_id
   WHERE a.workspace_id=$1 AND a.state='active' AND
    ((a.role='parent' AND cp.kind='minor' AND g.account_id IS NOT NULL AND g.revoked_at IS NULL AND c.state<>'archived')
     OR (a.role='adult_client' AND cp.kind='adult' AND s.person_id=cl.person_id)
     OR (a.role='child' AND cp.kind='minor' AND s.person_id=cl.person_id)) ORDER BY a.id LIMIT 9`,[actor.workspaceId,caseId]);
  if(rows.length>8)throw new AppError("UNAVAILABLE");return rows;
}
function recipientNames(rows:readonly RoutineRecipientRow[],actor:Actor,ring:Keyring){
  return rows.map(row=>{const profile=JSON.parse(unseal(row.profileCiphertext,`person:${actor.workspaceId}:${row.personId}`,ring)) as Record<string,unknown>;
    return {accountId:row.accountId,name:Object.hasOwn(profile,"displayName")&&typeof profile.displayName==="string"&&profile.displayName.trim()?profile.displayName:"Authorized recipient"};});
}
function decodedRecap(row:SavedRecapRow,actor:Actor,session:SessionRow,ring:Keyring):RoutineRecap{
  const value=unsealJson<unknown>(row.bodyCiphertext,aad("recap",actor.workspaceId,session.caseId,session.sessionId,row.version),ring),parsed=routineRecapSchema.safeParse(value);
  if(!parsed.success||parsed.data.sessionId!==session.sessionId||parsed.data.caseId!==session.caseId||parsed.data.version!==row.version||digest(value)!==row.contentDigest)throw new AppError("UNAVAILABLE");
  validateRecap(parsed.data);return parsed.data;
}
async function recapFacts(tx:SqlSession,actor:Actor,row:SessionRow,now:Date){
  const attendance=await one<{state:"present"|"late"|"no_show"|"canceled";version:number;arrivedAt:Date|null}>(tx,'SELECT state,version,arrived_at AS "arrivedAt" FROM ls_attendance.records WHERE workspace_id=$1 AND appointment_id=$2',[actor.workspaceId,row.appointmentId]);
  const next=await one<{id:string;startsAt:Date;endsAt:Date}>(tx,`SELECT id,starts_at AS "startsAt",ends_at AS "endsAt" FROM ls_calendar.appointments
   WHERE workspace_id=$1 AND case_id=$2 AND kind='individual' AND status='scheduled' AND starts_at>$3 ORDER BY starts_at,id LIMIT 1`,
   [actor.workspaceId,row.caseId,new Date(Math.max(now.getTime(),row.startsAt.getTime()))]);
  return {attendance:{appointmentId:row.appointmentId,state:attendance?.state??"unrecorded" as const,source:"appointment_record" as const,revision:attendance?.version??0,startsAt:row.startsAt.toISOString(),arrivedAt:attendance?.arrivedAt?.toISOString()??null},
    nextAppointment:next?{id:next.id,startsAt:next.startsAt.toISOString(),endsAt:next.endsAt.toISOString(),timezone:"Asia/Jerusalem",source:"calendar" as const}:null};
}
async function assertRecapFactsCurrent(tx:SqlSession,actor:Actor,row:SessionRow,recap:RoutineRecap,now:Date){
  const facts=await recapFacts(tx,actor,row,now);
  if(JSON.stringify(recap.attendance)!==JSON.stringify(facts.attendance)||JSON.stringify(recap.nextAppointment)!==JSON.stringify(facts.nextAppointment))throw new AppError("CONFLICT");
}
export class SessionDatabaseService {
  constructor(private readonly store:IdentityStore,private readonly ring:Keyring,private readonly clock:IdentityClock){}
  async saveSpeakers(actor:Actor,sessionId:string,input:SpeakerCorrectionInput,key:string):Promise<{version:number;revision:number;recordedAt:string}>{return this.store.transaction(async tx=>{
    await lockWorkspace(tx,actor.workspaceId);const row=await sessionRow(tx,actor.workspaceId,sessionId,true);await owner(tx,actor,row.caseId,this.clock);
    return command(tx,this.ring,actor,row,"save_speakers",key,input,async()=>{
      const stored=await one<StoredTranscriptRow>(tx,'SELECT t.version,t.job_id AS "jobId",t.source_ciphertext AS "sourceCiphertext",t.cleaned_ciphertext AS "cleanedCiphertext",t.speaker_mapping_ciphertext AS "speakerMappingCiphertext",t.content_digest AS "contentDigest",t.source_kind AS "sourceKind",t.created_at AS "createdAt",j.transcript_complete_verified AS "completeVerified",j.transcript_version AS "jobTranscriptVersion",j.transcript_digest AS "jobTranscriptDigest",j.source_digest AS "sourceDigest",j.duration_milliseconds AS "durationMs",j.completion_receipt_ciphertext AS "completionReceiptCiphertext" FROM ls_sessions.transcripts t JOIN ls_sessions.recording_jobs j ON j.workspace_id=t.workspace_id AND j.case_id=t.case_id AND j.session_id=t.session_id AND j.id=t.job_id WHERE t.workspace_id=$1 AND t.case_id=$2 AND t.session_id=$3 ORDER BY t.version DESC LIMIT 1 FOR UPDATE OF t',[actor.workspaceId,row.caseId,sessionId]);
      if(!stored)throw new AppError("NOT_FOUND");const scope={workspaceId:actor.workspaceId,caseId:row.caseId,sessionId},saved=readPrivateTranscript(stored,scope,this.ring),recordedAt=this.clock.now().toISOString();
      const history=appendSpeakerCorrection(saved.metadata.speakerHistory,saved.transcript,input,actor.id,recordedAt);
      // Only the versioned mapping changes. Source, cleaned text, digest, job and analysis remain untouched.
      if(Buffer.byteLength(JSON.stringify(history),"utf8")>MAX_SPEAKER_RECORD_BYTES)throw new AppError("PAYLOAD_TOO_LARGE");
      const encrypted=sealPrivateRecord(history,privateRecordAad("speakers",scope,stored.version),this.ring);
      await tx.query('UPDATE ls_sessions.transcripts SET speaker_mapping_ciphertext=$5 WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 AND version=$4',[actor.workspaceId,row.caseId,sessionId,stored.version,encrypted]);
      return {version:stored.version,revision:history.revision,recordedAt};
    });
  });}
  private async disclosureView(tx:SqlSession,actor:Actor,row:SessionRow,item:DisclosureRow):Promise<DisclosureView>{
    const decode=(field:string,ciphertext:string)=>unsealJson<unknown>(ciphertext,aad(`disclosure-${field}`,actor.workspaceId,row.caseId,item.id,1),this.ring);
    const authority=decode("authority",item.authorityEvidenceCiphertext) as {authorityBasis:unknown;authorityState:unknown};
    const signer=await disclosureSigner(tx,actor,row.caseId,item.authorizedByAccountId),now=this.clock.now();
    const parsed=disclosureSchema.safeParse({workspaceId:actor.workspaceId,caseId:row.caseId,sessionId:item.sessionId,id:item.id,recipient:decode("recipient",item.recipientCiphertext),purpose:decode("purpose",item.purposeCiphertext),topic:decode("topic",item.topicCiphertext),...authority,channel:item.channel,authorizedByAccountId:item.authorizedByAccountId,recordedByPractitionerId:item.recordedByPractitionerId,childDiscussionRecorded:item.childDiscussionRecorded,authorizedAt:item.authorizedAt.toISOString(),expiresAt:item.expiresAt.toISOString(),revokedAt:item.revokedAt?.toISOString()??null,usedAt:item.usedAt?.toISOString()??null,effective:Boolean(signer&&authority?.authorityState==="checked"&&(signer.kind==="adult"||item.childDiscussionRecorded)&&item.authorizedAt<=now&&now<item.expiresAt&&!item.revokedAt&&!item.usedAt)});
    if(!parsed.success)throw new AppError("UNAVAILABLE");return parsed.data;
  }
  async disclosures(actor:Actor,sessionId:string,disclosureId?:string):Promise<DisclosureView[]>{return this.store.transaction(async tx=>{
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");const row=await sessionRow(tx,actor.workspaceId,sessionId);await owner(tx,actor,row.caseId,this.clock);
    const records=await tx.query<DisclosureRow>(`SELECT ${disclosureColumns} FROM ls_sessions.disclosure_authorizations WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 AND ($4::uuid IS NULL OR id=$4) ORDER BY authorized_at DESC,id LIMIT ${MAX_DISCLOSURE_RECORDS+1}`,[actor.workspaceId,row.caseId,sessionId,disclosureId??null]);
    if(records.length>MAX_DISCLOSURE_RECORDS)throw new AppError("UNAVAILABLE");if(disclosureId&&!records.length)throw new AppError("NOT_FOUND");return Promise.all(records.map(item=>this.disclosureView(tx,actor,row,item)));
  });}
  async authorizeDisclosure(actor:Actor,sessionId:string,input:DisclosureInput,key:string):Promise<{disclosureId:string;revokedAt:null;usedAt:null}>{return this.store.transaction(async tx=>{
    await lockWorkspace(tx,actor.workspaceId);const row=await sessionRow(tx,actor.workspaceId,sessionId,true);await owner(tx,actor,row.caseId,this.clock);
    return command(tx,this.ring,actor,row,"authorize_disclosure",key,input,async()=>{
      const parsed=disclosureInputSchema.safeParse(input);if(!parsed.success||Date.parse(input.authorizedAt)>this.clock.now().getTime()||Date.parse(input.expiresAt)<=Date.parse(input.authorizedAt))throw new AppError("INVALID_REQUEST");
      if(!await disclosureSigner(tx,actor,row.caseId,input.authorizedByAccountId))throw new AppError("NOT_FOUND");
      // Keep the existing bounded history readable. Workspace/session locks
      // serialize competing writers; command replay is checked before this cap.
      const capacity=await one<{count:number}>(tx,`SELECT count(*)::integer AS count FROM (SELECT 1 FROM ls_sessions.disclosure_authorizations WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 LIMIT ${MAX_DISCLOSURE_RECORDS}) bounded`,[actor.workspaceId,row.caseId,sessionId]);
      if(!capacity||capacity.count>=MAX_DISCLOSURE_RECORDS)throw new AppError("CONFLICT");
      const id=randomUUID(),encode=(field:string,value:unknown)=>sealJson(value,aad(`disclosure-${field}`,actor.workspaceId,row.caseId,id,1),this.ring);
      await tx.query('INSERT INTO ls_sessions.disclosure_authorizations(workspace_id,case_id,id,session_id,recipient_ciphertext,purpose_ciphertext,topic_ciphertext,authority_evidence_ciphertext,channel,authorized_by_account_id,recorded_by_practitioner_id,child_discussion_recorded,authorized_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[actor.workspaceId,row.caseId,id,sessionId,encode("recipient",input.recipient),encode("purpose",input.purpose),encode("topic",input.topic),encode("authority",{authorityBasis:input.authorityBasis,authorityState:input.authorityState}),input.channel,input.authorizedByAccountId,actor.id,input.childDiscussionRecorded,new Date(input.authorizedAt),new Date(input.expiresAt)]);
      return {disclosureId:id,revokedAt:null,usedAt:null};
    });
  });}
  async revokeDisclosure(actor:Actor,sessionId:string,id:string,input:{expectedUsedAt:string|null},key:string):Promise<{disclosureId:string;revokedAt:string;usedAt:string|null}>{return this.store.transaction(async tx=>{
    await lockWorkspace(tx,actor.workspaceId);const row=await sessionRow(tx,actor.workspaceId,sessionId,true);await owner(tx,actor,row.caseId,this.clock);
    return command(tx,this.ring,actor,row,"revoke_disclosure",key,{id,...input},async()=>{
      if(!disclosureRevokeSchema.safeParse(input).success)throw new AppError("INVALID_REQUEST");
      const prior=await one<DisclosureRow>(tx,`SELECT ${disclosureColumns} FROM ls_sessions.disclosure_authorizations WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 AND id=$4 FOR UPDATE`,[actor.workspaceId,row.caseId,sessionId,id]);if(!prior)throw new AppError("NOT_FOUND");
      if(prior.revokedAt||(prior.usedAt?.toISOString()??null)!==input.expectedUsedAt)throw new AppError("CONFLICT");const revokedAt=this.clock.now();
      await tx.query('UPDATE ls_sessions.disclosure_authorizations SET revoked_at=$5 WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 AND id=$4',[actor.workspaceId,row.caseId,sessionId,id,revokedAt]);
      return {disclosureId:id,revokedAt:revokedAt.toISOString(),usedAt:prior.usedAt?.toISOString()??null};
    });
  });}
  async recordDisclosureUse(actor:Actor,sessionId:string,id:string,input:{usedAt:string},key:string):Promise<{disclosureId:string;revokedAt:null;usedAt:string}>{return this.store.transaction(async tx=>{
    await lockWorkspace(tx,actor.workspaceId);const row=await sessionRow(tx,actor.workspaceId,sessionId,true);await owner(tx,actor,row.caseId,this.clock);
    return command(tx,this.ring,actor,row,"record_disclosure_use",key,{id,...input},async()=>{
      if(!disclosureUseSchema.safeParse(input).success)throw new AppError("INVALID_REQUEST");
      const prior=await one<DisclosureRow>(tx,`SELECT ${disclosureColumns} FROM ls_sessions.disclosure_authorizations WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 AND id=$4 FOR UPDATE`,[actor.workspaceId,row.caseId,sessionId,id]);if(!prior)throw new AppError("NOT_FOUND");
      const current=await this.disclosureView(tx,actor,row,prior);if(!current.effective)throw new AppError("CONFLICT");
      const usedAt=new Date(input.usedAt);if(usedAt<prior.authorizedAt||usedAt>=prior.expiresAt||usedAt>this.clock.now())throw new AppError("INVALID_REQUEST");
      await tx.query('UPDATE ls_sessions.disclosure_authorizations SET used_at=$5 WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 AND id=$4',[actor.workspaceId,row.caseId,sessionId,id,usedAt]);
      return {disclosureId:id,revokedAt:null,usedAt:usedAt.toISOString()};
    });
  });}
  async observations(actor:Actor,caseId:string):Promise<PrivateObservationEvidence>{return this.store.transaction(async tx=>{
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    await owner(tx,actor,caseId,this.clock);
    const sessions=await tx.query<{sessionId:string;startsAt:Date}>(`SELECT s.id AS "sessionId",a.starts_at AS "startsAt" FROM ls_sessions.sessions s JOIN ls_calendar.appointments a ON a.workspace_id=s.workspace_id AND a.case_id=s.case_id AND a.id=s.appointment_id WHERE s.workspace_id=$1 AND s.case_id=$2 AND (a.starts_at<=$3 OR EXISTS(SELECT 1 FROM ls_sessions.practitioner_observations o WHERE o.workspace_id=s.workspace_id AND o.case_id=s.case_id AND o.session_id=s.id)) ORDER BY a.starts_at,s.id LIMIT 1001`,[actor.workspaceId,caseId,this.clock.now()]);
    const rows=await tx.query<{sessionId:string;revision:number;recordedByAccountId:string;recordedAt:Date;valuesCiphertext:string}>(`SELECT o.session_id AS "sessionId",o.revision,o.recorded_by_account_id AS "recordedByAccountId",o.recorded_at AS "recordedAt",o.values_ciphertext AS "valuesCiphertext" FROM ls_sessions.practitioner_observations o JOIN ls_sessions.sessions s ON s.workspace_id=o.workspace_id AND s.case_id=o.case_id AND s.id=o.session_id JOIN ls_calendar.appointments a ON a.workspace_id=s.workspace_id AND a.case_id=s.case_id AND a.id=s.appointment_id WHERE o.workspace_id=$1 AND o.case_id=$2 ORDER BY a.starts_at,o.session_id,o.revision LIMIT 1001`,[actor.workspaceId,caseId]);
    // Fail visibly rather than silently presenting a truncated clinical history.
    if(sessions.length>1000||rows.length>1000)throw new AppError("UNAVAILABLE");
    const evidence:PrivateObservationEvidence={workspaceId:actor.workspaceId,caseId,sessions:sessions.map(item=>({sessionId:item.sessionId,startsAt:item.startsAt.toISOString()})),records:rows.map(item=>({schemaVersion:1,workspaceId:actor.workspaceId,caseId,sessionId:item.sessionId,revision:item.revision,recordedByAccountId:item.recordedByAccountId,recordedAt:item.recordedAt.toISOString(),source:"practitioner_observation",values:unsealJson<MetricValues>(item.valuesCiphertext,aad("metrics",actor.workspaceId,caseId,item.sessionId,item.revision),this.ring)}))};
    validateObservationEvidence(evidence,caseId);return evidence;
  });}
  async list(actor:Actor,caseId:string,appointmentId?:string):Promise<SessionListItem[]>{return this.store.transaction(async tx=>{
    await owner(tx,actor,caseId,this.clock);
    if(appointmentId!==undefined&&!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appointmentId))throw new AppError("INVALID_REQUEST");
    // Select the authorized Calendar context before the ordinary page bound.
    // Reading an old appointment never creates a session or broadens its case.
    const rows=await tx.query<{sessionId:string|null;appointmentId:string;startsAt:Date;endsAt:Date;state:string|null;processingState:string|null;audioState:string|null}>(`SELECT s.id AS "sessionId",a.id AS "appointmentId",a.starts_at AS "startsAt",a.ends_at AS "endsAt",s.state,j.state AS "processingState",j.audio_state AS "audioState" FROM ls_calendar.appointments a LEFT JOIN ls_sessions.sessions s ON s.workspace_id=a.workspace_id AND s.case_id=a.case_id AND s.appointment_id=a.id LEFT JOIN LATERAL(SELECT state,audio_state FROM ls_sessions.recording_jobs j WHERE j.workspace_id=s.workspace_id AND j.session_id=s.id ORDER BY j.created_at DESC LIMIT 1)j ON true WHERE a.workspace_id=$1 AND a.case_id=$2 AND a.kind='individual' AND ($3::uuid IS NULL OR a.id=$3::uuid) ORDER BY a.starts_at DESC,a.id LIMIT 100`,[actor.workspaceId,caseId,appointmentId?.toLowerCase()??null]);return rows.map(x=>({...x,startsAt:x.startsAt.toISOString(),endsAt:x.endsAt.toISOString()}));
  });}
  async ensureForAppointment(actor:Actor,caseId:string,appointmentId:string):Promise<{sessionId:string}>{return this.store.transaction(async tx=>{await lockWorkspace(tx,actor.workspaceId);await owner(tx,actor,caseId,this.clock);const appointment=await one<{practitionerId:string}>(tx,"SELECT practitioner_id AS \"practitionerId\" FROM ls_calendar.appointments WHERE workspace_id=$1 AND case_id=$2 AND id=$3 AND kind='individual'",[actor.workspaceId,caseId,appointmentId]);if(!appointment||appointment.practitionerId!==actor.id)throw new AppError("NOT_FOUND");const existing=await one<{sessionId:string}>(tx,'SELECT id AS "sessionId" FROM ls_sessions.sessions WHERE workspace_id=$1 AND case_id=$2 AND appointment_id=$3',[actor.workspaceId,caseId,appointmentId]);if(existing)return existing;const sessionId=randomUUID();await tx.query("INSERT INTO ls_sessions.sessions(workspace_id,case_id,id,appointment_id,practitioner_account_id,state) VALUES($1,$2,$3,$4,$5,'open')",[actor.workspaceId,caseId,sessionId,appointmentId,actor.id]);return {sessionId};});}
  async detail(actor:Actor,sessionId:string,analysisLocale:Locale="en",transcriptVersion?:number):Promise<SessionDetail>{
    if(analysisLocale!=="en"&&analysisLocale!=="he")throw new AppError("INVALID_REQUEST");
    if(transcriptVersion!==undefined&&(!Number.isInteger(transcriptVersion)||transcriptVersion<1||transcriptVersion>2147483647))throw new AppError("INVALID_REQUEST");
    return this.store.transaction(async tx=>{
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const row=await sessionRow(tx,actor.workspaceId,sessionId);await owner(tx,actor,row.caseId,this.clock);
    const appointments=await tx.query<{id:string;startsAt:Date}>("SELECT id,starts_at AS \"startsAt\" FROM ls_calendar.appointments WHERE workspace_id=$1 AND case_id=$2 AND kind='individual' ORDER BY (id=$3::uuid) DESC,starts_at DESC,id LIMIT 100",[actor.workspaceId,row.caseId,row.appointmentId]);
    const client=await one<{profileCiphertext:string;personId:string;kind:"adult"|"minor"}>(tx,'SELECT p.profile_ciphertext AS "profileCiphertext",p.id AS "personId",p.kind FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id WHERE c.workspace_id=$1 AND c.id=$2',[actor.workspaceId,row.caseId]);
    const job=await one<{state:ProcessingStage;audioState:AudioState}>(tx,'SELECT state,audio_state AS "audioState" FROM ls_sessions.recording_jobs WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 ORDER BY created_at DESC,id DESC LIMIT 1',[actor.workspaceId,row.caseId,sessionId]);
    // A later pending recording must not erase the previous durable transcript.
    // Read the requested saved version (latest by default), then verify its exact job/completion binding;
    // never silently filter a damaged/incomplete latest row into an empty view.
    const transcriptRow=await one<StoredTranscriptRow>(tx,'SELECT t.version,t.job_id AS "jobId",t.source_ciphertext AS "sourceCiphertext",t.cleaned_ciphertext AS "cleanedCiphertext",t.speaker_mapping_ciphertext AS "speakerMappingCiphertext",t.content_digest AS "contentDigest",t.source_kind AS "sourceKind",t.created_at AS "createdAt",j.transcript_complete_verified AS "completeVerified",j.transcript_version AS "jobTranscriptVersion",j.transcript_digest AS "jobTranscriptDigest",j.source_digest AS "sourceDigest",j.duration_milliseconds AS "durationMs",j.completion_receipt_ciphertext AS "completionReceiptCiphertext" FROM ls_sessions.transcripts t JOIN ls_sessions.recording_jobs j ON j.workspace_id=t.workspace_id AND j.case_id=t.case_id AND j.session_id=t.session_id AND j.id=t.job_id WHERE t.workspace_id=$1 AND t.case_id=$2 AND t.session_id=$3 AND ($4::integer IS NULL OR t.version=$4) ORDER BY t.version DESC LIMIT 1',[actor.workspaceId,row.caseId,sessionId,transcriptVersion??null]);
    if(transcriptVersion!==undefined&&!transcriptRow)throw new AppError("NOT_FOUND");
    const scope={workspaceId:actor.workspaceId,caseId:row.caseId,sessionId},savedTranscript=transcriptRow?readPrivateTranscript(transcriptRow,scope,this.ring):null;
    const analysisRow=savedTranscript?await one<StoredAnalysisRow>(tx,'SELECT transcript_version AS "transcriptVersion",locale,revision,body_ciphertext AS "bodyCiphertext",prompt_version AS "promptVersion",model_version AS "modelVersion",created_at AS "createdAt" FROM ls_sessions.private_analyses WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 AND transcript_version=$4 AND locale=$5 ORDER BY revision DESC LIMIT 1',[actor.workspaceId,row.caseId,sessionId,savedTranscript.transcript.version,analysisLocale]):null;
    const savedAnalysis=analysisRow&&savedTranscript?readPrivateAnalysis(analysisRow,scope,this.ring,savedTranscript.transcript,analysisLocale):null;
    const consent=await one<ConsentRow>(tx,'SELECT id,version,signed_by_account_id AS "signedByAccountId",signed_at AS "signedAt",policy_version AS "policyVersion",authority_state AS "authorityState",recording_allowed AS "recordingAllowed",transcription_allowed AS "transcriptionAllowed",ai_processing_allowed AS "aiProcessingAllowed",child_informed AS "childInformed",withdrawn_at AS "withdrawnAt" FROM ls_sessions.recording_consents WHERE workspace_id=$1 AND case_id=$2 ORDER BY version DESC LIMIT 1',[actor.workspaceId,row.caseId]);
    const metric=await one<{revision:number;valuesCiphertext:string}>(tx,'SELECT revision,values_ciphertext AS "valuesCiphertext" FROM ls_sessions.practitioner_observations WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 ORDER BY revision DESC LIMIT 1',[actor.workspaceId,row.caseId,sessionId]);
    const recapRow=await one<{version:number;bodyCiphertext:string;contentDigest:string}>(tx,'SELECT version,body_ciphertext AS "bodyCiphertext",content_digest AS "contentDigest" FROM ls_sessions.routine_recap_versions WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 ORDER BY version DESC LIMIT 1',[actor.workspaceId,row.caseId,sessionId]);
    const recipients=await routineRecipientRows(tx,actor,row.caseId);
    const allowed=Boolean(consent&&consent.authorityState==='checked'&&consent.recordingAllowed&&consent.transcriptionAllowed&&consent.aiProcessingAllowed&&(client?.kind==='adult'||consent.childInformed)&&!consent.withdrawnAt&&recipients.some(item=>item.accountId===consent.signedByAccountId&&item.role!=="child"));
    const values=metric?unsealJson<MetricValues>(metric.valuesCiphertext,aad("metrics",actor.workspaceId,row.caseId,sessionId,metric.revision),this.ring):blankMetrics();
    const recap=recapRow?unsealJson<RoutineRecap>(recapRow.bodyCiphertext,aad("recap",actor.workspaceId,row.caseId,sessionId,recapRow.version),this.ring):null;if(recap)validateRecap(recap);
    const projectedRecipients=recipientNames(recipients,actor,this.ring);
    const clientProfile=client?JSON.parse(unseal(client.profileCiphertext,`person:${actor.workspaceId}:${client.personId}`,this.ring)) as {displayName?:string}:null;
    return {workspaceId:actor.workspaceId,caseId:row.caseId,sessionId,clientDisplayName:clientProfile?.displayName??"Authorized client",selectedAppointmentId:row.appointmentId,appointments:appointments.map(x=>({id:x.id,label:x.startsAt.toISOString()})),processing:{state:job?.state??null,audioState:job?.audioState??null,message:job?`${job.state} · ${job.audioState}`:"No recording uploaded.",permissionToRecord:allowed,consent:consent?{id:consent.id,version:consent.version,signedByAccountId:consent.signedByAccountId,signedAt:consent.signedAt.toISOString(),policyVersion:consent.policyVersion,authorityState:consent.authorityState,recordingAllowed:consent.recordingAllowed,transcriptionAllowed:consent.transcriptionAllowed,aiProcessingAllowed:consent.aiProcessingAllowed,childInformed:consent.childInformed,withdrawnAt:consent.withdrawnAt?.toISOString()??null}:null},transcript:savedTranscript?.transcript??null,analysis:savedAnalysis?.analysis??null,privateRecords:{analysisLocale,transcript:savedTranscript?.metadata??null,analysis:savedAnalysis?.metadata??null},metrics:values,metricsRevision:metric?.revision??0,recap,recapDigest:recap?shareDigest(recap,projectedRecipients.map(x=>x.accountId)):null,recipients:projectedRecipients,consentSigners:projectedRecipients.filter((_,index)=>recipients[index]!.role!=="child")};
  });}
  async consentVersion(actor:Actor,sessionId:string,consentId:string,version:number):Promise<ConsentVersion>{return this.store.transaction(async tx=>{
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const row=await sessionRow(tx,actor.workspaceId,sessionId);await owner(tx,actor,row.caseId,this.clock);
    const consent=await one<ConsentRow&{evidenceCiphertext:string}>(tx,'SELECT id,version,signed_by_account_id AS "signedByAccountId",signed_at AS "signedAt",policy_version AS "policyVersion",authority_state AS "authorityState",recording_allowed AS "recordingAllowed",transcription_allowed AS "transcriptionAllowed",ai_processing_allowed AS "aiProcessingAllowed",child_informed AS "childInformed",withdrawn_at AS "withdrawnAt",evidence_ciphertext AS "evidenceCiphertext" FROM ls_sessions.recording_consents WHERE workspace_id=$1 AND case_id=$2 AND id=$3 AND version=$4',[actor.workspaceId,row.caseId,consentId,version]);
    if(!consent)throw new AppError("NOT_FOUND");
    const {evidenceCiphertext,id,signedAt,withdrawnAt,...metadata}=consent,evidence=unsealJson<{evidence:unknown}>(evidenceCiphertext,aad("consent",actor.workspaceId,row.caseId,id,version),this.ring);
    const parsed=consentVersionSchema.safeParse({...metadata,workspaceId:actor.workspaceId,caseId:row.caseId,sessionId,consentId:id,signedAt:signedAt.toISOString(),withdrawnAt:withdrawnAt?.toISOString()??null,evidence:evidence.evidence});
    if(!parsed.success)throw new AppError("UNAVAILABLE");return parsed.data;
  });}
  async recordConsent(actor:Actor,sessionId:string,input:RecordConsentInput,key:string):Promise<{consentId:string;version:number;permissionToRecord:boolean}>{return this.store.transaction(async tx=>{
    await lockWorkspace(tx,actor.workspaceId);const row=await sessionRow(tx,actor.workspaceId,sessionId,true);await owner(tx,actor,row.caseId,this.clock);
    if(!Number.isInteger(input.expectedVersion)||input.expectedVersion<0||input.expectedVersion>2147483647)throw new AppError("INVALID_REQUEST");
    return command(tx,this.ring,actor,row,"record_consent",key,input,async()=>{
      if(!validIso(input.signedAt)||!nonempty(input.policyVersion,100)||!nonempty(input.evidence,4000)||!["checked","needs_review","restricted"].includes(input.authorityState))throw new AppError("INVALID_REQUEST");
      const signedAt=new Date(input.signedAt);if(signedAt>this.clock.now())throw new AppError("INVALID_REQUEST");
      const signer=await one<{id:string;kind:"adult"|"minor"}>(tx,`SELECT a.id,cp.kind FROM ls_identity.accounts a JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id JOIN ls_cases.cases c ON c.workspace_id=a.workspace_id AND c.id=$2 JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id JOIN ls_identity.people cp ON cp.workspace_id=cl.workspace_id AND cp.id=cl.person_id LEFT JOIN ls_cases.case_guardians g ON g.workspace_id=a.workspace_id AND g.case_id=c.id AND g.account_id=a.id WHERE a.workspace_id=$1 AND a.id=$3 AND a.state='active' AND ((a.role='parent' AND cp.kind='minor' AND g.account_id IS NOT NULL AND g.revoked_at IS NULL) OR (a.role='adult_client' AND cp.kind='adult' AND s.person_id=cl.person_id))`,[actor.workspaceId,row.caseId,input.signedByAccountId]);if(!signer)throw new AppError("NOT_FOUND");
      const prior=await one<{id:string;version:number}>(tx,'SELECT id,version FROM ls_sessions.recording_consents WHERE workspace_id=$1 AND case_id=$2 ORDER BY version DESC LIMIT 1 FOR UPDATE',[actor.workspaceId,row.caseId]);
      if(input.expectedVersion!==(prior?.version??0))throw new AppError("CONFLICT");
      const consentId=prior?.id??randomUUID(),version=(prior?.version??0)+1,permissionToRecord=input.authorityState==='checked'&&input.recordingAllowed&&input.transcriptionAllowed&&input.aiProcessingAllowed&&(signer.kind==='adult'||input.childInformed);
      await tx.query('INSERT INTO ls_sessions.recording_consents(workspace_id,case_id,id,version,signed_by_account_id,signed_at,authority_state,recording_allowed,transcription_allowed,ai_processing_allowed,child_informed,policy_version,evidence_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',[actor.workspaceId,row.caseId,consentId,version,input.signedByAccountId,signedAt,input.authorityState,input.recordingAllowed,input.transcriptionAllowed,input.aiProcessingAllowed,input.childInformed,input.policyVersion,sealJson({evidence:input.evidence},aad("consent",actor.workspaceId,row.caseId,consentId,version),this.ring)]);
      return {consentId,version,permissionToRecord};
    });
  });}
  async withdrawConsent(actor:Actor,sessionId:string,expectedVersion:number,key:string):Promise<{consentId:string;version:number;withdrawnAt:string}>{return this.store.transaction(async tx=>{
    await lockWorkspace(tx,actor.workspaceId);const row=await sessionRow(tx,actor.workspaceId,sessionId,true);await owner(tx,actor,row.caseId,this.clock);
    return command(tx,this.ring,actor,row,"withdraw_consent",key,{expectedVersion},async()=>{
      const prior=await one<{id:string;version:number;signedByAccountId:string;signedAt:Date;authorityState:ConsentRow["authorityState"];recordingAllowed:boolean;transcriptionAllowed:boolean;aiProcessingAllowed:boolean;childInformed:boolean;policyVersion:string;evidenceCiphertext:string;withdrawnAt:Date|null}>(tx,'SELECT id,version,signed_by_account_id AS "signedByAccountId",signed_at AS "signedAt",authority_state AS "authorityState",recording_allowed AS "recordingAllowed",transcription_allowed AS "transcriptionAllowed",ai_processing_allowed AS "aiProcessingAllowed",child_informed AS "childInformed",policy_version AS "policyVersion",evidence_ciphertext AS "evidenceCiphertext",withdrawn_at AS "withdrawnAt" FROM ls_sessions.recording_consents WHERE workspace_id=$1 AND case_id=$2 ORDER BY version DESC LIMIT 1 FOR UPDATE',[actor.workspaceId,row.caseId]);
      if(!prior||prior.version!==expectedVersion||prior.withdrawnAt)throw new AppError("CONFLICT");
      const version=prior.version+1,withdrawnAt=this.clock.now();
      // AES-GCM authenticates the case, consent identity and immutable version.
      // Preserve the prior row; copying its envelope would make the new version
      // unreadable under its own AAD. Re-seal the same evidence, not new consent.
      const evidence=unsealJson<unknown>(prior.evidenceCiphertext,aad("consent",actor.workspaceId,row.caseId,prior.id,prior.version),this.ring);
      const evidenceCiphertext=sealJson(evidence,aad("consent",actor.workspaceId,row.caseId,prior.id,version),this.ring);
      await tx.query('INSERT INTO ls_sessions.recording_consents(workspace_id,case_id,id,version,signed_by_account_id,signed_at,withdrawn_at,authority_state,recording_allowed,transcription_allowed,ai_processing_allowed,child_informed,policy_version,evidence_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)',[actor.workspaceId,row.caseId,prior.id,version,prior.signedByAccountId,prior.signedAt,withdrawnAt,prior.authorityState,prior.recordingAllowed,prior.transcriptionAllowed,prior.aiProcessingAllowed,prior.childInformed,prior.policyVersion,evidenceCiphertext]);
      return {consentId:prior.id,version,withdrawnAt:withdrawnAt.toISOString()};
    });
  });}

  async sharedRecaps(actor:Actor,caseId:string):Promise<SharedRecapView[]>{return this.store.transaction(async tx=>{
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const current=await freshActor(tx,actor,this.clock.now());caseAccess(current,await loadCase(tx,actor.workspaceId,caseId as never),await loadGuardians(tx,actor.workspaceId,caseId as never),"read");
    if(current.role!=="parent"&&current.role!=="adult_client"&&current.role!=="child")throw new AppError("NOT_FOUND");
    const rows=await tx.query<{publicationId:string;sessionId:string;recapVersion:number;sharedAt:Date;bodyCiphertext:string;contentDigest:string}>(`SELECT p.id AS "publicationId",p.session_id AS "sessionId",p.recap_version AS "recapVersion",p.shared_at AS "sharedAt",r.body_ciphertext AS "bodyCiphertext",r.content_digest AS "contentDigest"
      FROM ls_sessions.publications p JOIN ls_sessions.publication_recipients pr ON pr.workspace_id=p.workspace_id AND pr.case_id=p.case_id AND pr.publication_id=p.id AND pr.account_id=$3
      JOIN ls_sessions.routine_recap_versions r ON r.workspace_id=p.workspace_id AND r.case_id=p.case_id AND r.session_id=p.session_id AND r.version=p.recap_version
      WHERE p.workspace_id=$1 AND p.case_id=$2 ORDER BY p.shared_at DESC,p.id DESC LIMIT 100`,[actor.workspaceId,caseId,actor.id]);
    return rows.map(item=>{const value=unsealJson<unknown>(item.bodyCiphertext,aad("recap",actor.workspaceId,caseId,item.sessionId,item.recapVersion),this.ring),parsed=routineRecapSchema.safeParse(value);
      if(!parsed.success||parsed.data.caseId!==caseId||parsed.data.sessionId!==item.sessionId||parsed.data.version!==item.recapVersion||digest(value)!==item.contentDigest)throw new AppError("UNAVAILABLE");
      return {publicationId:item.publicationId,sessionId:item.sessionId,sharedAt:item.sharedAt.toISOString(),recap:recipientRecap(parsed.data)};});
  });}
  async saveObservations(actor:Actor,sessionId:string,values:MetricValues,expectedRevision:number,key:string):Promise<MetricRecord>{return this.store.transaction(async tx=>{await lockWorkspace(tx,actor.workspaceId);const row=await sessionRow(tx,actor.workspaceId,sessionId,true);await owner(tx,actor,row.caseId,this.clock);return command(tx,this.ring,actor,row,"save_observations",key,{values,expectedRevision},async()=>{const current=await one<{revision:number}>(tx,'SELECT revision FROM ls_sessions.practitioner_observations WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 ORDER BY revision DESC LIMIT 1',[actor.workspaceId,row.caseId,sessionId]);if((current?.revision??0)!==expectedRevision)throw new AppError("CONFLICT");const record:MetricRecord={schemaVersion:1,workspaceId:actor.workspaceId,caseId:row.caseId,sessionId,recordedByAccountId:actor.id,source:"practitioner_observation",recordedAt:this.clock.now().toISOString(),revision:expectedRevision+1,values};validateMetricRecord(record);await tx.query('INSERT INTO ls_sessions.practitioner_observations(workspace_id,case_id,session_id,revision,schema_version,values_ciphertext,notes_ciphertext,recorded_by_account_id,recorded_at) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8)',[actor.workspaceId,row.caseId,sessionId,record.revision,sealJson(values,aad("metrics",actor.workspaceId,row.caseId,sessionId,record.revision),this.ring),sealJson({},aad("metric-notes",actor.workspaceId,row.caseId,sessionId,record.revision),this.ring),actor.id,new Date(record.recordedAt)]);return record;});});}

  async recapPracticeChoices(actor:Actor,sessionId:string,cursor?:string):Promise<RecapPracticeChoices>{return this.store.transaction(async tx=>{
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const row=await sessionRow(tx,actor.workspaceId,sessionId),current=await owner(tx,actor,row.caseId,this.clock);
    return nativeRecapPracticeChoices(tx,current,row.caseId,this.ring,this.clock.now(),cursor);
  });}
  async recapVersion(actor:Actor,sessionId:string,version:number):Promise<RecapVersionView>{return this.store.transaction(async tx=>{
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const row=await sessionRow(tx,actor.workspaceId,sessionId);await owner(tx,actor,row.caseId,this.clock);
    if(!Number.isInteger(version)||version<1)throw new AppError("INVALID_REQUEST");
    const stored=await this.savedRecap(tx,actor,row,version);if(!stored)throw new AppError("NOT_FOUND");
    return recapVersionViewSchema.parse({recap:decodedRecap(stored,actor,row,this.ring),digest:stored.contentDigest});
  });}
  private savedRecap(tx:SqlSession,actor:Actor,row:SessionRow,version?:number){
    return one<SavedRecapRow>(tx,'SELECT version,body_ciphertext AS "bodyCiphertext",content_digest AS "contentDigest" FROM ls_sessions.routine_recap_versions WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3'+(version===undefined?'':' AND version=$4')+' ORDER BY version DESC LIMIT 1',version===undefined?[actor.workspaceId,row.caseId,row.sessionId]:[actor.workspaceId,row.caseId,row.sessionId,version]);
  }
  async recapPreview(actor:Actor,sessionId:string,version:number,recipientIds:readonly string[]):Promise<RecapSharePreview>{return this.store.transaction(async tx=>{
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const row=await sessionRow(tx,actor.workspaceId,sessionId),current=await owner(tx,actor,row.caseId,this.clock);
    const stored=await this.savedRecap(tx,actor,row);if(!stored||stored.version!==version)throw new AppError("CONFLICT");
    const recap=decodedRecap(stored,actor,row,this.ring),selected=[...new Set(recipientIds)].sort();
    if(!selected.length||selected.length>8)throw new AppError("INVALID_REQUEST");
    const allowed=await routineRecipientRows(tx,actor,row.caseId);if(selected.some(id=>!allowed.some(account=>account.accountId===id)))throw new AppError("NOT_FOUND");
    await assertRecapFactsCurrent(tx,actor,row,recap,this.clock.now());
    await assertRecapPracticeRecipients(tx,current,row.caseId,recap.practices,selected,this.ring,this.clock.now());
    return recapSharePreviewSchema.parse({recap,digest:shareDigest(recap,selected),recipients:recipientNames(allowed.filter(account=>selected.includes(account.accountId)),actor,this.ring)});
  });}
  async publication(actor:Actor,sessionId:string,publicationId:string):Promise<RecapPublication>{return this.store.transaction(async tx=>{
    await tx.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY");
    const row=await sessionRow(tx,actor.workspaceId,sessionId);await owner(tx,actor,row.caseId,this.clock);
    return this.publicationView(tx,actor,row,publicationId);
  });}
  private async publicationView(tx:SqlSession,actor:Actor,row:SessionRow,publicationId:string):Promise<RecapPublication>{
    const publication=await one<{id:string;version:number;sharedAt:Date;approvedDigest:string;bodyCiphertext:string;contentDigest:string}>(tx,`SELECT p.id,r.version,p.shared_at AS "sharedAt",p.approved_audience_digest AS "approvedDigest",
      r.body_ciphertext AS "bodyCiphertext",r.content_digest AS "contentDigest"
      FROM ls_sessions.publications p JOIN ls_sessions.routine_recap_versions r
      ON r.workspace_id=p.workspace_id AND r.case_id=p.case_id AND r.session_id=p.session_id AND r.version=p.recap_version
      WHERE p.workspace_id=$1 AND p.case_id=$2 AND p.session_id=$3 AND p.id=$4`,[actor.workspaceId,row.caseId,row.sessionId,publicationId]);
    if(!publication)throw new AppError("NOT_FOUND");
    const recipients=await tx.query<{id:string}>('SELECT account_id AS id FROM ls_sessions.publication_recipients WHERE workspace_id=$1 AND case_id=$2 AND publication_id=$3 ORDER BY account_id LIMIT 9',[actor.workspaceId,row.caseId,publicationId]);
    if(!recipients.length||recipients.length>8)throw new AppError("UNAVAILABLE");
    const recap=decodedRecap(publication,actor,row,this.ring),recipientAccountIds=recipients.map(account=>account.id);
    if(shareDigest(recap,recipientAccountIds)!==publication.approvedDigest)throw new AppError("UNAVAILABLE");
    return recapPublicationSchema.parse({publicationId,sessionId:row.sessionId,caseId:row.caseId,sharedAt:publication.sharedAt.toISOString(),contentDigest:publication.approvedDigest,recipientAccountIds,recap});
  }
  async saveRecap(actor:Actor,sessionId:string,input:Omit<RecapDraftInput,"focus">&{focus:readonly BroadFocus[];practices:readonly SharedPractice[]},key:string):Promise<{recap:RoutineRecap;digest:string}>{return this.store.transaction(async tx=>{
    await lockWorkspace(tx,actor.workspaceId);const row=await sessionRow(tx,actor.workspaceId,sessionId,true),current=await owner(tx,actor,row.caseId,this.clock);
    // Preserve the original request digest/replay recipe, including old empty-practice calls.
    return command(tx,this.ring,actor,row,"save_recap",key,input,async()=>{
      const {practices,...fields}=input,parsed=recapDraftSchema.safeParse(fields);
      if(practices.length||!parsed.success)throw new AppError("INVALID_REQUEST");
      const prior=await this.savedRecap(tx,actor,row);if((prior?.version??0)!==input.expectedVersion)throw new AppError("CONFLICT");
      const facts=await recapFacts(tx,actor,row,this.clock.now()),approvedPractices=await reviewedNativeRecapPractices(tx,current,row.caseId,parsed.data.practiceSelections??[],this.ring,this.clock.now()),version=(prior?.version??0)+1;
      const recap=recapFromReviewedFields({sessionId,caseId:row.caseId,version,locale:parsed.data.locale,attendance:facts.attendance,focus:parsed.data.focus,approvedPractices,reviewedNextStep:parsed.data.nextStep,nextAppointment:facts.nextAppointment});
      const contentDigest=digest(recap);
      await tx.query('INSERT INTO ls_sessions.routine_recap_versions(workspace_id,case_id,session_id,version,locale,body_ciphertext,content_digest,reviewed_by_account_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[actor.workspaceId,row.caseId,sessionId,version,input.locale,sealJson(recap,aad("recap",actor.workspaceId,row.caseId,sessionId,version),this.ring),contentDigest,actor.id]);
      return {recap,digest:contentDigest};
    });
  });}

  async share(actor:Actor,sessionId:string,input:{expectedVersion:number;expectedDigest:string;recipientAccountIds:readonly string[]},key:string):Promise<{sharedAt:string;publicationId:string}>{return this.store.transaction(async tx=>{
    await lockWorkspace(tx,actor.workspaceId);const row=await sessionRow(tx,actor.workspaceId,sessionId,true),current=await owner(tx,actor,row.caseId,this.clock),recipients=[...new Set(input.recipientAccountIds)].sort();
    return command(tx,this.ring,actor,row,"share_recap",key,{...input,recipientAccountIds:recipients},async()=>{
      const stored=await this.savedRecap(tx,actor,row);if(!stored||stored.version!==input.expectedVersion)throw new AppError("CONFLICT");
      const recap=decodedRecap(stored,actor,row,this.ring),allowed=await routineRecipientRows(tx,actor,row.caseId),expected=shareDigest(recap,recipients);
      if(!recipients.length||recipients.length>8||recipients.some(id=>!allowed.some(account=>account.accountId===id))||input.expectedDigest!==expected)throw new AppError("NOT_FOUND");
      // Workspace serialization plus exact publication identity prevents a reload
      // or another idempotency key from creating a second publication/outbox event.
      const prior=await one<{id:string}>(tx,'SELECT id FROM ls_sessions.publications WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 AND recap_version=$4 AND approved_audience_digest=$5 ORDER BY shared_at,id LIMIT 1',[actor.workspaceId,row.caseId,sessionId,stored.version,expected]);
      if(prior){const recorded=await this.publicationView(tx,actor,row,prior.id);if(recorded.recipientAccountIds.join()!==recipients.join())throw new AppError("UNAVAILABLE");return {sharedAt:recorded.sharedAt,publicationId:recorded.publicationId};}
      await assertRecapFactsCurrent(tx,actor,row,recap,this.clock.now());
      await assertRecapPracticeRecipients(tx,current,row.caseId,recap.practices,recipients,this.ring,this.clock.now());
      const publicationId=randomUUID(),sharedAt=this.clock.now();
      await tx.query('INSERT INTO ls_sessions.publications(workspace_id,case_id,session_id,id,recap_version,approved_audience_digest,shared_by_account_id,shared_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[actor.workspaceId,row.caseId,sessionId,publicationId,stored.version,expected,actor.id,sharedAt]);
      for(const accountId of recipients)await tx.query('INSERT INTO ls_sessions.publication_recipients(workspace_id,case_id,publication_id,account_id) VALUES($1,$2,$3,$4)',[actor.workspaceId,row.caseId,publicationId,accountId]);
      await tx.query("INSERT INTO ls_sessions.publication_events(workspace_id,case_id,publication_id,event_type,state,created_at) VALUES($1,$2,$3,'routine_recap_shared','pending',$4)",[actor.workspaceId,row.caseId,publicationId,sharedAt]);
      return {sharedAt:sharedAt.toISOString(),publicationId};
    });
  });}
}
