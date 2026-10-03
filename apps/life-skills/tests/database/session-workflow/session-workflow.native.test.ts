import {afterEach,expect,test} from "vitest";
import {randomBytes,randomUUID} from "node:crypto";
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {SessionDatabaseService} from "../../../src/features/session-workflow/database.ts";
import {blankMetrics,metricSeries,validateObservationEvidence} from "../../../src/features/session-workflow/metrics.ts";
import {sessionCommandInput} from "../../../src/features/session-workflow/command-input.ts";
import {SessionHttp} from "../../../src/features/session-workflow/http.ts";
import {IdentitySessions} from "../../../src/features/identity/session-adapter.ts";
import {PostgresIdentityRateStore} from "../../../src/features/identity/rate-store.ts";
import {durableAuditSink} from "../../../src/features/identity/history.ts";
import type {IdentityConfig} from "../../../src/features/identity/config.ts";
import {SESSION_COOKIE} from "../../../src/lib/security/session.ts";
import {systemClock} from "../../../src/features/identity/types.ts";
import {unseal} from "../../../src/features/identity/crypto.ts";
import {privateRecordAad,sealPrivateRecord,unsealPrivateRecord} from "../../../src/features/session-workflow/private-records.ts";
import {transcriptDigest,cleanWhitespace} from "../../../src/features/session-workflow/transcript.ts";
import type {Transcript,PrivateAnalysis} from "../../../src/features/session-workflow/types.ts";
const opened:Fixture[]=[];afterEach(async()=>{await Promise.all(opened.splice(0).map(item=>item.pool.end()));});
const scopedInput=(f:Fixture)=>({recipient:"DEMO — Synthetic authorized school contact",purpose:"Synthetic agreed classroom support",topic:"Only the agreed grounding practice",authorityBasis:"DEMO — Actual synthetic signed scope, authority checked and no restrictions recorded. Not a legal certificate.",authorityState:"checked" as const,channel:"phone" as const,authorizedByAccountId:f.parent.actor.id,childDiscussionRecorded:true,authorizedAt:f.at(-24),expiresAt:f.at(24)});
test("the bounded disclosure history rejects its 101st record atomically while replay, reading, use and revocation remain available",async()=>{
 const s=await httpFixture(),sessionId=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId,path=`/${sessionId}/disclosures`,input=scopedInput(s.f);
 for(let index=0;index<99;index++)await s.service.authorizeDisclosure(s.f.practitioner.actor,sessionId,{...input,recipient:`DEMO — Synthetic recipient ${index}`},randomUUID());
 const attempts=[randomUUID(),randomUUID()].map(key=>({key,input:{...input,recipient:`DEMO — Synthetic capacity ${key}`}}));
 const outcomes=await Promise.all(attempts.map(async attempt=>({attempt,response:await s.http.handle(s.request(path,attempt.input,s.f.practitioner.token,attempt.key),[sessionId,"disclosures"])})));
 expect(outcomes.map(result=>result.response.status).sort()).toEqual([201,409]);
 const accepted=outcomes.find(result=>result.response.status===201)!,denied=outcomes.find(result=>result.response.status===409)!,receipt=(await accepted.response.json()).data;
 const replay=await s.http.handle(s.request(path,accepted.attempt.input,s.f.practitioner.token,accepted.attempt.key),[sessionId,"disclosures"]);expect(replay.status).toBe(201);expect((await replay.json()).data).toEqual(receipt);
 const stored=async()=>(await s.f.pool.query('SELECT * FROM ls_sessions.disclosure_authorizations WHERE workspace_id=$1 AND case_id=$2 AND session_id=$3 ORDER BY id',[s.f.workspaceId,s.f.first.id,sessionId])).rows;
 const before=await stored();expect(before).toHaveLength(100);
 const retryDenied=await s.http.handle(s.request(path,denied.attempt.input,s.f.practitioner.token,denied.attempt.key),[sessionId,"disclosures"]);expect(retryDenied.status).toBe(409);expect(await stored()).toEqual(before);
 expect((await s.f.pool.query("SELECT count(*)::integer AS n FROM ls_sessions.command_receipts WHERE workspace_id=$1 AND operation='authorize_disclosure'",[s.f.workspaceId])).rows[0].n).toBe(100);
 expect((await s.f.pool.query("SELECT count(*)::integer AS n FROM ls_sessions.command_receipts WHERE workspace_id=$1 AND idempotency_key=$2",[s.f.workspaceId,denied.attempt.key])).rows[0].n).toBe(0);
 const read=await s.http.handle(s.request(path),[sessionId,"disclosures"]);expect(read.status).toBe(200);expect((await read.json()).data).toHaveLength(100);
 const usedAt=s.f.at(-1),used=await s.service.recordDisclosureUse(s.f.practitioner.actor,sessionId,receipt.disclosureId,{usedAt},randomUUID());expect(used.usedAt).toBe(usedAt);
 await s.service.revokeDisclosure(s.f.practitioner.actor,sessionId,receipt.disclosureId,{expectedUsedAt:usedAt},randomUUID());
 const after=await s.service.disclosures(s.f.practitioner.actor,sessionId);expect(after).toHaveLength(100);expect(after.find(item=>item.id===receipt.disclosureId)).toMatchObject({usedAt,effective:false});
 expect((await stored()).filter(row=>row.id!==receipt.disclosureId)).toEqual(before.filter(row=>row.id!==receipt.disclosureId));
},60_000);
test("real scoped disclosure writers preserve encrypted scope, exact readback, replay, use and revocation without delivery",async()=>{
 const s=await httpFixture(),sessionId=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId,path=`/${sessionId}/disclosures`,input=scopedInput(s.f),key=randomUUID();
 const first=await s.http.handle(s.request(path,input,s.f.practitioner.token,key),[sessionId,"disclosures"]);expect(first.status).toBe(201);const receipt=(await first.json()).data;
 const replay=await s.http.handle(s.request(path,input,s.f.practitioner.token,key),[sessionId,"disclosures"]);expect((await replay.json()).data).toEqual(receipt);
 const read=await s.http.handle(s.request(`${path}?disclosureId=${receipt.disclosureId}`),[sessionId,"disclosures"]);expect(read.status).toBe(200);expect(read.headers.get("cache-control")).toBe("private, no-store");const saved=(await read.json()).data[0];expect(saved).toMatchObject({...input,id:receipt.disclosureId,workspaceId:s.f.workspaceId,caseId:s.f.first.id,sessionId,recordedByPractitionerId:s.f.practitioner.actor.id,effective:true,usedAt:null,revokedAt:null});
 const before=(await s.f.pool.query('SELECT * FROM ls_sessions.disclosure_authorizations WHERE workspace_id=$1 AND id=$2',[s.f.workspaceId,receipt.disclosureId])).rows[0];for(const field of ['recipient_ciphertext','purpose_ciphertext','topic_ciphertext','authority_evidence_ciphertext'])expect(before[field]).not.toContain('Synthetic');
 const use={usedAt:s.f.at(-1)},useKey=randomUUID(),useParts=[sessionId,"disclosures",receipt.disclosureId,"use"],usePath=`${path}/${receipt.disclosureId}/use`;
 for(let attempt=0;attempt<2;attempt++){const result=await s.http.handle(s.request(usePath,use,s.f.practitioner.token,useKey),useParts);expect(result.status).toBe(201);expect((await result.json()).data).toMatchObject({disclosureId:receipt.disclosureId,usedAt:use.usedAt,revokedAt:null});}
 expect((await s.service.disclosures(s.f.practitioner.actor,sessionId,receipt.disclosureId))[0]).toMatchObject({usedAt:use.usedAt,effective:false});
 expect((await s.http.handle(s.request(usePath,use),useParts)).status).toBe(409);
 const revokeKey=randomUUID(),revokePath=`${path}/${receipt.disclosureId}/revoke`,revokeParts=[sessionId,"disclosures",receipt.disclosureId,"revoke"];
 expect((await s.http.handle(s.request(revokePath,{expectedUsedAt:null}),revokeParts)).status).toBe(409);
 const revoked=await s.http.handle(s.request(revokePath,{expectedUsedAt:use.usedAt},s.f.practitioner.token,revokeKey),revokeParts);expect(revoked.status).toBe(201);const revokedReceipt=(await revoked.json()).data;
 expect((await (await s.http.handle(s.request(revokePath,{expectedUsedAt:use.usedAt},s.f.practitioner.token,revokeKey),revokeParts)).json()).data).toEqual(revokedReceipt);
 const after=(await s.f.pool.query('SELECT * FROM ls_sessions.disclosure_authorizations WHERE workspace_id=$1 AND id=$2',[s.f.workspaceId,receipt.disclosureId])).rows[0];expect({...after,used_at:null,revoked_at:null}).toEqual(before);
 expect((await s.f.pool.query('SELECT operation,count(*)::integer AS n FROM ls_sessions.command_receipts WHERE workspace_id=$1 GROUP BY operation ORDER BY operation',[s.f.workspaceId])).rows).toEqual([{operation:"authorize_disclosure",n:1},{operation:"record_disclosure_use",n:1},{operation:"revoke_disclosure",n:1}]);
 for(const table of ['recording_jobs','publication_events','publications'])expect((await s.f.pool.query(`SELECT count(*)::integer AS n FROM ls_sessions.${table} WHERE workspace_id=$1`,[s.f.workspaceId])).rows[0].n).toBe(0);
},30_000);
test("scoped disclosure authority, expiry, strict queries, CSRF, role/case privacy and concurrency fail closed",async()=>{
 const s=await httpFixture(),id=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId,path=`/${id}/disclosures`,input=scopedInput(s.f);
 for(const change of [{recipient:" "},{authorityBasis:" "},{authorizedAt:s.f.at(1)},{authorizedAt:"2026-02-30T10:00:00Z"},{expiresAt:input.authorizedAt}])await expect(s.service.authorizeDisclosure(s.f.practitioner.actor,id,{...input,...change},randomUUID())).rejects.toMatchObject({code:"INVALID_REQUEST"});
 expect((await s.http.handle(s.request(path,{...input,privateNotes:"never accepted"}),[id,"disclosures"])).status).toBe(400);
 expect((await s.http.handle(s.request(path,input,s.f.practitioner.token,randomUUID(),false),[id,"disclosures"])).status).toBe(403);
 const record=await s.service.authorizeDisclosure(s.f.practitioner.actor,id,input,randomUUID()),parts=[id,"disclosures",record.disclosureId,"use"],usePath=`${path}/${record.disclosureId}/use`;
 for(const usedAt of [s.f.at(1),s.f.at(-48),"2026-02-30T11:00:00Z"])expect((await s.http.handle(s.request(usePath,{usedAt}),parts)).status).toBe(400);
 for(const query of ['?extra=1',`?disclosureId=${record.disclosureId}&disclosureId=${record.disclosureId}`,'?disclosureId=invalid'])expect((await s.http.handle(s.request(path+query),[id,"disclosures"])).status).toBe(400);
 const other=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.second.id,await s.f.seed(s.f.at(48),s.f.second))).sessionId;expect((await s.http.handle(s.request(`/${other}/disclosures?disclosureId=${record.disclosureId}`),[other,"disclosures"])).status).toBe(404);
 for(const role of ["parent","child","adult_client"]){await s.f.pool.query('UPDATE ls_identity.accounts SET role=$2 WHERE id=$1',[s.f.parent.actor.id,role]);for(const [p,body,segments] of [[path,undefined,[id,"disclosures"]],[path,input,[id,"disclosures"]],[usePath,{usedAt:s.f.at(-1)},parts]] as const){const denied=await s.http.handle(s.request(p,body,s.f.parent.token),segments);expect(denied.status).toBe(404);expect(await denied.text()).not.toContain(input.topic);}}
 await s.f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE id=$1",[s.f.parent.actor.id]);
 await s.f.pool.query('UPDATE ls_cases.case_guardians SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3',[s.f.workspaceId,s.f.first.id,input.authorizedByAccountId]);expect((await s.service.disclosures(s.f.practitioner.actor,id,record.disclosureId))[0]?.effective).toBe(false);expect((await s.http.handle(s.request(usePath,{usedAt:s.f.at(-1)}),parts)).status).toBe(409);
 await expect(s.service.authorizeDisclosure(s.f.practitioner.actor,id,input,randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
 const restricted=await s.service.authorizeDisclosure(s.f.practitioner.actor,id,{...input,authorizedByAccountId:s.f.parentTwo.actor.id,authorityState:"restricted"},randomUUID());await expect(s.service.recordDisclosureUse(s.f.practitioner.actor,id,restricted.disclosureId,{usedAt:s.f.at(-1)},randomUUID())).rejects.toMatchObject({code:"CONFLICT"});
 const active=await s.service.authorizeDisclosure(s.f.practitioner.actor,id,{...input,authorizedByAccountId:s.f.parentTwo.actor.id},randomUUID());const results=await Promise.all([s.service.recordDisclosureUse(s.f.practitioner.actor,id,active.disclosureId,{usedAt:s.f.at(-1)},randomUUID()),s.service.recordDisclosureUse(s.f.practitioner.actor,id,active.disclosureId,{usedAt:s.f.at(-2)},randomUUID())].map(p=>p.then(()=>"accepted",error=>error.code)));expect(results.sort()).toEqual(["CONFLICT","accepted"]);
},30_000);
test("native session record keeps observations private and snapshots only current recipients",async()=>{
 const f=await fixture();opened.push(f);const service=new SessionDatabaseService(poolStore(f.pool),f.keyring,systemClock);
 const past=await f.seed(f.at(-24)),future=await f.seed(f.at(48));const ensured=await service.ensureForAppointment(f.practitioner.actor,f.first.id,past);
 expect(await service.ensureForAppointment(f.practitioner.actor,f.first.id,past)).toEqual(ensured);
 await expect(service.list(f.parent.actor,f.first.id)).rejects.toMatchObject({code:"NOT_FOUND"});
 await expect(service.detail(f.outsider.actor,ensured.sessionId)).rejects.toMatchObject({code:"NOT_FOUND"});
 const consentKey=randomUUID(),consentInput={signedByAccountId:f.parent.actor.id,signedAt:new Date().toISOString(),authorityState:"checked" as const,recordingAllowed:true,transcriptionAllowed:true,aiProcessingAllowed:true,childInformed:true,policyVersion:"session-recording-v1",evidence:"Synthetic signed consent evidence",expectedVersion:0},consent=await service.recordConsent(f.practitioner.actor,ensured.sessionId,consentInput,consentKey);
 expect(consent.permissionToRecord).toBe(true);expect(await service.recordConsent(f.practitioner.actor,ensured.sessionId,consentInput,consentKey)).toEqual(consent);
 expect((await service.detail(f.practitioner.actor,ensured.sessionId)).processing.permissionToRecord).toBe(true);
 const withdrawn=await service.withdrawConsent(f.practitioner.actor,ensured.sessionId,consent.version,randomUUID());expect(withdrawn.version).toBe(consent.version+1);expect((await service.detail(f.practitioner.actor,ensured.sessionId)).processing.permissionToRecord).toBe(false);
 const rawConsent=await f.pool.query("SELECT evidence_ciphertext FROM ls_sessions.recording_consents WHERE workspace_id=$1 AND case_id=$2 ORDER BY version LIMIT 1",[f.workspaceId,f.first.id]);expect(rawConsent.rows[0].evidence_ciphertext).not.toContain("Synthetic signed consent evidence");
 const values=blankMetrics();values.engagement={score:7,notObservedReason:null,note:"Synthetic private engagement note"};
 const metricKey=randomUUID(),metric=await service.saveObservations(f.practitioner.actor,ensured.sessionId,values,0,metricKey);
 expect(metric.revision).toBe(1);expect(await service.saveObservations(f.practitioner.actor,ensured.sessionId,values,0,metricKey)).toEqual(metric);
 await expect(service.saveObservations(f.practitioner.actor,ensured.sessionId,{...values,engagement:{score:8,notObservedReason:null,note:"changed"}},0,metricKey)).rejects.toMatchObject({code:"CONFLICT"});
 const raw=await f.pool.query("SELECT values_ciphertext FROM ls_sessions.practitioner_observations WHERE workspace_id=$1 AND session_id=$2",[f.workspaceId,ensured.sessionId]);expect(raw.rows[0].values_ciphertext).not.toContain("Synthetic private engagement note");
 const saved=await service.saveRecap(f.practitioner.actor,ensured.sessionId,{locale:"en",focus:["regulation"],practices:[],nextStep:"Synthetic agreed next step",expectedVersion:0},randomUUID());expect(saved.recap.attendance.state).toBe("unrecorded");expect(saved.recap.nextAppointment?.id).toBe(future);
 const detail=await service.detail(f.practitioner.actor,ensured.sessionId);expect(detail.recipients).toHaveLength(2);expect(detail.recapDigest).toMatch(/^[a-f0-9]{64}$/);
 await f.pool.query("UPDATE ls_cases.case_guardians SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3",[f.workspaceId,f.first.id,f.parentTwo.actor.id]);
 await expect(service.share(f.practitioner.actor,ensured.sessionId,{expectedVersion:1,expectedDigest:detail.recapDigest!,recipientAccountIds:detail.recipients.map(item=>item.accountId)},randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
 const refreshed=await service.detail(f.practitioner.actor,ensured.sessionId),shareKey=randomUUID();expect(refreshed.recipients).toHaveLength(1);
 const shared=await service.share(f.practitioner.actor,ensured.sessionId,{expectedVersion:1,expectedDigest:refreshed.recapDigest!,recipientAccountIds:refreshed.recipients.map(item=>item.accountId)},shareKey);
 expect(await service.share(f.practitioner.actor,ensured.sessionId,{expectedVersion:1,expectedDigest:refreshed.recapDigest!,recipientAccountIds:refreshed.recipients.map(item=>item.accountId)},shareKey)).toEqual(shared);
 const publication=await f.pool.query("SELECT p.id,count(r.account_id)::integer AS recipients,count(e.publication_id)::integer AS events FROM ls_sessions.publications p JOIN ls_sessions.publication_recipients r ON r.workspace_id=p.workspace_id AND r.publication_id=p.id JOIN ls_sessions.publication_events e ON e.workspace_id=p.workspace_id AND e.publication_id=p.id WHERE p.workspace_id=$1 AND p.id=$2 GROUP BY p.id",[f.workspaceId,shared.publicationId]);expect(publication.rows[0]).toMatchObject({recipients:1,events:1});
 expect(await service.sharedRecaps(f.parent.actor,f.first.id)).toHaveLength(1);
 await expect(service.sharedRecaps(f.outsider.actor,f.first.id)).rejects.toMatchObject({code:"NOT_FOUND"});
 await f.pool.query("UPDATE ls_cases.case_guardians SET revoked_at=NULL,granted_at=clock_timestamp() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3",[f.workspaceId,f.first.id,f.parentTwo.actor.id]);
 expect(await service.sharedRecaps(f.parentTwo.actor,f.first.id)).toEqual([]);
},30_000);
test("withdrawal preserves immutable evidence and binds the new ciphertext to its own consent version",async()=>{
 const s=await httpFixture(),id=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId;
 const evidence="Synthetic private consent evidence — ראיה\n".repeat(20),input={signedByAccountId:s.f.parent.actor.id,signedAt:s.f.at(-48),authorityState:"checked" as const,recordingAllowed:true,transcriptionAllowed:true,aiProcessingAllowed:true,childInformed:true,policyVersion:"synthetic-recording-v1",evidence,expectedVersion:0};
 const recorded=await s.service.recordConsent(s.f.practitioner.actor,id,input,randomUUID());
 const before=(await s.f.pool.query("SELECT evidence_ciphertext FROM ls_sessions.recording_consents WHERE workspace_id=$1 AND case_id=$2 AND version=$3",[s.f.workspaceId,s.f.first.id,recorded.version])).rows[0].evidence_ciphertext;
 const key=randomUUID(),withdrawn=await s.service.withdrawConsent(s.f.practitioner.actor,id,recorded.version,key);
 expect(await s.service.withdrawConsent(s.f.practitioner.actor,id,recorded.version,key)).toEqual(withdrawn);
 const stored=await s.f.pool.query("SELECT id,version,evidence_ciphertext,withdrawn_at FROM ls_sessions.recording_consents WHERE workspace_id=$1 AND case_id=$2 ORDER BY version",[s.f.workspaceId,s.f.first.id]);
 expect(stored.rows).toHaveLength(2);expect(stored.rows[0].evidence_ciphertext).toBe(before);
 const decode=(ciphertext:string,caseId:string,version:number)=>{
  const envelope=JSON.parse(ciphertext) as {v:number;chunks:string[]};expect(envelope.v).toBe(1);
  return JSON.parse(Buffer.concat(envelope.chunks.map((chunk,index)=>Buffer.from(unseal(chunk,`session:consent:${s.f.workspaceId}:${caseId}:${recorded.consentId}:${version}:${index}`,s.f.keyring),"base64url"))).toString("utf8"));
 };
 expect(decode(before,s.f.first.id,recorded.version)).toEqual({evidence});
 const latest=stored.rows[1];expect(decode(latest.evidence_ciphertext,s.f.first.id,withdrawn.version)).toEqual({evidence});
 expect(latest.evidence_ciphertext).not.toBe(before);
 expect(()=>decode(latest.evidence_ciphertext,s.f.second.id,withdrawn.version)).toThrow();
 expect(()=>decode(latest.evidence_ciphertext,s.f.first.id,recorded.version)).toThrow();
 for(const row of stored.rows)expect(row.evidence_ciphertext).not.toContain("Synthetic private consent");
 expect(latest.withdrawn_at.toISOString()).toBe(withdrawn.withdrawnAt);
 expect((await s.service.detail(s.f.practitioner.actor,id)).processing.permissionToRecord).toBe(false);
 await expect(s.service.withdrawConsent(s.f.practitioner.actor,id,recorded.version,randomUUID())).rejects.toMatchObject({code:"CONFLICT"});
 await expect(s.service.withdrawConsent(s.f.parent.actor,id,withdrawn.version,key)).rejects.toMatchObject({code:"NOT_FOUND"});
 expect((await s.f.pool.query("SELECT count(*)::integer AS n FROM ls_sessions.recording_jobs WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].n).toBe(0);
},30_000);

test("uppercase real UUID routes/body projection round-trip encrypted values, replay and canonical history",async()=>{
 const s=await httpFixture(),id=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId,path=`/${id.toUpperCase()}/observations`,key=randomUUID(),values=blankMetrics();values.engagement={score:6,notObservedReason:null,note:"Synthetic uppercase deep-link observation"};
 const body=sessionCommandInput(path,{sessionId:id,values,expectedRevision:0}),parts=[id.toUpperCase(),"observations"];
 const first=await s.http.handle(s.request(path,body,s.f.practitioner.token,key),parts);expect(first.status).toBe(201);const saved=(await first.json()).data;expect(saved.sessionId).toBe(id);
 const replay=await s.http.handle(s.request(path,body,s.f.practitioner.token,key),parts);expect(replay.status).toBe(201);expect((await replay.json()).data).toEqual(saved);
 const detail=await s.http.handle(s.request(`/${id.toUpperCase()}`),[id.toUpperCase()]);expect(detail.status).toBe(200);expect((await detail.json()).data.metrics).toEqual(values);
 const history=await s.http.handle(s.request(`/observations?caseId=${s.f.first.id.toUpperCase()}`),["observations"]);expect(history.status).toBe(200);expect((await history.json()).data.records[0]).toEqual(saved);
},30_000);

test("withdrawal rotates to the active key without altering old evidence or replaying another version",async()=>{
 const s=await httpFixture(),id=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId;
 const input={signedByAccountId:s.f.parent.actor.id,signedAt:s.f.at(-48),authorityState:"checked" as const,recordingAllowed:true,transcriptionAllowed:true,aiProcessingAllowed:true,childInformed:true,policyVersion:"synthetic-rotation-v1",evidence:"SYNTHETIC_ROTATION_EVIDENCE",expectedVersion:0};
 const recorded=await s.service.recordConsent(s.f.practitioner.actor,id,input,randomUUID());
 const original=(await s.f.pool.query("SELECT evidence_ciphertext FROM ls_sessions.recording_consents WHERE workspace_id=$1 AND case_id=$2",[s.f.workspaceId,s.f.first.id])).rows[0].evidence_ciphertext;
 const ring={activeKeyId:"rotated",keys:{...s.f.keyring.keys,rotated:randomBytes(32)}},rotated=new SessionDatabaseService(poolStore(s.f.pool),ring,systemClock),key=randomUUID();
 const result=await rotated.withdrawConsent(s.f.practitioner.actor,id,recorded.version,key);
 const stored=(await s.f.pool.query("SELECT version,evidence_ciphertext FROM ls_sessions.recording_consents WHERE workspace_id=$1 AND case_id=$2 ORDER BY version",[s.f.workspaceId,s.f.first.id])).rows;
 expect(stored).toHaveLength(2);expect(stored[0].evidence_ciphertext).toBe(original);
 const chunks=(JSON.parse(stored[1].evidence_ciphertext) as {chunks:string[]}).chunks;
 expect(chunks.every(chunk=>JSON.parse(chunk).kid==="rotated")).toBe(true);
 const decoded=JSON.parse(Buffer.concat(chunks.map((chunk,index)=>Buffer.from(unseal(chunk,`session:consent:${s.f.workspaceId}:${s.f.first.id}:${recorded.consentId}:${result.version}:${index}`,ring),"base64url"))).toString("utf8"));
 expect(decoded).toEqual({evidence:input.evidence});expect(()=>unseal(chunks[0]!,`session:consent:${s.f.workspaceId}:${s.f.first.id}:${recorded.consentId}:${result.version}:0`,s.f.keyring)).toThrow();
 expect(await rotated.withdrawConsent(s.f.practitioner.actor,id,recorded.version,key)).toEqual(result);
 expect((await rotated.detail(s.f.practitioner.actor,id)).processing.permissionToRecord).toBe(false);
},30_000);

test("unverifiable evidence cannot be silently copied or leave a partially committed withdrawal receipt",async()=>{
 const s=await httpFixture(),id=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId;
 const input={signedByAccountId:s.f.parent.actor.id,signedAt:s.f.at(-48),authorityState:"needs_review" as const,recordingAllowed:false,transcriptionAllowed:false,aiProcessingAllowed:false,childInformed:false,policyVersion:"synthetic-unavailable-v1",evidence:"SYNTHETIC_UNAVAILABLE_EVIDENCE",expectedVersion:0};
 const recorded=await s.service.recordConsent(s.f.practitioner.actor,id,input,randomUUID()),key=randomUUID();
 const unavailable=new SessionDatabaseService(poolStore(s.f.pool),{activeKeyId:"other",keys:{other:randomBytes(32)}},systemClock);
 await expect(unavailable.withdrawConsent(s.f.practitioner.actor,id,recorded.version,key)).rejects.toMatchObject({code:"UNAVAILABLE"});
 expect((await s.f.pool.query("SELECT version,withdrawn_at FROM ls_sessions.recording_consents WHERE workspace_id=$1 AND case_id=$2",[s.f.workspaceId,s.f.first.id])).rows).toMatchObject([{version:1,withdrawn_at:null}]);
 expect((await s.f.pool.query("SELECT count(*)::integer AS n FROM ls_sessions.command_receipts WHERE workspace_id=$1 AND operation='withdraw_consent' AND idempotency_key=$2",[s.f.workspaceId,key])).rows[0].n).toBe(0);
 const result=await s.service.withdrawConsent(s.f.practitioner.actor,id,recorded.version,key);expect(result.version).toBe(2);
 expect((await s.service.detail(s.f.practitioner.actor,id)).processing.permissionToRecord).toBe(false);
},30_000);

async function httpFixture(){
 const f=await fixture();opened.push(f);const store=poolStore(f.pool),service=new SessionDatabaseService(store,f.keyring,systemClock),origin="https://synthetic.invalid";
 const config:IdentityConfig={enabled:true,origin,workspaceId:f.workspaceId,csrfKey:randomBytes(32),lookupKey:randomBytes(32),rateLimitKey:randomBytes(32).toString("hex"),keyring:f.keyring,sessionSeconds:28800};
 const sessions=new IdentitySessions(store,config,systemClock),http=new SessionHttp({config,sessions,limits:new PostgresIdentityRateStore(store),audit:durableAuditSink(store),clock:systemClock},service);
 // Native DB-backed sessions and current roles, not password/browser acceptance.
 const request=(path:string,body?:unknown,token=f.practitioner.token,key=randomUUID(),csrf=true)=>new Request(origin+"/api/sessions"+path,{method:body===undefined?"GET":"POST",headers:{cookie:`${SESSION_COOKIE}=${token}`,...(body===undefined?{}:{origin,"content-type":"application/json","idempotency-key":key,...(csrf?{"x-csrf-token":sessions.csrf(token)}:{})})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return {f,service,http,request};
}
async function privateReadFixture(){
 const s=await httpFixture(),sessionId=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId,jobId=randomUUID(),scope={workspaceId:s.f.workspaceId,caseId:s.f.first.id,sessionId};
 const consent=await s.service.recordConsent(s.f.practitioner.actor,sessionId,{signedByAccountId:s.f.parent.actor.id,signedAt:s.f.at(-48),authorityState:"checked",recordingAllowed:true,transcriptionAllowed:true,aiProcessingAllowed:true,childInformed:true,policyVersion:"DEMO-native-read-v1",evidence:"DEMO — Isolated native reader fixture; not provider execution.",expectedVersion:0},randomUUID());
 const transcript:Transcript={source:"machine_transcript",languages:["en","he"],segments:[{id:"s1",speaker:"constructor",startMs:0,endMs:1000,text:"DEMO —  Private source בלבד"}],durationMs:1000,version:1},contentDigest=transcriptDigest(transcript),sourceDigest="a".repeat(64),completion={sourceDigest,sourceDurationMs:1000,coveredDurationMs:1000,expectedChunks:1,completedChunks:1,providerCompleted:true};
 const encode=(kind:Parameters<typeof privateRecordAad>[0],body:unknown,version:number|string=1,identity?:string)=>sealPrivateRecord(body,privateRecordAad(kind,scope,version,identity),s.f.keyring);
 // These exact encrypted rows establish read-path behavior only. They are not
 // evidence of provider transcription, audio deletion or ordinary password login.
 await s.f.pool.query("INSERT INTO ls_sessions.recording_jobs(workspace_id,case_id,session_id,id,consent_id,consent_version,source_digest,source_bytes,duration_milliseconds,object_reference_ciphertext,state,audio_state,attempt_id,transcript_complete_verified,completion_receipt_ciphertext,transcript_version,transcript_digest,raw_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,8,1000,$8,'transcript_saved','delete_pending',$9,true,$10,1,$11,$12)",[scope.workspaceId,scope.caseId,sessionId,jobId,consent.consentId,consent.version,sourceDigest,encode("transcript-completion",{object:"DEMO-local-not-a-storage-object"},1,jobId),randomUUID(),encode("transcript-completion",completion,1,jobId),contentDigest,s.f.at(24)]);
 await s.f.pool.query("INSERT INTO ls_sessions.transcripts(workspace_id,case_id,session_id,job_id,version,source_ciphertext,cleaned_ciphertext,content_digest,speaker_mapping_ciphertext,source_kind) VALUES($1,$2,$3,$4,1,$5,$6,$7,$8,'machine_transcript')",[scope.workspaceId,scope.caseId,sessionId,jobId,encode("transcript",transcript),encode("cleaned-transcript",cleanWhitespace(transcript)),contentDigest,encode("speakers",{constructor:"DEMO — Saved speaker"})]);
 const analysis:PrivateAnalysis={schemaVersion:1,locale:"en",transcriptVersion:1,summary:[{text:"DEMO — Private English summary",evidence:[{segmentId:"s1",quote:"Private source"}]}],observations:[],possibleInterpretations:[],nextSessionTopics:[],limitations:["DEMO — Isolated read proof, not clinical validation."]};
 for(const [locale,revision]of [["en",1],["en",2],["he",1]]as const){const body={...analysis,locale,summary:[{...analysis.summary[0]!,text:locale==="he"?"DEMO — סיכום פרטי בעברית":`DEMO — Private English revision ${revision}`}]};await s.f.pool.query("INSERT INTO ls_sessions.private_analyses(workspace_id,case_id,session_id,transcript_version,locale,revision,body_ciphertext,prompt_version,model_version) VALUES($1,$2,$3,1,$4,$5,$6,'DEMO-prompt-v3','DEMO-model')",[scope.workspaceId,scope.caseId,sessionId,locale,revision,encode("analysis",body,`${locale}:${revision}`)]);}
 return {...s,scope,sessionId,jobId,transcript,encode};
}
test("native speaker corrections preserve immutable source/cleaned/analysis, encrypted baseline/history and exact replay",async()=>{
 const s=await privateReadFixture(),path=`/${s.sessionId}/speakers`,input={transcriptVersion:1,expectedRevision:0,labels:{constructor:"DEMO — Corrected speaker"}},key=randomUUID();
 const snapshot=async()=>({transcripts:(await s.f.pool.query('SELECT * FROM ls_sessions.transcripts WHERE workspace_id=$1',[s.f.workspaceId])).rows,jobs:(await s.f.pool.query('SELECT * FROM ls_sessions.recording_jobs WHERE workspace_id=$1',[s.f.workspaceId])).rows,analyses:(await s.f.pool.query('SELECT * FROM ls_sessions.private_analyses WHERE workspace_id=$1 ORDER BY locale,revision',[s.f.workspaceId])).rows});
 const before=await snapshot();const first=await s.http.handle(s.request(path,input,s.f.practitioner.token,key),[s.sessionId,"speakers"]);expect(first.status).toBe(201);const result=(await first.json()).data;expect(result).toMatchObject({version:1,revision:1});
 const replay=await s.http.handle(s.request(path,input,s.f.practitioner.token,key),[s.sessionId,"speakers"]);expect((await replay.json()).data).toEqual(result);
 let detail=await s.service.detail(s.f.practitioner.actor,s.sessionId);expect(detail.transcript).toEqual(s.transcript);expect(detail.privateRecords?.transcript?.speakers).toEqual(input.labels);expect(detail.privateRecords?.transcript?.speakerHistory).toMatchObject({schemaVersion:1,revision:1,originalLabels:{constructor:"DEMO — Saved speaker"},versions:[{revision:1,recordedAt:result.recordedAt,recordedByAccountId:s.f.practitioner.actor.id,labels:input.labels}]});
 const next={...input,expectedRevision:1,labels:{constructor:"DEMO — Later correction"}},second=await s.service.saveSpeakers(s.f.practitioner.actor,s.sessionId,next,randomUUID());expect(second.revision).toBe(2);expect(await s.service.saveSpeakers(s.f.practitioner.actor,s.sessionId,input,key)).toEqual(result);
 detail=await s.service.detail(s.f.practitioner.actor,s.sessionId,"he");expect(detail.privateRecords?.transcript?.speakerHistory.versions).toHaveLength(2);expect(detail.privateRecords?.transcript?.speakers).toEqual(next.labels);
 const after=await snapshot();expect(after.jobs).toEqual(before.jobs);expect(after.analyses).toEqual(before.analyses);expect({...after.transcripts[0],speaker_mapping_ciphertext:before.transcripts[0].speaker_mapping_ciphertext}).toEqual(before.transcripts[0]);expect(after.transcripts[0].speaker_mapping_ciphertext).not.toContain('Corrected speaker');
 const scope={workspaceId:s.f.workspaceId,caseId:s.f.first.id,sessionId:s.sessionId};expect(unsealPrivateRecord(after.transcripts[0].speaker_mapping_ciphertext,privateRecordAad("speakers",scope,1),s.f.keyring,2000000)).toEqual(detail.privateRecords?.transcript?.speakerHistory);
 expect(()=>unsealPrivateRecord(after.transcripts[0].speaker_mapping_ciphertext,privateRecordAad("speakers",{...scope,caseId:s.f.second.id},1),s.f.keyring,2000000)).toThrow("UNAVAILABLE");
 expect((await s.f.pool.query("SELECT count(*)::integer AS n FROM ls_sessions.command_receipts WHERE workspace_id=$1 AND operation='save_speakers'",[s.f.workspaceId])).rows[0].n).toBe(2);
 for(const table of ['processing_attempts','publications','publication_events'])expect((await s.f.pool.query(`SELECT count(*)::integer AS n FROM ls_sessions.${table} WHERE workspace_id=$1`,[s.f.workspaceId])).rows[0].n).toBe(0);
},30_000);
test("protected speaker readback preserves the saved prior version after a newer transcript without broadening access",async()=>{
 const s=await privateReadFixture(),input={transcriptVersion:1,expectedRevision:0,labels:{constructor:"DEMO — Historical correction"}},key=randomUUID(),receipt=await s.service.saveSpeakers(s.f.practitioner.actor,s.sessionId,input,key);
 const version=2,jobId=randomUUID(),transcript={...s.transcript,version,segments:[{...s.transcript.segments[0]!,text:"DEMO — New transcript"}]},digest=transcriptDigest(transcript),sourceDigest="b".repeat(64),completion={sourceDigest,sourceDurationMs:1000,coveredDurationMs:1000,expectedChunks:1,completedChunks:1,providerCompleted:true};
 await s.f.pool.query("INSERT INTO ls_sessions.recording_jobs(workspace_id,case_id,session_id,id,consent_id,consent_version,source_digest,source_bytes,duration_milliseconds,object_reference_ciphertext,state,audio_state,attempt_id,transcript_complete_verified,completion_receipt_ciphertext,transcript_version,transcript_digest,raw_expires_at) SELECT workspace_id,case_id,session_id,$2,consent_id,consent_version,$3,source_bytes,duration_milliseconds,$4,'transcript_saved','delete_pending',$5,true,$6,2,$7,raw_expires_at FROM ls_sessions.recording_jobs WHERE workspace_id=$1 AND id=$8",[s.f.workspaceId,jobId,sourceDigest,s.encode("transcript-completion",{object:"DEMO-local-only-v2"},1,jobId),randomUUID(),s.encode("transcript-completion",completion,1,jobId),digest,s.jobId]);
 await s.f.pool.query("INSERT INTO ls_sessions.transcripts(workspace_id,case_id,session_id,job_id,version,source_ciphertext,cleaned_ciphertext,content_digest,speaker_mapping_ciphertext,source_kind) VALUES($1,$2,$3,$4,2,$5,$6,$7,$8,'machine_transcript')",[s.f.workspaceId,s.f.first.id,s.sessionId,jobId,s.encode("transcript",transcript,version),s.encode("cleaned-transcript",cleanWhitespace(transcript),version),digest,s.encode("speakers",{constructor:"DEMO — New source"},version)]);
 expect((await s.service.detail(s.f.practitioner.actor,s.sessionId)).transcript?.version).toBe(2);expect(await s.service.saveSpeakers(s.f.practitioner.actor,s.sessionId,input,key)).toEqual(receipt);
 const path=`/${s.sessionId}?transcriptVersion=1`,response=await s.http.handle(s.request(path),[s.sessionId]);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");const saved=(await response.json()).data;expect(saved.transcript).toEqual(s.transcript);expect(saved.privateRecords.transcript.speakerHistory.versions[0]).toMatchObject({revision:receipt.revision,recordedAt:receipt.recordedAt,labels:input.labels});
 for(const query of ['?transcriptVersion=0','?transcriptVersion=-1','?transcriptVersion=1.0','?transcriptVersion=2147483648','?transcriptVersion=1&transcriptVersion=2','?transcriptVersion=1&extra=1'])expect((await s.http.handle(s.request(`/${s.sessionId}`+query),[s.sessionId])).status).toBe(400);
 expect((await s.http.handle(s.request(`/${s.sessionId}?transcriptVersion=99`),[s.sessionId])).status).toBe(404);
 for(const role of ['parent','child','adult_client']){await s.f.pool.query('UPDATE ls_identity.accounts SET role=$2 WHERE id=$1',[s.f.parent.actor.id,role]);expect((await s.http.handle(s.request(path,undefined,s.f.parent.token),[s.sessionId])).status).toBe(404);}
 await expect(s.service.detail(s.f.outsider.actor,s.sessionId)).rejects.toMatchObject({code:"NOT_FOUND"});
 await s.f.pool.query('UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1',[s.f.practitioner.actor.sessionDigest]);expect((await s.http.handle(s.request(path),[s.sessionId])).status).toBe(401);
},30_000);

test("speaker HTTP transport accepts a source-bound long mapping within the encrypted history bound and rejects oversized bytes",async()=>{
 const s=await privateReadFixture(),speakers=Array.from({length:200},(_,index)=>`DEMO-${index}-`+'x'.repeat(85)),transcript={...s.transcript,segments:speakers.map((speaker,index)=>({id:`s${index}`,speaker,startMs:index*5,endMs:(index+1)*5,text:"DEMO — Source-bound long mapping"}))},digest=transcriptDigest(transcript),labels=Object.fromEntries(speakers.map(name=>[name,'ד'.repeat(100)]));
 await s.f.pool.query('UPDATE ls_sessions.transcripts SET source_ciphertext=$2,cleaned_ciphertext=$3,content_digest=$4,speaker_mapping_ciphertext=$5 WHERE workspace_id=$1',[s.f.workspaceId,s.encode("transcript",transcript),s.encode("cleaned-transcript",cleanWhitespace(transcript)),digest,s.encode("speakers",{})]);await s.f.pool.query('UPDATE ls_sessions.recording_jobs SET transcript_digest=$2 WHERE workspace_id=$1',[s.f.workspaceId,digest]);
 const path=`/${s.sessionId}/speakers`,input={transcriptVersion:1,expectedRevision:0,labels},key=randomUUID();expect(Buffer.byteLength(JSON.stringify(input),'utf8')).toBeGreaterThan(16384);
 const response=await s.http.handle(s.request(path,input,s.f.practitioner.token,key),[s.sessionId,"speakers"]);expect(response.status).toBe(201);const receipt=(await response.json()).data;expect((await s.service.detail(s.f.practitioner.actor,s.sessionId)).privateRecords?.transcript?.speakers).toEqual(labels);
 const replay=await s.http.handle(s.request(path,input,s.f.practitioner.token,key),[s.sessionId,"speakers"]);expect((await replay.json()).data).toEqual(receipt);
 const tooLarge=await s.http.handle(s.request(path,{...input,expectedRevision:1,padding:'x'.repeat(2000001)}),[s.sessionId,"speakers"]);expect(tooLarge.status).toBe(413);expect((await tooLarge.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
 expect((await s.f.pool.query("SELECT count(*)::integer AS n FROM ls_sessions.command_receipts WHERE workspace_id=$1 AND operation='save_speakers'",[s.f.workspaceId])).rows[0].n).toBe(1);expect((await s.service.detail(s.f.practitioner.actor,s.sessionId)).privateRecords?.transcript?.speakerHistory.revision).toBe(1);
},30_000);

test("native strict HTTP parsing preserves prototype-named own speaker labels and rejects invalid values",async()=>{
 const s=await privateReadFixture(),transcript={...s.transcript,segments:[{...s.transcript.segments[0]!,speaker:"__proto__"}]},digest=transcriptDigest(transcript);
 await s.f.pool.query('UPDATE ls_sessions.transcripts SET source_ciphertext=$2,content_digest=$3,speaker_mapping_ciphertext=$4 WHERE workspace_id=$1',[s.f.workspaceId,s.encode("transcript",transcript),digest,s.encode("speakers",Object.fromEntries([["__proto__","DEMO — Original own"]]))]);await s.f.pool.query('UPDATE ls_sessions.recording_jobs SET transcript_digest=$2 WHERE workspace_id=$1',[s.f.workspaceId,digest]);
 const path=`/${s.sessionId}/speakers`,parts=[s.sessionId,"speakers"],input={transcriptVersion:1,expectedRevision:0,labels:Object.fromEntries([["__proto__","DEMO — Corrected own"]])};
 expect((await s.http.handle(s.request(path,{...input,labels:Object.fromEntries([["__proto__"," "]])}),parts)).status).toBe(400);
 const result=await s.http.handle(s.request(path,input),parts);expect(result.status).toBe(201);const detail=await s.service.detail(s.f.practitioner.actor,s.sessionId);expect(detail.privateRecords?.transcript?.speakers).toEqual(input.labels);expect(Object.hasOwn(detail.privateRecords!.transcript!.speakerHistory.versions[0]!.labels,"__proto__")).toBe(true);expect(detail.transcript).toEqual(transcript);
},30_000);
test("native speaker strict input, fresh permissions, source/version conflicts, concurrent writes and failed encryption roll back",async()=>{
 const s=await privateReadFixture(),path=`/${s.sessionId}/speakers`,parts=[s.sessionId,"speakers"],input={transcriptVersion:1,expectedRevision:0,labels:{constructor:"DEMO — New"}};
 for(const changed of [{...input,extra:true},{...input,labels:{unknown:"no"}},{...input,labels:{constructor:" "}},{...input,expectedRevision:-1}])expect((await s.http.handle(s.request(path,changed),parts)).status).toBe(400);
 for(const changed of [{...input,transcriptVersion:2},{...input,expectedRevision:1}])expect((await s.http.handle(s.request(path,changed),parts)).status).toBe(409);
 expect((await s.http.handle(s.request(path,input,s.f.practitioner.token,randomUUID(),false),parts)).status).toBe(403);
 for(const role of ['parent','child','adult_client']){await s.f.pool.query('UPDATE ls_identity.accounts SET role=$2 WHERE id=$1',[s.f.parent.actor.id,role]);expect((await s.http.handle(s.request(path,input,s.f.parent.token),parts)).status).toBe(404);}
 await expect(s.service.saveSpeakers(s.f.outsider.actor,s.sessionId,input,randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
 const other=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.second.id,await s.f.seed(s.f.at(-48),s.f.second))).sessionId;await expect(s.service.saveSpeakers(s.f.practitioner.actor,other,input,randomUUID())).rejects.toMatchObject({code:"NOT_FOUND"});
 const original=(await s.f.pool.query('SELECT speaker_mapping_ciphertext FROM ls_sessions.transcripts WHERE workspace_id=$1',[s.f.workspaceId])).rows[0].speaker_mapping_ciphertext;
 const unavailable=new SessionDatabaseService(poolStore(s.f.pool),{activeKeyId:"wrong",keys:{wrong:randomBytes(32)}},systemClock);await expect(unavailable.saveSpeakers(s.f.practitioner.actor,s.sessionId,input,randomUUID())).rejects.toMatchObject({code:"UNAVAILABLE"});expect((await s.f.pool.query('SELECT speaker_mapping_ciphertext FROM ls_sessions.transcripts WHERE workspace_id=$1',[s.f.workspaceId])).rows[0].speaker_mapping_ciphertext).toBe(original);
 const race=await Promise.all([input,{...input,labels:{constructor:"DEMO — Other"}}].map(body=>s.service.saveSpeakers(s.f.practitioner.actor,s.sessionId,body,randomUUID()).then(()=>"accepted",error=>error.code)));expect(race.sort()).toEqual(["CONFLICT","accepted"]);
 await s.f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE id=$1",[s.f.practitioner.actor.id]);expect((await s.http.handle(s.request(path,{...input,expectedRevision:1}),parts)).status).toBe(404);
 await s.f.pool.query("UPDATE ls_identity.accounts SET role='practitioner' WHERE id=$1",[s.f.practitioner.actor.id]);await s.f.pool.query('UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1',[s.f.practitioner.actor.sessionDigest]);expect((await s.http.handle(s.request(path,{...input,expectedRevision:1}),parts)).status).toBe(401);
},30_000);
test("native protected detail returns exact durable transcript/cleaned/speakers and latest requested analysis without writes",async()=>{
 const s=await privateReadFixture(),path=`/${s.sessionId}`;
 const snapshot=async()=>({transcripts:(await s.f.pool.query('SELECT * FROM ls_sessions.transcripts WHERE workspace_id=$1 ORDER BY version',[s.f.workspaceId])).rows,jobs:(await s.f.pool.query('SELECT * FROM ls_sessions.recording_jobs WHERE workspace_id=$1 ORDER BY id',[s.f.workspaceId])).rows,analysis:(await s.f.pool.query('SELECT * FROM ls_sessions.private_analyses WHERE workspace_id=$1 ORDER BY locale,revision',[s.f.workspaceId])).rows});
 const before=await snapshot();
 for(const [query,locale,revision]of [["","en",2],["?analysisLocale=en","en",2],["?analysisLocale=he","he",1]]as const){const response=await s.http.handle(s.request(path+query),[s.sessionId]);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");const saved=(await response.json()).data;expect(JSON.stringify(saved.transcript)).toBe(JSON.stringify(s.transcript));expect(saved.privateRecords).toMatchObject({analysisLocale:locale,transcript:{completeVerified:true,version:1,speakers:{constructor:"DEMO — Saved speaker"},cleaned:[{sourceSegmentId:"s1",text:"DEMO — Private source בלבד"}]},analysis:{locale,revision,transcriptVersion:1,promptVersion:"DEMO-prompt-v3",modelVersion:"DEMO-model"}});expect(saved.analysis.locale).toBe(locale);for(const field of ["Ciphertext","object_reference","providerRequestId","completionReceiptCiphertext"])expect(JSON.stringify(saved)).not.toContain(field);expect(saved.processing.audioState).toBe("delete_pending");}
 expect(await snapshot()).toEqual(before);
 await s.f.pool.query("DELETE FROM ls_sessions.private_analyses WHERE workspace_id=$1 AND locale='he'",[s.f.workspaceId]);const missing=await s.service.detail(s.f.practitioner.actor,s.sessionId,"he");expect(missing.analysis).toBeNull();expect(missing.privateRecords?.analysis).toBeNull();expect(missing.transcript).toEqual(s.transcript);
 for(const table of ['publications','publication_events','processing_attempts'])expect((await s.f.pool.query(`SELECT count(*)::integer AS n FROM ls_sessions.${table} WHERE workspace_id=$1`,[s.f.workspaceId])).rows[0].n).toBe(0);
},30_000);
test("native private reader rejects query tricks and fresh customer/cross-family/revoked-role access without leaking source",async()=>{
 const s=await privateReadFixture(),path=`/${s.sessionId}`;
 for(const query of ['?analysisLocale=fr','?analysisLocale=','?analysisLocale=he&analysisLocale=en','?analysisLocale=en&extra=1','?caseId='+s.f.second.id])expect((await s.http.handle(s.request(path+query),[s.sessionId])).status).toBe(400);
 for(const role of ['parent','child','adult_client']){await s.f.pool.query('UPDATE ls_identity.accounts SET role=$2 WHERE id=$1',[s.f.parent.actor.id,role]);const response=await s.http.handle(s.request(path+'?analysisLocale=he',undefined,s.f.parent.token),[s.sessionId]);expect(response.status).toBe(404);expect(await response.text()).not.toContain('Private source');}
 const otherSession=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.second.id,await s.f.seed(s.f.at(-48),s.f.second))).sessionId;expect((await s.service.detail(s.f.practitioner.actor,otherSession)).transcript).toBeNull();
 await s.f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE id=$1",[s.f.practitioner.actor.id]);expect((await s.http.handle(s.request(path),[s.sessionId])).status).toBe(404);
 await s.f.pool.query("UPDATE ls_identity.accounts SET role='practitioner' WHERE id=$1",[s.f.practitioner.actor.id]);await s.f.pool.query('UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1',[s.f.practitioner.actor.sessionDigest]);expect((await s.http.handle(s.request(path),[s.sessionId])).status).toBe(401);
},30_000);
test("native damaged/incomplete source is unavailable, never empty or a mismatched analysis",async()=>{
 const s=await privateReadFixture(),path=`/${s.sessionId}`,request=()=>s.http.handle(s.request(path),[s.sessionId]);
 const original=(await s.f.pool.query('SELECT * FROM ls_sessions.transcripts WHERE workspace_id=$1',[s.f.workspaceId])).rows[0];
 await s.f.pool.query('UPDATE ls_sessions.transcripts SET source_ciphertext=$2 WHERE workspace_id=$1',[s.f.workspaceId,s.encode("transcript",{...s.transcript,durationMs:2000})]);expect((await request()).status).toBe(503);
 await s.f.pool.query('UPDATE ls_sessions.transcripts SET source_ciphertext=$2 WHERE workspace_id=$1',[s.f.workspaceId,original.source_ciphertext]);expect((await request()).status).toBe(200);
 await s.f.pool.query('UPDATE ls_sessions.recording_jobs SET transcript_complete_verified=false WHERE workspace_id=$1',[s.f.workspaceId]);expect((await request()).status).toBe(503);
 await s.f.pool.query('UPDATE ls_sessions.recording_jobs SET transcript_complete_verified=true WHERE workspace_id=$1',[s.f.workspaceId]);expect((await request()).status).toBe(200);
 await s.f.pool.query('UPDATE ls_sessions.transcripts SET cleaned_ciphertext=$2 WHERE workspace_id=$1',[s.f.workspaceId,s.encode("cleaned-transcript",[])]);expect((await request()).status).toBe(503);
 await s.f.pool.query('UPDATE ls_sessions.transcripts SET cleaned_ciphertext=$2 WHERE workspace_id=$1',[s.f.workspaceId,original.cleaned_ciphertext]);expect((await request()).status).toBe(200);
 await s.f.pool.query("UPDATE ls_sessions.private_analyses SET body_ciphertext=$2 WHERE workspace_id=$1 AND locale='en' AND revision=2",[s.f.workspaceId,'not-a-ciphertext']);expect((await request()).status).toBe(503);expect((await s.http.handle(s.request(path+'?analysisLocale=he'),[s.sessionId])).status).toBe(200);
},30_000);
test("later pending recording does not hide the previous verified transcript or imply deleted audio",async()=>{
 const s=await privateReadFixture(),job=(await s.f.pool.query('SELECT * FROM ls_sessions.recording_jobs WHERE workspace_id=$1',[s.f.workspaceId])).rows[0];
 await s.f.pool.query("INSERT INTO ls_sessions.recording_jobs(workspace_id,case_id,session_id,id,consent_id,consent_version,source_digest,source_bytes,duration_milliseconds,object_reference_ciphertext,state,audio_state,attempt_id,created_at,raw_expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,8,1000,$8,'queued','temporary',$9,$10,$11)",[s.f.workspaceId,s.scope.caseId,s.sessionId,randomUUID(),job.consent_id,job.consent_version,'b'.repeat(64),job.object_reference_ciphertext,randomUUID(),s.f.at(1),s.f.at(25)]);
 const detail=await s.service.detail(s.f.practitioner.actor,s.sessionId);expect(detail.transcript).toEqual(s.transcript);expect(detail.privateRecords?.analysis?.revision).toBe(2);expect(detail.processing).toMatchObject({state:'queued',audioState:'temporary'});
},30_000);
test("exact Calendar appointment is filtered before the bounded session list without granting or creating a record",async()=>{
 const s=await httpFixture();
 // Extend only this disposable fixture so its genuine Calendar constraint
 // admits synthetic historical appointments; no production rule is changed.
 await s.f.pool.query("INSERT INTO ls_calendar.availability(id,workspace_id,practitioner_id,starts_at,ends_at,kind) VALUES($1,$2,$3,$4,$5,'open')",[randomUUID(),s.f.workspaceId,s.f.practitioner.actor.id,s.f.at(-24*141),s.f.at(-24*139)]);
 const old=await s.f.seed(s.f.at(-24*140));
 for(let hour=120;hour>=20;hour--)await s.f.seed(s.f.at(-hour));
 const recent=await s.service.list(s.f.practitioner.actor,s.f.first.id);
 expect(recent).toHaveLength(100);expect(recent.some(item=>item.appointmentId===old)).toBe(false);
 const path=`?appointmentId=${old.toUpperCase()}&caseId=${s.f.first.id.toUpperCase()}`;
 const response=await s.http.handle(s.request(path),[]);expect(response.status).toBe(200);
 expect((await response.json()).data).toMatchObject([{appointmentId:old,sessionId:null,startsAt:s.f.at(-24*140)}]);
 expect((await s.f.pool.query('SELECT count(*)::int AS n FROM ls_sessions.sessions WHERE workspace_id=$1',[s.f.workspaceId])).rows[0].n).toBe(0);
 const ensured=await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,old);
 const reloaded=await s.http.handle(s.request(path),[]);expect(reloaded.status).toBe(200);
 expect((await reloaded.json()).data).toMatchObject([{appointmentId:old,sessionId:ensured.sessionId}]);
 expect((await s.service.detail(s.f.practitioner.actor,ensured.sessionId)).appointments.some(item=>item.id===old)).toBe(true);
 const other=await s.f.seed(s.f.at(48),s.f.second);
 const wrong=await s.http.handle(s.request(`?caseId=${s.f.first.id}&appointmentId=${other}`),[]);expect(wrong.status).toBe(200);expect((await wrong.json()).data).toEqual([]);
 for(const query of [`?caseId=${s.f.first.id}&appointmentId=${old}&extra=1`,`?caseId=${s.f.first.id}&appointmentId=${old}&appointmentId=${old}`,`?caseId=${s.f.first.id}&caseId=${s.f.first.id}&appointmentId=${old}`,`?caseId=${s.f.first.id}&appointmentId=invalid`,`?caseId=${s.f.first.id}&appointmentId=`])expect((await s.http.handle(s.request(query),[])).status).toBe(400);
 for(const role of ['parent','child','adult_client']){await s.f.pool.query('UPDATE ls_identity.accounts SET role=$2 WHERE id=$1',[s.f.parent.actor.id,role]);expect((await s.http.handle(s.request(path,undefined,s.f.parent.token),[])).status).toBe(404);}
 const foreign=await httpFixture();expect((await s.http.handle(s.request(`?caseId=${foreign.f.first.id}&appointmentId=${old}`),[])).status).toBe(404);
 await s.f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE id=$1",[s.f.practitioner.actor.id]);expect((await s.http.handle(s.request(path),[])).status).toBe(404);
},30_000);

test("current recording permission requires the actual consent signer to retain current case authority",async()=>{
 const s=await httpFixture(),sessionId=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId;
 const input={signedByAccountId:s.f.parent.actor.id,signedAt:s.f.at(-48),authorityState:"checked" as const,recordingAllowed:true,transcriptionAllowed:true,aiProcessingAllowed:true,childInformed:true,policyVersion:"DEMO-existing-document-v1",evidence:"DEMO — Synthetic checked authority only; no provider job.",expectedVersion:0};
 const saved=await s.service.recordConsent(s.f.practitioner.actor,sessionId,input,randomUUID());expect(saved.permissionToRecord).toBe(true);expect((await s.service.detail(s.f.practitioner.actor,sessionId)).processing.permissionToRecord).toBe(true);
 await s.f.pool.query('UPDATE ls_cases.case_guardians SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3',[s.f.workspaceId,s.f.first.id,input.signedByAccountId]);
 const detail=await s.service.detail(s.f.practitioner.actor,sessionId);expect(detail.processing.permissionToRecord).toBe(false);expect(detail.consentSigners.map(row=>row.accountId)).not.toContain(input.signedByAccountId);
 const {expectedVersion,...evidence}=input;expect(expectedVersion).toBe(0);expect(await s.service.consentVersion(s.f.practitioner.actor,sessionId,saved.consentId,1)).toMatchObject({...evidence,version:1,withdrawnAt:null});
 expect((await s.f.pool.query('SELECT count(*)::integer AS n FROM ls_sessions.recording_jobs WHERE workspace_id=$1',[s.f.workspaceId])).rows[0].n).toBe(0);
},30_000);
test("exact protected consent readback retains signature/evidence, denies customer or wrong case, and preserves prior versions",async()=>{
 const s=await httpFixture(),sessionId=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId,path=`/${sessionId}/consent`;
 const input={signedByAccountId:s.f.parentTwo.actor.id,signedAt:s.f.at(-48),authorityState:"needs_review",recordingAllowed:true,transcriptionAllowed:true,aiProcessingAllowed:true,childInformed:true,policyVersion:"DEMO-existing-document-v2",evidence:"DEMO — Actual synthetic authority/restriction evidence בלבד",expectedVersion:0};
 const response=await s.http.handle(s.request(path,input),[sessionId,"consent"]);expect(response.status).toBe(201);const result=(await response.json()).data;expect(result.permissionToRecord).toBe(false);
 const readPath=`${path}?consentId=${result.consentId.toUpperCase()}&version=${result.version}`,read=await s.http.handle(s.request(readPath),[sessionId,"consent"]);expect(read.status).toBe(200);expect(read.headers.get("cache-control")).toBe("private, no-store");
 const saved=(await read.json()).data;expect(saved).toMatchObject({signedByAccountId:input.signedByAccountId,signedAt:input.signedAt,authorityState:input.authorityState,recordingAllowed:input.recordingAllowed,transcriptionAllowed:input.transcriptionAllowed,aiProcessingAllowed:input.aiProcessingAllowed,childInformed:input.childInformed,policyVersion:input.policyVersion,evidence:input.evidence,workspaceId:s.f.workspaceId,caseId:s.f.first.id,sessionId,consentId:result.consentId,version:1,withdrawnAt:null});expect(saved).not.toHaveProperty("expectedVersion");
 const detail=await s.service.detail(s.f.practitioner.actor,sessionId);expect(detail.processing.consent).toMatchObject({signedByAccountId:input.signedByAccountId,signedAt:input.signedAt,policyVersion:input.policyVersion});expect(detail.consentSigners.map(row=>row.accountId).sort()).toEqual([s.f.parent.actor.id,s.f.parentTwo.actor.id].sort());expect(JSON.stringify(detail)).not.toContain(input.evidence);
 for(const token of [s.f.parent.token,s.f.parentTwo.token,s.f.outsider.token]){const denied=await s.http.handle(s.request(readPath,undefined,token),[sessionId,"consent"]);expect(denied.status).toBe(404);expect(await denied.text()).not.toContain(input.evidence);}
 const wrongSession=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.second.id,await s.f.seed(s.f.at(48),s.f.second))).sessionId;
 expect((await s.http.handle(s.request(`/${wrongSession}/consent?consentId=${result.consentId}&version=1`),[wrongSession,"consent"])).status).toBe(404);
 for(const query of [`?consentId=${result.consentId}&version=1&extra=1`,`?consentId=${result.consentId}&version=1&version=1`,`?consentId=${result.consentId}&consentId=${result.consentId}&version=1`,`?consentId=${result.consentId}&version=0`,`?consentId=${result.consentId}&version=1e0`,`?consentId=${result.consentId}&version=2147483648`,`?version=1`])expect((await s.http.handle(s.request(path+query),[sessionId,"consent"])).status).toBe(400);
 const withdrawal=await s.http.handle(s.request(`${path}/withdraw`,{expectedVersion:1}),[sessionId,"consent","withdraw"]);expect(withdrawal.status).toBe(201);const withdrawn=(await withdrawal.json()).data;
 const newest=await s.service.consentVersion(s.f.practitioner.actor,sessionId,result.consentId,withdrawn.version);expect(newest.evidence).toBe(input.evidence);expect(newest.withdrawnAt).toBe(withdrawn.withdrawnAt);expect(await s.service.consentVersion(s.f.practitioner.actor,sessionId,result.consentId,1)).toEqual(saved);
 await s.f.pool.query('UPDATE ls_cases.case_guardians SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3',[s.f.workspaceId,s.f.first.id,input.signedByAccountId]);
 expect((await s.service.detail(s.f.practitioner.actor,sessionId)).consentSigners.map(row=>row.accountId)).not.toContain(input.signedByAccountId);
 expect((await s.http.handle(s.request(path,{...input,expectedVersion:2}),[sessionId,"consent"])).status).toBe(404);
 expect((await s.f.pool.query('SELECT count(*)::integer AS n FROM ls_sessions.recording_jobs WHERE workspace_id=$1',[s.f.workspaceId])).rows[0].n).toBe(0);
},30_000);

test("consent writers reject impossible/future signatures, blank evidence and stale versions without normalizing or overwriting",async()=>{
 const s=await httpFixture(),sessionId=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId,path=`/${sessionId}/consent`;
 const input={signedByAccountId:s.f.parent.actor.id,signedAt:s.f.at(-48),authorityState:"restricted" as const,recordingAllowed:false,transcriptionAllowed:false,aiProcessingAllowed:false,childInformed:false,policyVersion:"DEMO-restricted-document-v1",evidence:"DEMO — Synthetic known restriction; no provider authorization.",expectedVersion:0};
 for(const change of [{signedAt:"2026-02-30T11:00:00Z"},{signedAt:s.f.at(24)},{policyVersion:" "},{evidence:" "},{evidence:"x".repeat(4001)},{expectedVersion:-1},{expectedVersion:0.5},{expectedVersion:2147483648},{expectedVersion:NaN}])await expect(s.service.recordConsent(s.f.practitioner.actor,sessionId,{...input,...change},randomUUID())).rejects.toMatchObject({code:"INVALID_REQUEST"});
 expect((await s.http.handle(s.request(path,{...input,signatureVerified:true}),[sessionId,"consent"])).status).toBe(400);
 const replies=await Promise.all([s.http.handle(s.request(path,input),[sessionId,"consent"]),s.http.handle(s.request(path,{...input,evidence:"DEMO — Other synthetic concurrent restriction."}),[sessionId,"consent"])]);expect(replies.map(row=>row.status).sort()).toEqual([201,409]);
 const stored=await s.f.pool.query('SELECT version,evidence_ciphertext FROM ls_sessions.recording_consents WHERE workspace_id=$1 AND case_id=$2',[s.f.workspaceId,s.f.first.id]);expect(stored.rows).toHaveLength(1);expect(stored.rows[0].version).toBe(1);
 expect((await s.service.detail(s.f.practitioner.actor,sessionId)).processing.permissionToRecord).toBe(false);
 expect((await s.http.handle(s.request(path,input),[sessionId,"consent"])).status).toBe(409);
 await s.f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE id=$1",[s.f.practitioner.actor.id]);
 const id=(await replies.find(row=>row.status===201)!.json()).data.consentId;expect((await s.http.handle(s.request(`${path}?consentId=${id}&version=1`),[sessionId,"consent"])).status).toBe(404);
},30_000);
test.each(["http","service"] as const)("%s consent writes cannot omit the expected version after withdrawal",async mode=>{
 const s=await httpFixture(),sessionId=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId,path=`/${sessionId}/consent`;
 const input={signedByAccountId:s.f.parent.actor.id,signedAt:s.f.at(-48),authorityState:"checked" as const,recordingAllowed:true,transcriptionAllowed:true,aiProcessingAllowed:true,childInformed:true,policyVersion:"DEMO-version-required",evidence:"DEMO — Synthetic consent prepared before withdrawal.",expectedVersion:0};
 const recorded=await s.service.recordConsent(s.f.practitioner.actor,sessionId,input,randomUUID()),withdrawn=await s.service.withdrawConsent(s.f.practitioner.actor,sessionId,recorded.version,randomUUID());
 const before=(await s.f.pool.query('SELECT version,evidence_ciphertext,withdrawn_at FROM ls_sessions.recording_consents WHERE workspace_id=$1 AND case_id=$2 ORDER BY version',[s.f.workspaceId,s.f.first.id])).rows;
 const legacy={...input,expectedVersion:undefined};
 if(mode==="http")expect((await s.http.handle(s.request(path,legacy),[sessionId,"consent"])).status).toBe(400);
 else await expect(s.service.recordConsent(s.f.practitioner.actor,sessionId,legacy as unknown as Parameters<SessionDatabaseService["recordConsent"]>[2],randomUUID())).rejects.toMatchObject({code:"INVALID_REQUEST"});
 const after=(await s.f.pool.query('SELECT version,evidence_ciphertext,withdrawn_at FROM ls_sessions.recording_consents WHERE workspace_id=$1 AND case_id=$2 ORDER BY version',[s.f.workspaceId,s.f.first.id])).rows;expect(after).toEqual(before);
 const detail=await s.service.detail(s.f.practitioner.actor,sessionId);expect(detail.processing.permissionToRecord).toBe(false);expect(detail.processing.consent?.version).toBe(withdrawn.version);
 expect((await s.f.pool.query('SELECT count(*)::integer AS n FROM ls_sessions.recording_jobs WHERE workspace_id=$1',[s.f.workspaceId])).rows[0].n).toBe(0);
},30_000);

test("real strict HTTP accepts the production UI projection, retains encrypted revisions and replay, and rejects extras/stale edits",async()=>{
 const s=await httpFixture(),past=await s.f.seed(s.f.at(-48)),id=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,past)).sessionId,path=`/${id}/observations`;
 const values=blankMetrics();values.engagement={score:4,notObservedReason:null,note:"Synthetic private original — הערה"};
 const original={sessionId:id,values,expectedRevision:0},key=randomUUID();
 expect((await s.http.handle(s.request(path,original),[id,"observations"])).status).toBe(400);
 const body=sessionCommandInput(path,original);
 for(let attempt=0;attempt<2;attempt++){const response=await s.http.handle(s.request(path,body,s.f.practitioner.token,key),[id,"observations"]);expect(response.status).toBe(201);expect((await response.json()).data).toMatchObject({revision:1,values});}
 const corrected={...values,engagement:{score:7,notObservedReason:null,note:values.engagement.note+"\nSynthetic manual correction"}};
 const second=await s.http.handle(s.request(path,sessionCommandInput(path,{sessionId:id,values:corrected,expectedRevision:1})),[id,"observations"]);expect(second.status).toBe(201);expect((await second.json()).data.revision).toBe(2);
 expect((await s.http.handle(s.request(path,{...body as object,unexpected:true}),[id,"observations"])).status).toBe(400);
 expect((await s.http.handle(s.request(path,body),[id,"observations"])).status).toBe(409);
 expect((await s.http.handle(s.request(path,{values:corrected,expectedRevision:0},s.f.practitioner.token,key),[id,"observations"])).status).toBe(409);
 const history=await s.http.handle(s.request(`/observations?caseId=${s.f.first.id}`),["observations"]);expect(history.status).toBe(200);expect(history.headers.get("cache-control")).toBe("private, no-store");
 const evidence=(await history.json()).data;validateObservationEvidence(evidence,s.f.first.id);expect(evidence.records.map((r:{revision:number})=>r.revision)).toEqual([1,2]);expect(evidence.records[0].values.engagement.note).toBe(values.engagement.note);expect(evidence.records[1].values.engagement.note).toBe(corrected.engagement.note);
 expect(metricSeries(evidence.records,s.f.workspaceId,s.f.first.id,"engagement",evidence.sessions)[0]).toMatchObject({score:7,at:s.f.at(-48)});
 expect((await s.service.detail(s.f.practitioner.actor,id)).metrics).toEqual(corrected);
 const stored=await s.f.pool.query("SELECT values_ciphertext FROM ls_sessions.practitioner_observations WHERE workspace_id=$1 AND session_id=$2 ORDER BY revision",[s.f.workspaceId,id]);expect(stored.rows).toHaveLength(2);for(const row of stored.rows)expect(row.values_ciphertext).not.toContain("Synthetic private");
 expect((await s.f.pool.query("SELECT count(*)::integer AS n FROM ls_sessions.recording_jobs WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].n).toBe(0);
},30_000);
test("case history preserves a missing session as a graph gap and never uses save timestamps as session dates",async()=>{
 const s=await httpFixture(),ids:string[]=[];
 for(const hours of [-72,-48,-24])ids.push((await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(hours)))).sessionId);
 for(const [index,score] of [[0,3],[2,8]]){const values=blankMetrics();values.engagement={score:score!,notObservedReason:null,note:"Synthetic separate session"};await s.service.saveObservations(s.f.practitioner.actor,ids[index!]!,values,0,randomUUID());}
 const evidence=await s.service.observations(s.f.practitioner.actor,s.f.first.id),points=metricSeries(evidence.records,s.f.workspaceId,s.f.first.id,"engagement",evidence.sessions);
 expect(points.map(p=>p.score)).toEqual([3,null,8]);expect(points.map(p=>p.at)).toEqual([-72,-48,-24].map(hours=>s.f.at(hours)));
 expect(points[1]!.note).toBe("");expect(evidence.records).toHaveLength(2);
},30_000);
test("parent/child/adult, cross-workspace, revoked sessions and fresh role changes deny private history and writes",async()=>{
 const s=await httpFixture(),id=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId;
 for(const role of ["parent","child","adult_client"]){await s.f.pool.query("UPDATE ls_identity.accounts SET role=$2 WHERE id=$1",[s.f.parent.actor.id,role]);for(const [path,parts,body] of [[`/observations?caseId=${s.f.first.id}`,["observations"],undefined],[`/${id}`,[id],undefined],[`/${id}/observations`,[id,"observations"],{values:blankMetrics(),expectedRevision:0}]] as const){const response=await s.http.handle(s.request(path,body,s.f.parent.token),parts);expect(response.status).toBe(404);expect(await response.text()).not.toContain("values");}}
 const other=await httpFixture();expect((await s.http.handle(s.request(`/observations?caseId=${other.f.first.id}`),["observations"])).status).toBe(404);
 expect((await s.http.handle(s.request(`/observations?caseId=${s.f.first.id}`,undefined,other.f.practitioner.token),["observations"])).status).toBe(401);
 await s.f.pool.query("UPDATE ls_identity.accounts SET role='parent' WHERE id=$1",[s.f.practitioner.actor.id]);
 expect((await s.http.handle(s.request(`/observations?caseId=${s.f.first.id}`),["observations"])).status).toBe(404);
 await s.f.pool.query("UPDATE ls_identity.accounts SET role='practitioner' WHERE id=$1",[s.f.practitioner.actor.id]);
 await s.f.pool.query("UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1",[s.f.practitioner.actor.sessionDigest]);
 expect((await s.http.handle(s.request(`/observations?caseId=${s.f.first.id}`),["observations"])).status).toBe(401);
},30_000);
test("real HTTP retains CSRF and exact query gates and shared recap never exposes observation scores or notes",async()=>{
 const s=await httpFixture(),id=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId,values=blankMetrics();values.engagement={score:9,notObservedReason:null,note:"PRIVATE_SYNTHETIC_NEVER_SHARED"};
 expect((await s.http.handle(s.request(`/${id}/observations`,{values,expectedRevision:0},s.f.practitioner.token,randomUUID(),false),[id,"observations"])).status).toBe(403);
 await s.service.saveObservations(s.f.practitioner.actor,id,values,0,randomUUID());
 for(const query of [`?caseId=${s.f.first.id}&extra=1`,`?caseId=${s.f.first.id}&caseId=${s.f.first.id}`,"?caseId=invalid"] )expect((await s.http.handle(s.request("/observations"+query),["observations"])).status).toBe(400);
 const recapPath=`/${id}/recap`,recapInput={sessionId:id,locale:"en",focus:["regulation"],nextStep:"Synthetic approved narrative",expectedVersion:0};
 const saved=await s.http.handle(s.request(recapPath,sessionCommandInput(recapPath,recapInput)),[id,"recap"]);expect(saved.status).toBe(201);
 const detail=await s.service.detail(s.f.practitioner.actor,id),sharePath=`/${id}/share`,shareInput={sessionId:id,expectedVersion:1,expectedDigest:detail.recapDigest,recipientAccountIds:detail.recipients.map(item=>item.accountId)};
 const shared=await s.http.handle(s.request(sharePath,sessionCommandInput(sharePath,shareInput)),[id,"share"]);expect(shared.status).toBe(201);
 const family=await s.http.handle(s.request(`/shared?caseId=${s.f.first.id}`,undefined,s.f.parent.token),["shared"]);expect(family.status).toBe(200);const raw=await family.text();expect(raw).toContain("Synthetic approved narrative");for(const key of ["PRIVATE_SYNTHETIC_NEVER_SHARED","recordedByAccountId","values","scores","practitioner_observation"])expect(raw).not.toContain(key);
},30_000);
test("two concurrent strict HTTP revisions have one winner and retain the losing draft as a conflict",async()=>{
 const s=await httpFixture(),id=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId;
 const candidates=[3,8].map(score=>({values:{...blankMetrics(),engagement:{score,notObservedReason:null,note:`Synthetic candidate ${score}`}},expectedRevision:0}));
 const replies=await Promise.all(candidates.map(body=>s.http.handle(s.request(`/${id}/observations`,body),[id,"observations"])));
 expect(replies.map(item=>item.status).sort()).toEqual([201,409]);
 const winner=candidates[replies.findIndex(item=>item.status===201)]!;
 const history=await s.service.observations(s.f.practitioner.actor,s.f.first.id);expect(history.records).toHaveLength(1);expect(history.records[0]!.values).toEqual(winner.values);
},30_000);
test("oversized encrypted observation history fails visibly instead of silently truncating",async()=>{
 const s=await httpFixture(),id=(await s.service.ensureForAppointment(s.f.practitioner.actor,s.f.first.id,await s.f.seed(s.f.at(-24)))).sessionId;
 // Only this disposable cluster: inaccessible placeholder ciphertext proves the
 // bound is enforced before decryption, without a provider or production read.
 await s.f.pool.query("INSERT INTO ls_sessions.practitioner_observations(workspace_id,case_id,session_id,revision,schema_version,values_ciphertext,notes_ciphertext,recorded_by_account_id,recorded_at) SELECT $1,$2,$3,n,1,'isolated-bound-placeholder','isolated-bound-placeholder',$4,clock_timestamp() FROM generate_series(1,1001) n",[s.f.workspaceId,s.f.first.id,id,s.f.practitioner.actor.id]);
 await expect(s.service.observations(s.f.practitioner.actor,s.f.first.id)).rejects.toMatchObject({code:"UNAVAILABLE"});
 expect((await s.http.handle(s.request(`/observations?caseId=${s.f.first.id}`),["observations"])).status).toBe(503);
 expect((await s.f.pool.query("SELECT count(*)::integer AS n FROM ls_sessions.practitioner_observations WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].n).toBe(1001);
},30_000);
