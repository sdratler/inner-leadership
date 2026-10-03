import { afterEach, expect, test } from "vitest";
import { createHash, randomUUID } from "node:crypto";
import { fixture, poolStore, type Fixture } from "../calendar/fixture.ts";
import { SessionDatabaseService } from "../../../src/features/session-workflow/database.ts";
import { PostgresSessionProcessingStore } from "../../../src/features/session-workflow/processing-database.ts";
import { processSession, type Lease, type ProcessingPorts } from "../../../src/features/session-workflow/processing.ts";
import { systemClock } from "../../../src/features/identity/types.ts";
import { seal } from "../../../src/features/identity/crypto.ts";
import { cleanWhitespace, transcriptDigest } from "../../../src/features/session-workflow/transcript.ts";
import type { Transcript, PrivateAnalysis } from "../../../src/features/session-workflow/types.ts";
const opened:Fixture[]=[];afterEach(async()=>{await Promise.all(opened.splice(0).map(f=>f.pool.end()));});
const sourceBytes=Buffer.from("DEMO — isolated synthetic audio bytes"),sourceDigest=createHash("sha256").update(sourceBytes).digest("hex");
const transcript:Transcript={version:1,durationMs:60000,languages:["en","he"],source:"machine_transcript",segments:[{id:"s1",speaker:"speaker_1",startMs:0,endMs:60000,text:"DEMO  —  synthetic private source. מקור סינתטי בלבד."}]};
const analysis:PrivateAnalysis={schemaVersion:1,locale:"en",transcriptVersion:1,summary:[{text:"DEMO synthetic private summary",evidence:[{segmentId:"s1",quote:"synthetic private source"}]}],observations:[],possibleInterpretations:[],nextSessionTopics:[],limitations:["DEMO isolated provider fixture; no actual transcription or AI call."]};
const completion={sourceDigest,sourceDurationMs:60000,coveredDurationMs:60000,expectedChunks:1,completedChunks:1,providerCompleted:true as const};
const provenance={locale:"en" as const,promptVersion:"DEMO-prompt-v1",modelVersion:"DEMO-provider-fixture-v1"};
async function prepared(){
  const f=await fixture();opened.push(f);const service=new SessionDatabaseService(poolStore(f.pool),f.keyring,systemClock);
  const sessionId=(await service.ensureForAppointment(f.practitioner.actor,f.first.id,await f.seed(f.at(-24)))).sessionId;
  const consent=await service.recordConsent(f.practitioner.actor,sessionId,{signedByAccountId:f.parent.actor.id,signedAt:f.at(-48),authorityState:"checked",recordingAllowed:true,transcriptionAllowed:true,aiProcessingAllowed:true,childInformed:true,policyVersion:"DEMO-recording-v1",evidence:"DEMO synthetic standing consent",expectedVersion:0},randomUUID());
  const id=randomUUID(),attempt=randomUUID();await f.pool.query(`INSERT INTO ls_sessions.recording_jobs(workspace_id,case_id,session_id,id,consent_id,consent_version,source_digest,source_bytes,duration_milliseconds,object_reference_ciphertext,state,audio_state,attempt_id,raw_expires_at)
   VALUES($1,$2,$3,$4,$5,$6,$7,$8,60000,$9,'queued','temporary',$10,clock_timestamp()+interval '1 hour')`,[f.workspaceId,f.first.id,sessionId,id,consent.consentId,consent.version,sourceDigest,sourceBytes.length,seal("DEMO isolated restricted object reference",`DEMO-object:${id}`,f.keyring),attempt]);
  const store=new PostgresSessionProcessingStore(poolStore(f.pool),f.keyring,f.practitioner.actor,systemClock,provenance);
  return {f,service,sessionId,id,consent,store};
}
async function saved(s:Awaited<ReturnType<typeof prepared>>,lease:Lease){await s.store.checkpoint(lease,{state:"transcribing"});return s.store.saveTranscript(lease,transcript,cleanWhitespace(transcript),"DEMO-provider-complete-receipt",completion);}
test("native recording lease has one owner, expiry fencing and immutable source scope",async()=>{
  const s=await prepared(),claims=await Promise.all([s.store.claim(s.id),s.store.claim(s.id)]);expect(claims.filter(Boolean)).toHaveLength(1);const lease=claims.find(Boolean)!;
  await s.store.assertCurrentPermission(lease);await expect(s.store.readTranscript({...lease,job:{...lease.job,caseId:s.f.second.id}})).rejects.toMatchObject({code:"PROCESSING_LEASE_LOST"});
  await s.f.pool.query("UPDATE ls_sessions.recording_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.id]);
  const newer=(await s.store.claim(s.id))!;expect(newer.fencingToken).not.toBe(lease.fencingToken);
  await expect(s.store.checkpoint(lease,{state:"transcribing"})).rejects.toMatchObject({code:"PROCESSING_LEASE_LOST"});await s.store.release(lease);expect(await s.store.claim(s.id)).toBeNull();
  await s.store.release(newer);expect(await s.store.claim(s.id)).not.toBeNull();
},30000);
test("native complete transcript, cleaned source, encrypted receipt and exact job pointer commit atomically",async()=>{
  const s=await prepared(),lease=(await s.store.claim(s.id))!,receipt=await saved(s,lease);expect(receipt).toEqual({version:1,digest:transcriptDigest(transcript),durable:true,completeVerified:true});
  expect(await s.store.readTranscript(lease)).toEqual(transcript);expect(await s.store.saveTranscript(lease,transcript,cleanWhitespace(transcript),"DEMO-provider-complete-receipt",completion)).toEqual(receipt);
  const raw=(await s.f.pool.query("SELECT * FROM ls_sessions.recording_jobs WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.id])).rows[0];expect(raw).toMatchObject({state:"transcript_saved",audio_state:"delete_pending",transcript_complete_verified:true,transcript_version:1,transcript_digest:receipt.digest});
  expect(raw.provider_request_id_ciphertext).not.toContain("DEMO-provider");expect(raw.completion_receipt_ciphertext).not.toContain(sourceDigest);
  const native=(await s.f.pool.query("SELECT * FROM ls_sessions.transcripts WHERE workspace_id=$1 AND job_id=$2",[s.f.workspaceId,s.id])).rows;expect(native).toHaveLength(1);for(const field of ["source_ciphertext","cleaned_ciphertext"])expect(native[0][field]).not.toContain("synthetic private source");
  const detail=await s.service.detail(s.f.practitioner.actor,s.sessionId);expect(detail.transcript).toEqual(transcript);expect(detail.privateRecords?.transcript?.cleaned).toEqual(cleanWhitespace(transcript));expect(detail.analysis).toBeNull();
  await expect(s.store.saveTranscript(lease,{...transcript,segments:[{...transcript.segments[0]!,text:"changed"}]},[{sourceSegmentId:"s1",text:"changed"}],"DEMO-provider-complete-receipt",completion)).rejects.toMatchObject({code:"CONFLICT"});
},30000);
test("partial completion, bad cleaning and premature audio deletion never create a qualifying transcript",async()=>{
  const s=await prepared(),lease=(await s.store.claim(s.id))!;await s.store.checkpoint(lease,{state:"transcribing"});
  for(const change of [{completedChunks:0},{coveredDurationMs:400},{sourceDigest:"a".repeat(64)}])await expect(s.store.saveTranscript(lease,transcript,cleanWhitespace(transcript),"DEMO-receipt",{...completion,...change})).rejects.toBeDefined();
  await expect(s.store.saveTranscript(lease,transcript,[{sourceSegmentId:"s1",text:"invented"}],"DEMO-receipt",completion)).rejects.toBeDefined();
  await expect(s.store.checkpoint(lease,{audioState:"deleted"})).rejects.toMatchObject({code:"TRANSCRIPT_SAVE_REQUIRED"});await expect(s.store.checkpoint(lease,{transcriptCompleteVerified:true})).rejects.toMatchObject({code:"TRANSCRIPT_SAVE_REQUIRED"});
  expect((await s.f.pool.query("SELECT count(*)::integer AS n FROM ls_sessions.transcripts WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].n).toBe(0);expect((await s.service.detail(s.f.practitioner.actor,s.sessionId)).processing.audioState).toBe("temporary");
},30000);
test("transaction failure rolls back transcript and receipt; corrupt committed readback blocks cleanup",async()=>{
  const s=await prepared(),lease=(await s.store.claim(s.id))!;await s.store.checkpoint(lease,{state:"transcribing"});
  const original=poolStore(s.f.pool),fault=new PostgresSessionProcessingStore({transaction:work=>original.transaction(tx=>work({query:async(statement,values)=>{if(statement.includes("SET state='transcript_saved'"))throw Error("DEMO synthetic transaction fault");return tx.query(statement,values);}}))},s.f.keyring,s.f.practitioner.actor,systemClock,provenance);
  await expect(fault.saveTranscript(lease,transcript,cleanWhitespace(transcript),"DEMO-receipt",completion)).rejects.toThrow("DEMO synthetic transaction fault");
  expect((await s.f.pool.query("SELECT count(*)::integer AS n FROM ls_sessions.transcripts WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].n).toBe(0);
  await s.store.saveTranscript(lease,transcript,cleanWhitespace(transcript),"DEMO-receipt",completion);
  await s.f.pool.query("UPDATE ls_sessions.transcripts SET cleaned_ciphertext='corrupt' WHERE workspace_id=$1 AND job_id=$2",[s.f.workspaceId,s.id]);
  await expect(s.store.readTranscript(lease)).rejects.toMatchObject({code:"UNAVAILABLE"});await expect(s.store.checkpoint(lease,{audioState:"deleted"})).rejects.toMatchObject({code:"UNAVAILABLE"});
  expect((await s.service.list(s.f.practitioner.actor,s.f.first.id))[0]?.audioState).toBe("delete_pending");
},30000);
test("worker rechecks active practitioner, current case and exact standing consent before committing",async()=>{
  const s=await prepared(),lease=(await s.store.claim(s.id))!;await s.store.checkpoint(lease,{state:"transcribing"});
  const denied=new PostgresSessionProcessingStore(poolStore(s.f.pool),s.f.keyring,s.f.parent.actor,systemClock,provenance);await expect(denied.claim(s.id)).rejects.toMatchObject({code:"NOT_FOUND"});
  await s.service.withdrawConsent(s.f.practitioner.actor,s.sessionId,s.consent.version,randomUUID());await expect(s.store.saveTranscript(lease,transcript,cleanWhitespace(transcript),"DEMO-receipt",completion)).rejects.toMatchObject({code:"RECORDING_CONSENT_REQUIRED"});
  expect((await s.f.pool.query("SELECT count(*)::integer AS n FROM ls_sessions.transcripts WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].n).toBe(0);await s.store.fail(lease,"RECORDING_CONSENT_REQUIRED");await s.store.release(lease);
  await s.f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.f.practitioner.actor.id]);await expect(s.store.claim(s.id)).rejects.toBeDefined();
},30000);
test("saved transcript cleanup retry uses native readback without another transcription, then private analysis is durable",async()=>{
  const s=await prepared();let calls=0,deletions=0,analyzed=0;const reserved:string[]=[],events:string[]=[];
  const ports:ProcessingPorts={store:s.store,budget:{reserve:async(id,phase)=>{reserved.push(id+":"+phase);}},audio:{readVerified:async()=>{events.push("audio-read");return Uint8Array.from(sourceBytes);},deleteAndVerify:async()=>{deletions++;const persisted=await s.service.detail(s.f.practitioner.actor,s.sessionId);expect(persisted.transcript).toEqual(transcript);events.push("verified-transcript-before-audio-delete");if(deletions===1)throw Error("DEMO temporary cleanup fault");return "deleted";}},transcriber:{transcribe:async input=>{calls++;expect(createHash("sha256").update(input.bytes).digest("hex")).toBe(sourceDigest);return {transcript,requestId:"DEMO-transcription-receipt",completion};}},analyst:{analyze:async source=>{analyzed++;expect(source).toEqual(transcript);expect((await s.service.detail(s.f.practitioner.actor,s.sessionId)).processing.audioState).toBe("deleted");events.push("analysis-after-audio-delete");return analysis;}}};
  expect(await processSession(s.id,ports)).toEqual({status:"failed",code:"AUDIO_DELETION_FAILED"});expect(calls).toBe(1);expect(analyzed).toBe(0);expect((await s.service.detail(s.f.practitioner.actor,s.sessionId)).processing.audioState).toBe("deletion_failed");
  expect(await processSession(s.id,ports)).toEqual({status:"private_analysis_ready"});expect(calls).toBe(1);expect(deletions).toBe(2);expect(analyzed).toBe(1);expect(reserved.filter(x=>x.endsWith(":transcription"))).toHaveLength(1);
  expect(events.indexOf("analysis-after-audio-delete")).toBeGreaterThan(events.indexOf("verified-transcript-before-audio-delete"));const detail=await s.service.detail(s.f.practitioner.actor,s.sessionId);expect(detail.analysis).toEqual(analysis);expect(detail.privateRecords?.analysis).toMatchObject(provenance);expect(detail.processing).toMatchObject({state:"ready",audioState:"deleted"});
  expect(await processSession(s.id,ports)).toEqual({status:"already_running_or_complete"});expect(analyzed).toBe(1);for(const table of ["publications","routine_recap_versions","practitioner_observations"])expect((await s.f.pool.query(`SELECT count(*)::integer AS n FROM ls_sessions.${table} WHERE workspace_id=$1`,[s.f.workspaceId])).rows[0].n).toBe(0);
},30000);
test("unknown provider outcome cannot be reset into a second purchase; ready analysis survives completion crash",async()=>{
  const s=await prepared(),lease=(await s.store.claim(s.id))!;await s.store.checkpoint(lease,{state:"transcribing"});await s.store.fail(lease,"PROVIDER_OUTCOME_UNKNOWN");await s.store.release(lease);
  const retry=(await s.store.claim(s.id))!;await expect(s.store.checkpoint(retry,{state:"transcribing",failureCode:null})).rejects.toMatchObject({code:"PROVIDER_OUTCOME_UNKNOWN"});await s.store.release(retry);
  const ready=await prepared(),owned=(await ready.store.claim(ready.id))!;await saved(ready,owned);await ready.store.checkpoint(owned,{audioState:"deleted"});await ready.store.checkpoint(owned,{state:"analyzing"});await ready.store.saveAnalysis(owned,analysis);
  // Simulated process death after the atomic analysis save, before complete/release.
  await ready.f.pool.query("UPDATE ls_sessions.recording_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE workspace_id=$1 AND id=$2",[ready.f.workspaceId,ready.id]);
  expect(await ready.store.claim(ready.id)).toBeNull();expect((await ready.service.detail(ready.f.practitioner.actor,ready.sessionId)).analysis).toEqual(analysis);
},30000);
test("complete saved-audio cleanup survives consent withdrawal without granting processing or private customer access",async()=>{
  const s=await prepared(),lease=(await s.store.claim(s.id))!;await saved(s,lease);await s.store.checkpoint(lease,{audioState:"deletion_failed"});await s.store.fail(lease,"AUDIO_DELETION_FAILED");await s.store.release(lease);
  await s.service.withdrawConsent(s.f.practitioner.actor,s.sessionId,s.consent.version,randomUUID());
  await expect(s.store.claim(s.id)).rejects.toMatchObject({code:"RECORDING_CONSENT_REQUIRED"});
  let deleted=0;const audio={deleteAndVerify:async(owned:Lease)=>{deleted++;expect(owned.job.sourceDigest).toBe(sourceDigest);expect(owned.job.transcriptCompleteVerified).toBe(true);return "already_absent" as const;}};
  const parent=new PostgresSessionProcessingStore(poolStore(s.f.pool),s.f.keyring,s.f.parent.actor,systemClock,provenance);
  await expect(parent.cleanupSavedAudio(s.id,audio)).rejects.toMatchObject({code:"NOT_FOUND"});expect(deleted).toBe(0);
  expect(await s.store.cleanupSavedAudio(s.id,audio)).toEqual({status:"audio_deleted"});expect(deleted).toBe(1);
  const detail=await s.service.detail(s.f.practitioner.actor,s.sessionId);expect(detail.processing).toMatchObject({audioState:"deleted",permissionToRecord:false,state:"failed"});expect(detail.analysis).toBeNull();
  expect(await s.store.cleanupSavedAudio(s.id,audio)).toEqual({status:"no_pending_or_already_running"});expect(deleted).toBe(1);
  await expect(s.store.claim(s.id)).rejects.toMatchObject({code:"RECORDING_CONSENT_REQUIRED"});
},30000);
test("cleanup-only path denies partial/corrupt source and retries deletion without altering provider state",async()=>{
  const s=await prepared();let deleted=0;const audio={deleteAndVerify:async()=>{deleted++;return "deleted" as const;}};
  await expect(s.store.cleanupSavedAudio(s.id,audio)).rejects.toMatchObject({code:"TRANSCRIPT_SAVE_REQUIRED"});expect(deleted).toBe(0);
  const lease=(await s.store.claim(s.id))!;await saved(s,lease);await s.store.release(lease);
  expect(await s.store.cleanupSavedAudio(s.id,{deleteAndVerify:async()=>{throw Error("DEMO cleanup-only fault");}})).toEqual({status:"audio_deletion_failed"});
  expect((await s.service.detail(s.f.practitioner.actor,s.sessionId)).processing).toMatchObject({state:"transcript_saved",audioState:"deletion_failed"});
  await s.f.pool.query("UPDATE ls_sessions.transcripts SET source_ciphertext='corrupt' WHERE workspace_id=$1 AND job_id=$2",[s.f.workspaceId,s.id]);
  await expect(s.store.cleanupSavedAudio(s.id,audio)).rejects.toMatchObject({code:"UNAVAILABLE"});expect(deleted).toBe(0);
  await s.f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE workspace_id=$1 AND id=$2",[s.f.workspaceId,s.f.practitioner.actor.id]);
  await expect(s.store.cleanupSavedAudio(s.id,audio)).rejects.toBeDefined();expect(deleted).toBe(0);
},30000);
