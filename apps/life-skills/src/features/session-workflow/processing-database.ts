import { randomUUID } from "node:crypto";
import { z } from "zod";
import { AppError } from "../../lib/errors.ts";
import { caseAccess } from "../cases/policy.ts";
import { loadCase, loadGuardians } from "../cases/data.ts";
import { freshActor, lockWorkspace } from "../identity/data.ts";
import { seal, unseal, type Keyring } from "../identity/crypto.ts";
import { one, type IdentityStore, type SqlSession } from "../identity/store.ts";
import type { Actor, IdentityClock } from "../identity/types.ts";
import type { Lease, ProcessingStore, TranscriptReceipt } from "./processing.ts";
import type { ProcessingJob, Transcript, PrivateAnalysis } from "./types.ts";
import { WorkflowError } from "./policy.ts";
import { cleanWhitespace, transcriptDigest, validateAnalysis, validateCleanSegments, validateTranscript, validateTranscriptionCompletion, type TranscriptionCompletion } from "./transcript.ts";
import { privateRecordAad, readPrivateAnalysis, readPrivateTranscript, sealPrivateRecord, type StoredAnalysisRow, type StoredTranscriptRow } from "./private-records.ts";

type JobRow = Omit<ProcessingJob,"providerRequestId"|"sourceDurationMs"> & {
  sessionId:string; practitionerAccountId:string; durationMs:number;
  providerRequestCiphertext:string|null; leaseOwner:string|null; leaseUntil:Date|null; fence:string;
};
const uuid=z.string().uuid(),version=z.number().int().min(1).max(2147483647);
const patchSchema=z.strictObject({
  state:z.enum(["queued","transcribing","transcript_saved","analyzing","ready","failed","canceled"]).optional(),
  audioState:z.enum(["temporary","delete_pending","deleted","deletion_failed"]).optional(),
  transcriptVersion:version.nullable().optional(),transcriptDigest:z.string().regex(/^[a-f0-9]{64}$/).nullable().optional(),
  providerRequestId:z.string().trim().min(1).max(200).nullable().optional(),
  failureCode:z.string().regex(/^[A-Z][A-Z0-9_]{0,99}$/).nullable().optional(),transcriptCompleteVerified:z.boolean().optional(),
});
export interface ProcessingAnalysisProvenance { locale:"en"|"he"; promptVersion:string; modelVersion:string; }
const provenanceSchema=z.strictObject({locale:z.enum(["en","he"]),promptVersion:z.string().trim().min(1).max(200),modelVersion:z.string().trim().min(1).max(200)});
const jobColumns=`j.id,j.workspace_id AS "workspaceId",j.case_id AS "caseId",j.session_id AS "sessionId",
 s.appointment_id AS "appointmentId",s.practitioner_account_id AS "practitionerAccountId",
 j.consent_id AS "consentId",j.consent_version AS "consentVersion",j.source_digest AS "sourceDigest",
 j.duration_milliseconds AS "durationMs",j.transcript_complete_verified AS "transcriptCompleteVerified",
 j.state,j.audio_state AS "audioState",j.transcript_version AS "transcriptVersion",j.transcript_digest AS "transcriptDigest",
 j.attempt_id AS "attemptId",j.provider_request_id_ciphertext AS "providerRequestCiphertext",j.failure_code AS "failureCode",
 j.revision,j.lease_owner AS "leaseOwner",j.lease_until AS "leaseUntil",j.fence::text AS fence`;

/** Existing processing port backed by the existing private database. Construction activates no worker or provider. */
export class PostgresSessionProcessingStore implements ProcessingStore {
  private readonly provenance:ProcessingAnalysisProvenance;
  constructor(private readonly store:IdentityStore,private readonly ring:Keyring,private readonly actor:Actor,
    private readonly clock:IdentityClock,provenance:ProcessingAnalysisProvenance){
    const parsed=provenanceSchema.safeParse(provenance);if(!parsed.success)throw new AppError("INVALID_REQUEST");this.provenance=parsed.data;
  }
  private now(){const now=this.clock.now();if(!Number.isFinite(now.getTime()))throw new AppError("UNAVAILABLE");return now;}
  private async row(tx:SqlSession,id:string,lock=true):Promise<JobRow>{
    if(!uuid.safeParse(id).success)throw new AppError("NOT_FOUND");
    const row=await one<JobRow>(tx,`SELECT ${jobColumns} FROM ls_sessions.recording_jobs j
     JOIN ls_sessions.sessions s ON s.workspace_id=j.workspace_id AND s.case_id=j.case_id AND s.id=j.session_id
     WHERE j.workspace_id=$1 AND j.id=$2 ${lock?"FOR UPDATE OF j":""}`,[this.actor.workspaceId,id]);
    if(!row)throw new AppError("NOT_FOUND");return row;
  }
  private async permission(tx:SqlSession,row:JobRow){
    const current=await freshActor(tx,this.actor,this.now());
    if(current.role!=="practitioner"||row.practitionerAccountId!==current.id)throw new AppError("NOT_FOUND");
    caseAccess(current,await loadCase(tx,current.workspaceId,row.caseId as never),await loadGuardians(tx,current.workspaceId,row.caseId as never),"write");
    const consent=await one<{id:string;version:number;eligible:boolean}>(tx,`SELECT rc.id,rc.version,
      (rc.withdrawn_at IS NULL AND rc.signed_at<=$3 AND rc.authority_state='checked'
       AND rc.recording_allowed AND rc.transcription_allowed AND rc.ai_processing_allowed
       AND a.state='active' AND ((a.role='parent' AND cp.kind='minor' AND rc.child_informed
        AND g.account_id IS NOT NULL AND g.revoked_at IS NULL)
        OR (a.role='adult_client' AND cp.kind='adult' AND sub.person_id=cl.person_id))) AS eligible
      FROM ls_sessions.recording_consents rc
      JOIN ls_cases.cases c ON c.workspace_id=rc.workspace_id AND c.id=rc.case_id
      JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id
      JOIN ls_identity.people cp ON cp.workspace_id=cl.workspace_id AND cp.id=cl.person_id
      JOIN ls_identity.accounts a ON a.workspace_id=rc.workspace_id AND a.id=rc.signed_by_account_id
      JOIN ls_identity.account_subjects sub ON sub.workspace_id=a.workspace_id AND sub.account_id=a.id
      LEFT JOIN ls_cases.case_guardians g ON g.workspace_id=rc.workspace_id AND g.case_id=rc.case_id AND g.account_id=a.id
      WHERE rc.workspace_id=$1 AND rc.case_id=$2 ORDER BY rc.version DESC LIMIT 1`,[current.workspaceId,row.caseId,this.now()]);
    if(!consent?.eligible||consent.id!==row.consentId||consent.version!==row.consentVersion)throw new WorkflowError("RECORDING_CONSENT_REQUIRED");
  }
  private providerAad(row:JobRow){return `session:provider-request:${row.workspaceId}:${row.caseId}:${row.id}:1`;}
  private job(row:JobRow):ProcessingJob{
    return {id:row.id,workspaceId:row.workspaceId,caseId:row.caseId,appointmentId:row.appointmentId,
      consentId:row.consentId,consentVersion:row.consentVersion,sourceDigest:row.sourceDigest,sourceDurationMs:row.durationMs,
      transcriptCompleteVerified:row.transcriptCompleteVerified,state:row.state,audioState:row.audioState,
      transcriptVersion:row.transcriptVersion,transcriptDigest:row.transcriptDigest,attemptId:row.attemptId,
      providerRequestId:row.providerRequestCiphertext?unseal(row.providerRequestCiphertext,this.providerAad(row),this.ring):null,
      failureCode:row.failureCode,revision:row.revision};
  }
  private async fenced(tx:SqlSession,lease:Lease,permission=true):Promise<JobRow>{
    const row=await this.row(tx,lease.job.id),parts=lease.fencingToken.split(":");
    if(parts.length!==2||!uuid.safeParse(parts[0]).success||!/^\d+$/.test(parts[1]??"")
      ||row.leaseOwner!==parts[0]||row.fence!==parts[1]||!row.leaseUntil||row.leaseUntil.getTime()<=this.now().getTime())throw new WorkflowError("PROCESSING_LEASE_LOST");
    if(lease.job.workspaceId!==row.workspaceId||lease.job.caseId!==row.caseId||lease.job.appointmentId!==row.appointmentId
      ||lease.job.consentId!==row.consentId||lease.job.consentVersion!==row.consentVersion
      ||lease.job.sourceDigest!==row.sourceDigest||lease.job.sourceDurationMs!==row.durationMs||lease.job.attemptId!==row.attemptId)throw new WorkflowError("PROCESSING_LEASE_LOST");
    if(permission)await this.permission(tx,row);return row;
  }
  private transaction<T>(work:(tx:SqlSession)=>Promise<T>){return this.store.transaction(async tx=>{await lockWorkspace(tx,this.actor.workspaceId);return work(tx);});}
  async claim(jobId:string):Promise<Lease|null>{return this.transaction(async tx=>{
    const row=await this.row(tx,jobId);await this.permission(tx,row);
    if(row.state==="ready"||row.state==="canceled"||row.leaseUntil&&row.leaseUntil.getTime()>this.now().getTime())return null;
    const owner=randomUUID(),fence=(BigInt(row.fence)+1n).toString(),until=new Date(this.now().getTime()+300000);
    await tx.query('UPDATE ls_sessions.recording_jobs SET lease_owner=$3,lease_until=$4,fence=$5,revision=revision+1 WHERE workspace_id=$1 AND id=$2',[row.workspaceId,row.id,owner,until,fence]);
    const current=await this.row(tx,row.id);return {job:this.job(current),fencingToken:`${owner}:${fence}`};
  });}
  async assertCurrentPermission(lease:Lease):Promise<void>{await this.transaction(async tx=>{await this.fenced(tx,lease);});}
  async checkpoint(lease:Lease,input:Parameters<ProcessingStore["checkpoint"]>[1]):Promise<void>{
    const parsed=patchSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");const patch=parsed.data;
    await this.transaction(async tx=>{
      const row=await this.fenced(tx,lease);
      if(patch.transcriptVersion!==undefined&&patch.transcriptVersion!==row.transcriptVersion
        ||patch.transcriptDigest!==undefined&&patch.transcriptDigest!==row.transcriptDigest
        ||patch.transcriptCompleteVerified!==undefined&&patch.transcriptCompleteVerified!==row.transcriptCompleteVerified)throw new WorkflowError("TRANSCRIPT_SAVE_REQUIRED");
      if(patch.state==="transcribing"&&(row.transcriptVersion!==null||!["queued","failed"].includes(row.state)||row.failureCode==="PROVIDER_OUTCOME_UNKNOWN"))throw new WorkflowError("PROVIDER_OUTCOME_UNKNOWN");
      if(patch.state==="analyzing"&&(!row.transcriptCompleteVerified||row.audioState!=="deleted"||row.state==="analyzing"||row.failureCode==="ANALYSIS_OUTCOME_UNKNOWN"))throw new WorkflowError("ANALYSIS_OUTCOME_UNKNOWN");
      if(patch.state!==undefined&&!["transcribing","transcript_saved","analyzing"].includes(patch.state))throw new AppError("INVALID_REQUEST");
      if(patch.state==="transcript_saved"&&!row.transcriptCompleteVerified)throw new WorkflowError("TRANSCRIPT_SAVE_REQUIRED");
      if(patch.audioState!==undefined){
        if(patch.audioState==="temporary"||!row.transcriptCompleteVerified)throw new WorkflowError("TRANSCRIPT_SAVE_REQUIRED");
        await this.transcript(tx,row);
        if(row.audioState==="deleted"&&patch.audioState!=="deleted")throw new WorkflowError("AUDIO_ALREADY_DELETED");
      }
      const provider=patch.providerRequestId===undefined?row.providerRequestCiphertext:patch.providerRequestId===null?null:seal(patch.providerRequestId,this.providerAad(row),this.ring);
      if(patch.providerRequestId!==undefined&&patch.providerRequestId!==this.job(row).providerRequestId)throw new WorkflowError("TRANSCRIPT_SAVE_REQUIRED");
      await tx.query(`UPDATE ls_sessions.recording_jobs SET state=$3,audio_state=$4,failure_code=$5,
        provider_request_id_ciphertext=$6,audio_deleted_at=CASE WHEN $4='deleted' THEN coalesce(audio_deleted_at,$7) ELSE NULL END,
        revision=revision+1 WHERE workspace_id=$1 AND id=$2`,[row.workspaceId,row.id,patch.state??row.state,patch.audioState??row.audioState,
        patch.failureCode===undefined?row.failureCode:patch.failureCode,provider,this.now()]);
      lease.job=this.job(await this.row(tx,row.id));
    });
  }
  private async transcript(tx:SqlSession,row:JobRow):Promise<Transcript>{
    const saved=await one<StoredTranscriptRow>(tx,`SELECT t.version,t.job_id AS "jobId",t.source_ciphertext AS "sourceCiphertext",
      t.cleaned_ciphertext AS "cleanedCiphertext",t.speaker_mapping_ciphertext AS "speakerMappingCiphertext",t.content_digest AS "contentDigest",
      t.source_kind AS "sourceKind",t.created_at AS "createdAt",j.transcript_complete_verified AS "completeVerified",
      j.transcript_version AS "jobTranscriptVersion",j.transcript_digest AS "jobTranscriptDigest",j.source_digest AS "sourceDigest",
      j.duration_milliseconds AS "durationMs",j.completion_receipt_ciphertext AS "completionReceiptCiphertext"
      FROM ls_sessions.transcripts t JOIN ls_sessions.recording_jobs j ON j.workspace_id=t.workspace_id AND j.case_id=t.case_id
        AND j.session_id=t.session_id AND j.id=t.job_id
      WHERE t.workspace_id=$1 AND t.case_id=$2 AND t.session_id=$3 AND t.job_id=$4 AND t.version=$5`,[row.workspaceId,row.caseId,row.sessionId,row.id,row.transcriptVersion]);
    if(!saved)throw new WorkflowError("TRANSCRIPT_SAVE_REQUIRED");
    return readPrivateTranscript(saved,row,this.ring).transcript;
  }
  async saveTranscript(lease:Lease,transcript:Transcript,cleaned:ReturnType<typeof cleanWhitespace>,requestId:string,completion:TranscriptionCompletion):Promise<TranscriptReceipt>{
    validateTranscript(transcript);validateCleanSegments(transcript,cleaned);
    const expected=cleanWhitespace(transcript);
    if(cleaned.some((segment,index)=>segment.sourceSegmentId!==expected[index]?.sourceSegmentId||segment.text!==expected[index]?.text))throw new WorkflowError("CLEAN_TRANSCRIPT_SOURCE_CHANGED");
    if(!z.string().trim().min(1).max(200).safeParse(requestId).success)throw new AppError("INVALID_REQUEST");
    return this.transaction(async tx=>{
      const row=await this.fenced(tx,lease);validateTranscriptionCompletion(transcript,completion,row.durationMs,row.sourceDigest);
      const digest=transcriptDigest(transcript);
      if(row.transcriptVersion!==null){
        if(row.transcriptVersion!==transcript.version||row.transcriptDigest!==digest||this.job(row).providerRequestId!==requestId)throw new AppError("CONFLICT");
        await this.transcript(tx,row);return {version:transcript.version,digest,durable:true,completeVerified:true};
      }
      if(row.state!=="transcribing")throw new WorkflowError("TRANSCRIPTION_NOT_STARTED");
      const maximum=await one<{version:number}>(tx,'SELECT coalesce(max(version),0)::integer AS version FROM ls_sessions.transcripts WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3',[row.workspaceId,row.caseId,row.sessionId]);
      if(!version.safeParse(transcript.version).success||transcript.version!==(maximum?.version??0)+1)throw new AppError("CONFLICT");
      const source=sealPrivateRecord(transcript,privateRecordAad("transcript",row,transcript.version),this.ring),clean=sealPrivateRecord(cleaned,privateRecordAad("cleaned-transcript",row,transcript.version),this.ring);
      const receipt=sealPrivateRecord(completion,privateRecordAad("transcript-completion",row,1,row.id),this.ring),provider=seal(requestId,this.providerAad(row),this.ring);
      await tx.query(`INSERT INTO ls_sessions.transcripts(workspace_id,case_id,session_id,job_id,version,source_ciphertext,cleaned_ciphertext,content_digest,source_kind)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,'machine_transcript')`,[row.workspaceId,row.caseId,row.sessionId,row.id,transcript.version,source,clean,digest]);
      await tx.query(`UPDATE ls_sessions.recording_jobs SET state='transcript_saved',transcript_version=$3,transcript_digest=$4,
       transcript_complete_verified=true,completion_receipt_ciphertext=$5,provider_request_id_ciphertext=$6,
       audio_state='delete_pending',failure_code=NULL,revision=revision+1 WHERE workspace_id=$1 AND id=$2`,[row.workspaceId,row.id,transcript.version,digest,receipt,provider]);
      const saved=await this.row(tx,row.id);await this.transcript(tx,saved);lease.job=this.job(saved);
      return {version:transcript.version,digest,durable:true,completeVerified:true};
    });
  }
  async readTranscript(lease:Lease):Promise<Transcript>{return this.transaction(async tx=>this.transcript(tx,await this.fenced(tx,lease)));}
  async saveAnalysis(lease:Lease,analysis:PrivateAnalysis):Promise<void>{await this.transaction(async tx=>{
    const row=await this.fenced(tx,lease),transcript=await this.transcript(tx,row);validateAnalysis(analysis,transcript);
    if(analysis.locale!==this.provenance.locale||row.state!=="analyzing"||row.audioState!=="deleted")throw new AppError("CONFLICT");
    const latest=await one<{revision:number}>(tx,'SELECT coalesce(max(revision),0)::integer AS revision FROM ls_sessions.private_analyses WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 AND locale=$4',[row.workspaceId,row.caseId,row.sessionId,analysis.locale]);
    const revision=(latest?.revision??0)+1;if(!version.safeParse(revision).success)throw new AppError("UNAVAILABLE");
    await tx.query(`INSERT INTO ls_sessions.private_analyses(workspace_id,case_id,session_id,transcript_version,locale,revision,body_ciphertext,prompt_version,model_version)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[row.workspaceId,row.caseId,row.sessionId,transcript.version,analysis.locale,revision,
      sealPrivateRecord(analysis,privateRecordAad("analysis",row,`${analysis.locale}:${revision}`),this.ring),this.provenance.promptVersion,this.provenance.modelVersion]);
    await this.analysis(tx,row);
    // Analysis persistence and ready are atomic: a crash before complete cannot buy analysis again.
    await tx.query("UPDATE ls_sessions.recording_jobs SET state='ready',failure_code=NULL,revision=revision+1 WHERE workspace_id=$1 AND id=$2",[row.workspaceId,row.id]);
    lease.job=this.job(await this.row(tx,row.id));
  });}
  private async analysis(tx:SqlSession,row:JobRow){
    const saved=await one<StoredAnalysisRow>(tx,`SELECT transcript_version AS "transcriptVersion",locale,revision,body_ciphertext AS "bodyCiphertext",
      prompt_version AS "promptVersion",model_version AS "modelVersion",created_at AS "createdAt" FROM ls_sessions.private_analyses
      WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 AND transcript_version=$4 AND locale=$5 ORDER BY revision DESC LIMIT 1`,[row.workspaceId,row.caseId,row.sessionId,row.transcriptVersion,this.provenance.locale]);
    if(!saved||saved.promptVersion!==this.provenance.promptVersion||saved.modelVersion!==this.provenance.modelVersion)throw new WorkflowError("ANALYSIS_SAVE_REQUIRED");
    readPrivateAnalysis(saved,row,this.ring,await this.transcript(tx,row),this.provenance.locale);
  }
  async complete(lease:Lease):Promise<void>{await this.transaction(async tx=>{
    const row=await this.fenced(tx,lease);if(row.state!=="ready"||row.audioState!=="deleted")throw new WorkflowError("ANALYSIS_SAVE_REQUIRED");await this.analysis(tx,row);
  });}
  async fail(lease:Lease,code:string):Promise<void>{
    if(!/^[A-Z][A-Z0-9_]{0,99}$/.test(code))throw new AppError("INVALID_REQUEST");
    await this.transaction(async tx=>{const row=await this.fenced(tx,lease,false);if(row.state==="ready"||row.state==="canceled")return;
      await tx.query("UPDATE ls_sessions.recording_jobs SET state='failed',failure_code=$3,revision=revision+1 WHERE workspace_id=$1 AND id=$2",[row.workspaceId,row.id,code]);});
  }
  async release(lease:Lease):Promise<void>{await this.transaction(async tx=>{
    const row=await this.row(tx,lease.job.id),parts=lease.fencingToken.split(":");
    if(parts.length!==2||row.leaseOwner!==parts[0]||row.fence!==parts[1])return;
    await tx.query('UPDATE ls_sessions.recording_jobs SET lease_owner=NULL,lease_until=NULL WHERE workspace_id=$1 AND id=$2',[row.workspaceId,row.id]);
  });}
}
