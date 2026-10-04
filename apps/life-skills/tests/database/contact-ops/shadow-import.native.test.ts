import { afterAll, expect, test, vi } from "vitest";
import { createHash, randomUUID } from "node:crypto";
vi.mock("server-only", () => ({}));
import { fixture, poolStore } from "../calendar/fixture.ts";
import { blindEmail, seal, unseal } from "../../../src/features/identity/crypto.ts";
import { NativeShadowImporter, nativeShadowOperatorPermit } from "../../../src/features/contact-ops/server/shadow-import.ts";
import { crmProfileAad, NativeCrmStore } from "../../../src/features/contact-ops/server/native-store.ts";
import type { SheetSnapshot } from "../../../src/features/contact-ops/server/import-plan.ts";
import { planImport } from "../../../src/features/contact-ops/server/import-plan.ts";
import {cutoverStateAad} from "../../../src/features/contact-ops/server/cutover-state.ts";
import {readFile} from "node:fs/promises";
import {contactDeltaCatalog,contactDeltaCatalogDigest,contactDeltaIntegrity,CONTACT_DELTA_CATALOG_SHA256,CONTACT_DELTA_MIGRATION} from "../../../src/db/contact-delta-integrity.ts";
import {historicalPracticeDatabase} from "../home-practice/legacy-practice-fixture.ts";
import {migrate} from "../../../src/db/migration-runner.ts";
import {contactOpsMigrationPrefix} from "../../../src/db/contact-ops-production-guard.ts";
import {advanceCutover,type CutoverProof} from "../../../src/features/contact-ops/core/cutover.ts";

const f = await fixture();
afterAll(async () => { await f.pool.end(); });
const key = "synthetic-shadow-import-integrity-key-20260927";
const lookupKey = Buffer.alloc(32, 6);
const sourceFileId = `synthetic-${randomUUID()}`;
const sheetId = 101;
const importer = new NativeShadowImporter(poolStore(f.pool), f.keyring, lookupKey, key, sourceFileId, sheetId);
const headers = ["Lead ID", "Parent/adult name", "Phone", "Email", "Pipeline stage", " Next action ", " Next-action date ", " General sales notes "];
const one = ["LS-LEAD-synthetic-one", "Synthetic Adult One", "+15555550101", "one@example.invalid", "New inquiry", "Call", "2026-09-27", "Synthetic administrative note one"];
const two = ["LS-LEAD-synthetic-two", "", "+15555550102", "", "Contacted", "Follow up", "", "Synthetic administrative note two"];
function snapshot(rows: string[][] = [one, two], fileId = sourceFileId): SheetSnapshot {
 return { fileId, sheetId, tab: "Leads", revision: "synthetic-revision-1", complete: true, headers, rows };
}
function decide(source: SheetSnapshot) { return planImport(source, f.workspaceId, key).rows.map(row => ({ sourceRow: row.sourceRow, sourceRevision: source.revision, legacyId: row.legacyId, rowDigest: row.rowDigest, kind: "new_person" as const })); }

test("exact native delta catalog, functions and ACLs must match the reviewed additive frame",async()=>{
 const sql=await readFile(new URL("../../../migrations/0118_ls_contact_delta_history.sql",import.meta.url),"utf8");
 const files=[{name:CONTACT_DELTA_MIGRATION.name,checksum:CONTACT_DELTA_MIGRATION.sha256,sql}];
 const applied={objectsAbsent:false,tables:true,schemaCatalog:true,foreignKeys:true,historyImmutable:true,reviewedFunctions:true,permissions:true,referencesSound:true};
 const db=poolStore(f.pool);
 const catalog=await db.transaction(tx=>contactDeltaCatalog(tx));
 console.log(JSON.stringify({deltaCatalogSha256:contactDeltaCatalogDigest(catalog)}));
 expect(contactDeltaCatalogDigest(catalog)).toBe(CONTACT_DELTA_CATALOG_SHA256);
 expect(await db.transaction(tx=>contactDeltaIntegrity(tx,files))).toEqual(applied);
 await expect(db.transaction(tx=>contactDeltaIntegrity(tx,[{...files[0]!,sql:sql+"-- drift"}]))).rejects.toThrow("CONTACT_DELTA_SOURCE_MISMATCH");
 const client=await f.pool.connect();
 try {
  const tx={query:async<R extends object>(statement:string,values:readonly unknown[]=[]) => (await client.query<R>(statement,[...values])).rows};
  for(const [statement,field] of [
   ["CREATE INDEX synthetic_delta_extra ON ls_contact_ops.delta_history(person_id)","schemaCatalog"],
   ["ALTER TABLE ls_contact_ops.delta_history DISABLE TRIGGER delta_history_no_edit","historyImmutable"],
   ["GRANT SELECT ON ls_contact_ops.delta_history TO PUBLIC","permissions"],
   ["GRANT SELECT(evidence_ciphertext) ON ls_contact_ops.delta_history TO PUBLIC","permissions"],
   ["GRANT EXECUTE ON FUNCTION ls_contact_ops.deny_delta_history_mutation() TO PUBLIC","permissions"],
   ["ALTER FUNCTION ls_contact_ops.deny_delta_history_mutation() SECURITY DEFINER","reviewedFunctions"],
   ["ALTER TABLE ls_contact_ops.delta_history ENABLE ROW LEVEL SECURITY","schemaCatalog"],
  ] as const){
   await client.query("BEGIN");try{await client.query(statement);expect((await contactDeltaIntegrity(tx,files))[field]).toBe(false);}finally{await client.query("ROLLBACK");}
  }
 } finally {client.release();}
 expect(await db.transaction(tx=>contactDeltaIntegrity(tx,files))).toEqual(applied);
});

test("populated37 to38 delta-history migration preserves original contacts and ledger, then repeats without writes",async()=>{
 const historical=await historicalPracticeDatabase("0114_ls_practice_responsibilities.sql");
 let d:Awaited<ReturnType<typeof fixture>>|undefined;
 try {
  const prior=contactOpsMigrationPrefix(historical.inventory,"0117_ls_acquisition_decisions.sql");
  const client=await historical.pool.connect();
  try{await migrate({query:(sql,values)=>client.query(sql,values?[...values]:undefined)},prior,false);}finally{client.release();}
  vi.stubEnv("TEST_DATABASE_URL",historical.url);vi.stubEnv("LS_CALENDAR_TEST_ALLOW","true");d=await fixture();
  const store=poolStore(d.pool),service=new NativeShadowImporter(store,d.keyring,lookupKey,key,sourceFileId,sheetId),source=snapshot([one]);
  const dispositions=planImport(source,d.workspaceId,key).rows.map(row=>({sourceRow:row.sourceRow,sourceRevision:source.revision,legacyId:row.legacyId,rowDigest:row.rowDigest,kind:"new_person" as const}));
  await service.importNewPeople(d.practitioner.actor,source,dispositions);
  const preserve=async()=>Promise.all(["ls_identity.people","ls_contact_ops.profiles","ls_contact_ops.legacy_links"].map(async table=>(await d!.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[d!.workspaceId])).rows));
  const before=await preserve(),ledger=(await d.pool.query("SELECT * FROM ls_control.migrations ORDER BY name")).rows;
  expect(ledger).toHaveLength(37);
  expect(await store.transaction(tx=>contactDeltaIntegrity(tx,historical.inventory))).toEqual({objectsAbsent:true,tables:false,schemaCatalog:false,foreignKeys:false,historyImmutable:false,reviewedFunctions:false,permissions:false,referencesSound:false});
  const migrationClient=await historical.pool.connect();
  try{
   const runner={query:(sql:string,values?:readonly unknown[])=>migrationClient.query(sql,values?[...values]:undefined)};
   expect(await migrate(runner,historical.inventory,false)).toEqual({applied:1,pending:0});
   expect(await migrate(runner,historical.inventory,false)).toEqual({applied:0,pending:0});
   expect(await migrate(runner,historical.inventory,true)).toEqual({applied:0,pending:0});
  }finally{migrationClient.release();}
  expect(await preserve()).toEqual(before);
  expect((await d.pool.query("SELECT * FROM ls_control.migrations WHERE name<>$1 ORDER BY name",[CONTACT_DELTA_MIGRATION.name])).rows).toEqual(ledger);
  expect(await store.transaction(tx=>contactDeltaIntegrity(tx,historical.inventory))).toEqual({objectsAbsent:false,tables:true,schemaCatalog:true,foreignKeys:true,historyImmutable:true,reviewedFunctions:true,permissions:true,referencesSound:true});
 }finally{await d?.pool.end();vi.unstubAllEnvs();await historical.close();}
});

test("first-import path cannot write after authority preparation, freeze or native activation", async()=>{
 const d=await fixture();
 try {
  const service=new NativeShadowImporter(poolStore(d.pool),d.keyring,lookupKey,key,sourceFileId,sheetId);
  const source=snapshot([one]);
  const decisions=planImport(source,d.workspaceId,key).rows.map(row=>({sourceRow:row.sourceRow,sourceRevision:source.revision,legacyId:row.legacyId,rowDigest:row.rowDigest,kind:"new_person" as const}));
  for(const phase of ["shadow_ready","frozen","native_active","retired","rollback_prepared"] as const){
   const state={phase,epoch:1,batchId:"synthetic-cutover",sourceFileId,sourceRevision:source.revision,nativeWritesSinceSwitch:0};
   await d.pool.query(`INSERT INTO ls_contact_ops.cutover(workspace_id,epoch,phase,state_ciphertext) VALUES($1,1,$2,$3)
    ON CONFLICT(workspace_id) DO UPDATE SET phase=EXCLUDED.phase,state_ciphertext=EXCLUDED.state_ciphertext`,
    [d.workspaceId,phase,seal(JSON.stringify(state),cutoverStateAad(d.workspaceId,1),d.keyring)]);
   await expect(service.importNewPeople(d.practitioner.actor,source,decisions)).rejects.toThrow("IMPORT_AUTHORITY_ALREADY_PREPARED");
   expect((await d.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1",[d.workspaceId])).rows[0].n).toBe(0);
  }
 } finally {await d.pool.end();}
});

test("delta preflight detects account endpoint collisions without linking a person or granting access", async()=>{
 const d=await fixture();
 try {
  const service=new NativeShadowImporter(poolStore(d.pool),d.keyring,lookupKey,key,sourceFileId,sheetId);
  const old=snapshot([one]), next={...snapshot([one,two]),revision:"synthetic-revision-2"};
  const decisions=planImport(old,d.workspaceId,key).rows.map(row=>({sourceRow:row.sourceRow,sourceRevision:old.revision,legacyId:row.legacyId,rowDigest:row.rowDigest,kind:"new_person" as const}));
  await service.importNewPeople(d.practitioner.actor,old,decisions);
  for(const row of [one,two]) {
   await d.pool.query("UPDATE ls_identity.accounts SET phone_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",
    [d.workspaceId,d.parent.actor.id,seal(row[2]!,`phone:${d.workspaceId}:${d.parent.actor.id}`,d.keyring)]);
   const result=await service.preflightDelta(d.practitioner.actor,old,next);
   expect(result.identityConflicts).toEqual([{legacyId:row[0],reason:"ACCOUNT_ENDPOINT_COLLISION"}]);
   expect(result.existingRowsReconciled).toBe(false);
   expect(result.effects).toBe("none");
  }
  expect((await d.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1",[d.workspaceId])).rows[0].n).toBe(1);
 } finally {await d.pool.end();}
});

test("oversized delta names cannot change identities, profiles, source receipts or authority",async()=>{
 const d=await fixture();
 try{
  const service=new NativeShadowImporter(poolStore(d.pool),d.keyring,lookupKey,key,sourceFileId,sheetId),old=snapshot([one]);
  const decideFor=(s:SheetSnapshot)=>planImport(s,d.workspaceId,key).rows.map(row=>({sourceRow:row.sourceRow,sourceRevision:s.revision,legacyId:row.legacyId,rowDigest:row.rowDigest,kind:"new_person" as const}));
  await service.importNewPeople(d.practitioner.actor,old,decideFor(old));
  const state={phase:"frozen",epoch:2,batchId:"synthetic-name-bound",sourceFileId,sourceRevision:old.revision,nativeWritesSinceSwitch:0};
  await d.pool.query("INSERT INTO ls_contact_ops.cutover(workspace_id,epoch,phase,state_ciphertext) VALUES($1,2,'frozen',$2)",[d.workspaceId,seal(JSON.stringify(state),cutoverStateAad(d.workspaceId,2),d.keyring)]);
  const preserve=async()=>Promise.all(["ls_identity.people","ls_contact_ops.profiles","ls_contact_ops.legacy_links","ls_contact_ops.cutover","ls_contact_ops.delta_operations","ls_contact_ops.delta_history"].map(async table=>(await d.pool.query(`SELECT to_jsonb(t) AS row FROM ${table} t WHERE workspace_id=$1 ORDER BY to_jsonb(t)::text`,[d.workspaceId])).rows));
  const before=await preserve(),changed=[...one],added=[...two];changed[1]="א".repeat(121);added[1]="x".repeat(121);
  for(const rows of [[changed],[one,added]]){
   const next={...snapshot(rows),revision:"synthetic-revision-2"};
   const checked=await service.preflightDelta(d.practitioner.actor,old,next);
   expect(checked.existingRowsReconciled).toBe(false);
   expect(checked.source.review).toEqual([{legacyId:rows.at(-1)![0],reasons:["DISPLAY_NAME_NEEDS_REVIEW"]}]);
   await expect(service.applyDelta(d.practitioner.actor,old,next,{operationId:"synthetic-name-bound",expectedEpoch:2,versions:[{legacyId:one[0]!,version:1}],newPeople:decideFor(next).filter(row=>row.legacyId===two[0])})).rejects.toThrow("DELTA_RECONCILIATION_REQUIRED");
   expect(await preserve()).toEqual(before);
  }
 }finally{await d.pool.end();}
});

test("first import waits for the authority fence and observes the newly committed phase", async()=>{
 const d=await fixture(),holder=await d.pool.connect();
 let open=false,attempt:Promise<{ok:boolean;error:string|null}>|undefined;
 try {
  const service=new NativeShadowImporter(poolStore(d.pool),d.keyring,lookupKey,key,sourceFileId,sheetId),source=snapshot([one]);
  const decisions=planImport(source,d.workspaceId,key).rows.map(row=>({sourceRow:row.sourceRow,sourceRevision:source.revision,legacyId:row.legacyId,rowDigest:row.rowDigest,kind:"new_person" as const}));
  await holder.query("BEGIN");open=true;
  await holder.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[`${d.workspaceId}:contact-authority`]);
  const state={phase:"shadow_ready",epoch:1,batchId:"synthetic-cutover",sourceFileId,sourceRevision:source.revision,nativeWritesSinceSwitch:0};
  await holder.query("INSERT INTO ls_contact_ops.cutover(workspace_id,epoch,phase,state_ciphertext) VALUES($1,1,'shadow_ready',$2)",
   [d.workspaceId,seal(JSON.stringify(state),cutoverStateAad(d.workspaceId,1),d.keyring)]);
  let settled=false;
  attempt=service.importNewPeople(d.practitioner.actor,source,decisions)
   .then(()=>({ok:true,error:null}),error=>({ok:false,error:(error as Error).message})).finally(()=>{settled=true});
  await new Promise(resolve=>setTimeout(resolve,75));expect(settled).toBe(false);
  await holder.query("COMMIT");open=false;
  expect(await attempt).toEqual({ok:false,error:"IMPORT_AUTHORITY_ALREADY_PREPARED"});
  expect((await d.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1",[d.workspaceId])).rows[0].n).toBe(0);
 } finally {
  if(open)await holder.query("ROLLBACK");holder.release();
  if(attempt)await attempt;
  await d.pool.end();
 }
});

test("frozen delta applies once with encrypted immutable history, native notes preserved and no account creation or activation", async()=>{
 const d=await fixture();
 try {
  const service=new NativeShadowImporter(poolStore(d.pool),d.keyring,lookupKey,key,sourceFileId,sheetId);
  const old=snapshot([one]),changed=[...one];changed[1]="Synthetic corrected display";changed[5]="Changed source follow-up";
  const next={...snapshot([changed,two]),revision:"synthetic-revision-2"};
  const decideFor=(s:SheetSnapshot)=>planImport(s,d.workspaceId,key).rows.map(row=>({sourceRow:row.sourceRow,sourceRevision:s.revision,legacyId:row.legacyId,rowDigest:row.rowDigest,kind:"new_person" as const}));
  await service.importNewPeople(d.practitioner.actor,old,decideFor(old));
  const personId=planImport(old,d.workspaceId,key).rows[0]!.suggestedPersonId;
  const original=(await d.pool.query("SELECT payload_ciphertext FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[d.workspaceId,personId])).rows[0].payload_ciphertext;
  const profile=JSON.parse(unseal(original,crmProfileAad(d.workspaceId,personId),d.keyring));
  await d.pool.query("UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3,version=2 WHERE workspace_id=$1 AND person_id=$2",
   [d.workspaceId,personId,seal(JSON.stringify({...profile,notes:"Native authored note retained",doNotContact:true}),crmProfileAad(d.workspaceId,personId),d.keyring)]);
  const input={operationId:"synthetic-final-delta",expectedEpoch:2,versions:[{legacyId:one[0]!,version:2}],newPeople:decideFor(next).filter(row=>row.legacyId===two[0])};
  await expect(service.applyDelta(d.practitioner.actor,old,next,input)).rejects.toThrow("DELTA_REQUIRES_EXACT_FREEZE");
  const state={phase:"frozen",epoch:2,batchId:"synthetic-cutover",sourceFileId,sourceRevision:old.revision,nativeWritesSinceSwitch:0};
  const authorityCiphertext=seal(JSON.stringify(state),cutoverStateAad(d.workspaceId,2),d.keyring);
  await d.pool.query("INSERT INTO ls_contact_ops.cutover(workspace_id,epoch,phase,state_ciphertext) VALUES($1,2,'frozen',$2)",[d.workspaceId,authorityCiphertext]);
  for(const actor of [d.parent.actor,d.parentTwo.actor,d.outsider.actor]) await expect(service.applyDelta(actor,old,next,input)).rejects.toThrow();
  await expect(service.applyDelta(d.practitioner.actor,old,next,{...input,expectedEpoch:1})).rejects.toThrow("DELTA_REQUIRES_EXACT_FREEZE");
  await expect(service.applyDelta(d.practitioner.actor,old,next,{...input,versions:[{legacyId:one[0]!,version:1}]})).rejects.toThrow("DELTA_VERSION_CONFLICT");
  await expect(service.applyDelta(d.practitioner.actor,old,next,{...input,newPeople:[]})).rejects.toThrow("DELTA_DISPOSITION_INCOMPLETE");
  const accountsBefore=(await d.pool.query("SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 ORDER BY id",[d.workspaceId])).rows;
  const expected={sourceRevision:next.revision,previousRevision:old.revision,authorityEpoch:3,
   snapshotDigest:planImport(next,d.workspaceId,key).snapshotDigest,planned:2,created:1,updated:1,unchanged:0};
  expect(await service.applyDelta(d.practitioner.actor,old,next,input)).toEqual({...expected,replayed:false});
  expect(await service.applyDelta(d.practitioner.actor,old,next,input)).toEqual({...expected,replayed:true});
  await expect(service.applyDelta(d.practitioner.actor,old,next,{...input,expectedEpoch:3})).rejects.toThrow("DELTA_OPERATION_CONFLICT");
  const saved=(await d.pool.query("SELECT payload_ciphertext,version FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[d.workspaceId,personId])).rows[0];
  expect(saved.version).toBe(3);
  expect(JSON.parse(unseal(saved.payload_ciphertext,crmProfileAad(d.workspaceId,personId),d.keyring))).toMatchObject({notes:"Native authored note retained",doNotContact:true,nextAction:"Changed source follow-up"});
  const history=(await d.pool.query("SELECT legacy_lead_id,evidence_ciphertext FROM ls_contact_ops.delta_history WHERE workspace_id=$1 ORDER BY legacy_lead_id",[d.workspaceId])).rows;
  expect(history).toHaveLength(2);
  const prior=history.find(row=>row.legacy_lead_id===one[0])!;
  expect(prior.evidence_ciphertext).not.toContain("Native authored note retained");
  const evidence=JSON.parse(unseal(prior.evidence_ciphertext,`ls_contact_ops/delta-history/v1/${d.workspaceId}/${input.operationId}/${one[0]}`,d.keyring));
  expect(evidence.before.sourceRevision).toBe(old.revision);expect(evidence.after.sourceRevision).toBe(next.revision);
  const originalSnapshot=JSON.parse(unseal(evidence.before.snapshotCiphertext,`ls_contact_ops/legacy/v1/${d.workspaceId}/${sourceFileId}/${sheetId}/${one[0]}`,d.keyring));
  expect(originalSnapshot.payload.sourceFields[" General sales notes "]).toBe(one[7]);
  expect((await d.pool.query("SELECT source_revision FROM ls_contact_ops.legacy_links WHERE workspace_id=$1",[d.workspaceId])).rows.every(row=>row.source_revision===next.revision)).toBe(true);
  const authority=(await d.pool.query("SELECT epoch,phase,state_ciphertext FROM ls_contact_ops.cutover WHERE workspace_id=$1",[d.workspaceId])).rows[0];
  expect(Number(authority.epoch)).toBe(3);expect(authority.phase).toBe("frozen");
  const frozen=JSON.parse(unseal(authority.state_ciphertext,cutoverStateAad(d.workspaceId,3),d.keyring));
  expect(frozen).toEqual({...state,epoch:3,sourceRevision:next.revision});
  const syntheticProof:CutoverProof={batchId:state.batchId,sourceFileId,sourceRevision:old.revision,expectedEpoch:3,
   backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,
   paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,
   sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true};
  // Pure isolated gate proof only: an old revision cannot activate the applied
  // new snapshot, even if the caller supplies the new epoch and all flags.
  expect(()=>advanceCutover(frozen,"switch_native",syntheticProof,state.batchId)).toThrow("PROOF_MISMATCH");
  expect(advanceCutover(frozen,"switch_native",{...syntheticProof,sourceRevision:next.revision},state.batchId)).toMatchObject({phase:"native_active",epoch:4,sourceRevision:next.revision});
  expect((await d.pool.query("SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 ORDER BY id",[d.workspaceId])).rows).toEqual(accountsBefore);
  for(const table of ["delta_operations","delta_history"]){
   await expect(d.pool.query(`UPDATE ls_contact_ops.${table} SET operation_id=operation_id WHERE workspace_id=$1`,[d.workspaceId])).rejects.toThrow("CONTACT_DELTA_HISTORY_IMMUTABLE");
   await expect(d.pool.query(`DELETE FROM ls_contact_ops.${table} WHERE workspace_id=$1`,[d.workspaceId])).rejects.toThrow("CONTACT_DELTA_HISTORY_IMMUTABLE");
  }
  await expect(d.pool.query("TRUNCATE ls_contact_ops.delta_history")).rejects.toThrow("CONTACT_DELTA_HISTORY_IMMUTABLE");
 } finally {await d.pool.end();}
});

test("failure after delta history insertion rolls back all profiles, identities and receipts before an exact retry", async()=>{
 const d=await fixture();
 try {
  const store=poolStore(d.pool), service=new NativeShadowImporter(store,d.keyring,lookupKey,key,sourceFileId,sheetId);
  const old=snapshot([one]),changed=[...one];changed[5]="Synthetic updated action";
  const next={...snapshot([changed,two]),revision:"synthetic-revision-2"};
  const decideFor=(s:SheetSnapshot)=>planImport(s,d.workspaceId,key).rows.map(row=>({sourceRow:row.sourceRow,sourceRevision:s.revision,legacyId:row.legacyId,rowDigest:row.rowDigest,kind:"new_person" as const}));
  await service.importNewPeople(d.practitioner.actor,old,decideFor(old));
  const beforeProfiles=(await d.pool.query("SELECT * FROM ls_contact_ops.profiles WHERE workspace_id=$1",[d.workspaceId])).rows;
  const beforeLinks=(await d.pool.query("SELECT * FROM ls_contact_ops.legacy_links WHERE workspace_id=$1",[d.workspaceId])).rows;
  const beforePeople=(await d.pool.query("SELECT id,profile_ciphertext FROM ls_identity.people WHERE workspace_id=$1 ORDER BY id",[d.workspaceId])).rows;
  const state={phase:"frozen",epoch:2,batchId:"synthetic-cutover",sourceFileId,sourceRevision:old.revision,nativeWritesSinceSwitch:0};
  await d.pool.query("INSERT INTO ls_contact_ops.cutover(workspace_id,epoch,phase,state_ciphertext) VALUES($1,2,'frozen',$2)",
   [d.workspaceId,seal(JSON.stringify(state),cutoverStateAad(d.workspaceId,2),d.keyring)]);
  const input={operationId:"synthetic-interrupted-delta",expectedEpoch:2,versions:[{legacyId:one[0]!,version:1}],newPeople:decideFor(next).filter(row=>row.legacyId===two[0])};
  // Inject a process error AFTER the real PostgreSQL write. Retain the actual
  // production binder/driver transaction; this proves rollback, not mock storage.
  const interrupted=new NativeShadowImporter({transaction:work=>store.transaction(tx=>work({async query<R extends object>(sql:string,values:readonly unknown[]=[]){
   const result=await tx.query<R>(sql,values);
   if(sql.startsWith("INSERT INTO ls_contact_ops.delta_history") && values[2]===two[0])throw new Error("SYNTHETIC_DELTA_INTERRUPTION");
   return result;
  }}))},d.keyring,lookupKey,key,sourceFileId,sheetId);
  await expect(interrupted.applyDelta(d.practitioner.actor,old,next,input)).rejects.toThrow("SYNTHETIC_DELTA_INTERRUPTION");
  expect((await d.pool.query("SELECT * FROM ls_contact_ops.profiles WHERE workspace_id=$1",[d.workspaceId])).rows).toEqual(beforeProfiles);
  expect((await d.pool.query("SELECT * FROM ls_contact_ops.legacy_links WHERE workspace_id=$1",[d.workspaceId])).rows).toEqual(beforeLinks);
  expect((await d.pool.query("SELECT id,profile_ciphertext FROM ls_identity.people WHERE workspace_id=$1 ORDER BY id",[d.workspaceId])).rows).toEqual(beforePeople);
  for(const table of ["delta_operations","delta_history"])expect((await d.pool.query(`SELECT * FROM ls_contact_ops.${table} WHERE workspace_id=$1`,[d.workspaceId])).rows).toEqual([]);
  expect(await service.applyDelta(d.practitioner.actor,old,next,input)).toMatchObject({created:1,updated:1,replayed:false});
  expect(await service.applyDelta(d.practitioner.actor,old,next,input)).toMatchObject({created:1,updated:1,replayed:true});
 } finally {await d.pool.end();}
});

test("native final-delta preflight preserves existing identities and notes without writing or switching authority", async()=>{
 const d=await fixture();
 try {
  const store=poolStore(d.pool), service=new NativeShadowImporter(store,d.keyring,lookupKey,key,sourceFileId,sheetId);
  const old=snapshot([one]), next={...snapshot([one,two]),revision:"synthetic-revision-2"};
  const decisions=planImport(old,d.workspaceId,key).rows.map(row=>({sourceRow:row.sourceRow,sourceRevision:old.revision,legacyId:row.legacyId,rowDigest:row.rowDigest,kind:"new_person" as const}));
  await service.importNewPeople(d.practitioner.actor,old,decisions);
  const initial=await d.pool.query("SELECT person_id,payload_ciphertext,version FROM ls_contact_ops.profiles WHERE workspace_id=$1",[d.workspaceId]);
  const result=await service.preflightDelta(d.practitioner.actor,old,next);
  expect(result).toMatchObject({expectedEpoch:0,phase:"sheet_active",existingRowsReconciled:true,newIdentityDecisionsRequired:true,effects:"none",conflicts:[]});
  expect(result.existing).toHaveLength(1);expect(result.newRows).toEqual([two[0]]);
  const serialized=JSON.stringify(result);
  for(const value of [one[1],one[2],one[3],one[7],"protectedPayload","sourceFields"])
   expect(serialized).not.toContain(value);
  expect(result.existing[0]).toMatchObject({personId:initial.rows[0].person_id,expectedVersion:1,profileChanged:false});
  expect((await d.pool.query("SELECT person_id,payload_ciphertext,version FROM ls_contact_ops.profiles WHERE workspace_id=$1",[d.workspaceId])).rows).toEqual(initial.rows);
  expect((await d.pool.query("SELECT * FROM ls_contact_ops.cutover WHERE workspace_id=$1",[d.workspaceId])).rows).toEqual([]);
  for(const actor of [d.parent.actor,d.parentTwo.actor,d.outsider.actor]) await expect(service.preflightDelta(actor,old,next)).rejects.toThrow();
  const personId=initial.rows[0].person_id, aad=crmProfileAad(d.workspaceId,personId);
  const current=JSON.parse(unseal(initial.rows[0].payload_ciphertext,aad,d.keyring));
  await d.pool.query("UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3,version=2 WHERE workspace_id=$1 AND person_id=$2",
   [d.workspaceId,personId,seal(JSON.stringify({...current,notes:"New native authored note",doNotContact:true}),aad,d.keyring)]);
  const sourceOnly=[...one];sourceOnly[5]="New source action";
  const merge=await service.preflightDelta(d.practitioner.actor,old,{...next,rows:[sourceOnly]});
  expect(merge.existingRowsReconciled).toBe(true);expect(merge.existing[0]).toMatchObject({expectedVersion:2,sourceChanged:true,profileChanged:true});
  sourceOnly[7]="Competing source note";
  const conflict=await service.preflightDelta(d.practitioner.actor,old,{...next,rows:[sourceOnly]});
  expect(conflict.existingRowsReconciled).toBe(false);expect(conflict.conflicts).toEqual([{legacyId:one[0],fields:["notes"]}]);
  const persisted=(await d.pool.query("SELECT payload_ciphertext,version FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[d.workspaceId,personId])).rows[0];
  expect(persisted.version).toBe(2);expect(JSON.parse(unseal(persisted.payload_ciphertext,aad,d.keyring))).toMatchObject({notes:"New native authored note",nextAction:"Call",doNotContact:true});
  await expect(service.preflightDelta(d.practitioner.actor,{...old,revision:"wrong-prior"},next)).rejects.toThrow("DELTA_PRIOR_BINDING_MISMATCH");
  await d.pool.query("UPDATE ls_contact_ops.legacy_links SET snapshot_ciphertext=$2 WHERE workspace_id=$1",[d.workspaceId,seal(JSON.stringify({sourceRow:2,payload:{fake:true}}),`ls_contact_ops/legacy/v1/${d.workspaceId}/${sourceFileId}/${sheetId}/${one[0]}`,d.keyring)]);
  await expect(service.preflightDelta(d.practitioner.actor,old,next)).rejects.toThrow("DELTA_PRIOR_CONTENT_MISMATCH");
 } finally {await d.pool.end();}
});

test("operator preflight checks new synthetic rows without writing them", async () => {
 const original = process.argv[1];
 const keys = ["LS_NATIVE_SHADOW_IMPORT_APPROVED", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_ENVIRONMENT_ID"] as const;
 const previous = Object.fromEntries(keys.map(name => [name, process.env[name]]));
 const originalBlind=await f.pool.query<{email_blind:string}>("SELECT email_blind FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);
 try {
  await f.pool.query("UPDATE ls_identity.accounts SET email_blind=$3 WHERE workspace_id=$1 AND id=$2",
   [f.workspaceId,f.practitioner.actor.id,blindEmail(`synthetic-${f.practitioner.actor.id}@example.invalid`,lookupKey)]);
  process.argv[1] = "/app/scripts/shadow-import-operator.ts";
  process.env.LS_NATIVE_SHADOW_IMPORT_APPROVED = "true";
  process.env.RAILWAY_PROJECT_ID = "3b756632-1f66-4f75-a016-eabc37aa0d67";
  process.env.RAILWAY_SERVICE_ID = "0267d061-f3ce-4a0a-82d4-ce133e4501e9";
  process.env.RAILWAY_ENVIRONMENT_ID = "dd91bd71-57cc-45e6-a75b-8c858491d7c7";
  const permit = nativeShadowOperatorPermit();
  const before = await f.pool.query<{n:number}>("SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2",[f.workspaceId,sourceFileId]);
  expect(await importer.preflightNewPeopleAsOperator(f.workspaceId,snapshot(),decide(snapshot()),permit)).toEqual({sourceRevision:"synthetic-revision-1",planned:2,wouldCreate:2,replayed:0});
  const after = await f.pool.query<{n:number}>("SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2",[f.workspaceId,sourceFileId]);
  expect(after.rows[0]!.n).toBe(before.rows[0]!.n);
 } finally {
  await f.pool.query("UPDATE ls_identity.accounts SET email_blind=$3 WHERE workspace_id=$1 AND id=$2",
   [f.workspaceId,f.practitioner.actor.id,originalBlind.rows[0]!.email_blind]);
  if (original === undefined) delete process.argv[1]; else process.argv[1] = original;
  for (const name of keys) if (previous[name] === undefined) delete process.env[name]; else process.env[name] = previous[name]!;
 }
});

test("native PostgreSQL imports all synthetic rows encrypted in one shadow transaction and exact replay is a no-op", async () => {
 const before = await f.pool.query("SELECT count(*)::integer AS n FROM ls_identity.people WHERE workspace_id=$1", [f.workspaceId]);
 const decisions = decide(snapshot());
 expect(await importer.importNewPeople(f.practitioner.actor, snapshot(), decisions)).toEqual({ sourceRevision: "synthetic-revision-1", planned: 2, created: 2, replayed: 0 });
 expect(await importer.importNewPeople(f.practitioner.actor, snapshot(), decisions)).toEqual({ sourceRevision: "synthetic-revision-1", planned: 2, created: 0, replayed: 2 });
 const after = await f.pool.query("SELECT count(*)::integer AS n FROM ls_identity.people WHERE workspace_id=$1", [f.workspaceId]);
 expect(after.rows[0].n - before.rows[0].n).toBe(2);
 const links = await f.pool.query("SELECT legacy_lead_id,person_id,row_digest,snapshot_ciphertext FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2 ORDER BY legacy_lead_id", [f.workspaceId, sourceFileId]);
 expect(links.rowCount).toBe(2);
 expect(new Set(links.rows.map(row => row.person_id)).size).toBe(2);
 const linkedAccountId = randomUUID(), linkedPersonId = links.rows.find(row => row.legacy_lead_id === one[0])!.person_id;
 await f.pool.query(`INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,phone_ciphertext,created_at,updated_at)
  VALUES($1,$2,'parent','invited','en',$3,$4,$5,clock_timestamp(),clock_timestamp())`,
  [linkedAccountId, f.workspaceId, createHash("sha256").update(linkedAccountId).digest("hex"), seal("synthetic-linked@example.invalid", `email:${f.workspaceId}:${linkedAccountId}`, f.keyring), seal(one[2]!, `phone:${f.workspaceId}:${linkedAccountId}`, f.keyring)]);
 await f.pool.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)", [f.workspaceId, linkedAccountId, linkedPersonId]);
 expect(await importer.importNewPeople(f.practitioner.actor, snapshot(), decisions)).toEqual({ sourceRevision: "synthetic-revision-1", planned: 2, created: 0, replayed: 2 });
 await f.pool.query("UPDATE ls_identity.accounts SET phone_ciphertext=$3 WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.parent.actor.id, seal(one[2]!, `phone:${f.workspaceId}:${f.parent.actor.id}`, f.keyring)]);
 await expect(importer.importNewPeople(f.practitioner.actor, snapshot(), decisions)).rejects.toThrow("IMPORT_ACCOUNT_ENDPOINT_COLLISION");
 await f.pool.query("UPDATE ls_identity.accounts SET phone_ciphertext=NULL WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.parent.actor.id]);
 for (const link of links.rows) {
  expect(link.snapshot_ciphertext).not.toContain("Synthetic administrative note");
  expect(link.row_digest).toMatch(/^[0-9a-f]{64}$/);
  const opened = JSON.parse(unseal(link.snapshot_ciphertext, `ls_contact_ops/legacy/v1/${f.workspaceId}/${sourceFileId}/${sheetId}/${link.legacy_lead_id}`, f.keyring));
  expect(opened.sourceRow).toBe(link.legacy_lead_id === one[0] ? 2 : 3);
  expect(opened.payload.sourceFields[" General sales notes "]).toContain("Synthetic administrative note");
 }
 const profiles = await f.pool.query("SELECT person_id,payload_ciphertext,record_mode FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=ANY($2::uuid[])", [f.workspaceId, links.rows.map(row => row.person_id)]);
 expect(profiles.rowCount).toBe(2);
 for (const profile of profiles.rows) {
  expect(profile.record_mode).toBe("live");
  expect(profile.payload_ciphertext).not.toContain("Synthetic administrative note");
  const opened = JSON.parse(unseal(profile.payload_ciphertext, crmProfileAad(f.workspaceId, profile.person_id), f.keyring));
  expect(opened.legacyIds).toHaveLength(1);
  expect(opened.nextAction).toBe(profile.person_id === linkedPersonId ? "Call" : "Follow up");
  expect(opened.notes).toContain("Synthetic administrative note");
  if (profile.person_id === linkedPersonId) expect(opened.followUpDate).toBe("2026-09-27");
 }
 const replayTarget=profiles.rows.find(profile=>profile.person_id===linkedPersonId)!;
 const originalProfile=JSON.parse(unseal(replayTarget.payload_ciphertext,crmProfileAad(f.workspaceId,linkedPersonId),f.keyring));
 await f.pool.query("UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3 WHERE workspace_id=$1 AND person_id=$2",
  [f.workspaceId,linkedPersonId,seal(JSON.stringify({...originalProfile,notes:"Altered synthetic note"}),crmProfileAad(f.workspaceId,linkedPersonId),f.keyring)]);
 try {
  await expect(importer.importNewPeople(f.practitioner.actor,snapshot(),decisions)).rejects.toThrow("IMPORT_REPLAY_PROTECTED_PAYLOAD_MISMATCH");
 } finally {
  await f.pool.query("UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3 WHERE workspace_id=$1 AND person_id=$2",
   [f.workspaceId,linkedPersonId,replayTarget.payload_ciphertext]);
 }
 const originalPerson = await f.pool.query<{profile_ciphertext:string}>(
  "SELECT profile_ciphertext FROM ls_identity.people WHERE workspace_id=$1 AND id=$2",[f.workspaceId,linkedPersonId]);
 await f.pool.query("UPDATE ls_identity.people SET profile_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",
  [f.workspaceId,linkedPersonId,seal(JSON.stringify({displayName:"Different synthetic adult"}),`person:${f.workspaceId}:${linkedPersonId}`,f.keyring)]);
 try {
  await expect(importer.importNewPeople(f.practitioner.actor,snapshot(),decisions)).rejects.toThrow("IMPORT_REPLAY_PROTECTED_PAYLOAD_MISMATCH");
 } finally {
  await f.pool.query("UPDATE ls_identity.people SET profile_ciphertext=$3 WHERE workspace_id=$1 AND id=$2",
   [f.workspaceId,linkedPersonId,originalPerson.rows[0]!.profile_ciphertext]);
 }
 expect(await importer.importNewPeople(f.practitioner.actor,snapshot(),decisions)).toEqual({sourceRevision:"synthetic-revision-1",planned:2,created:0,replayed:2});
 const demo = await f.pool.query("SELECT count(*)::integer AS n FROM ls_demo.records WHERE workspace_id=$1 AND entity_kind='person' AND entity_key=ANY($2::text[])", [f.workspaceId, links.rows.map(row => row.person_id)]);
 expect(demo.rows[0].n).toBe(0);
 const changed = snapshot([[...one.slice(0, 7), "Changed note"], two]);
 await expect(importer.importNewPeople(f.practitioner.actor, changed, decide(changed))).rejects.toThrow("IMPORT_EXISTING_LINK_CONFLICT");
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2", [f.workspaceId, sourceFileId])).rows[0].n).toBe(2);
});

test("replay waits for a concurrent profile update and refuses changed protected data", async () => {
 const person=await f.pool.query<{person_id:string}>("SELECT person_id FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2 AND legacy_lead_id=$3",
  [f.workspaceId,sourceFileId,one[0]]);
 const personId=person.rows[0]!.person_id;
 const original=await f.pool.query<{payload_ciphertext:string}>("SELECT payload_ciphertext FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2",[f.workspaceId,personId]);
 const ciphertext=original.rows[0]!.payload_ciphertext;
 const opened=JSON.parse(unseal(ciphertext,crmProfileAad(f.workspaceId,personId),f.keyring));
 const holder=await f.pool.connect();
 let open=false,attempt:Promise<{ok:boolean;error:Error|null}>|null=null;
 try {
  await holder.query("BEGIN");open=true;
  await holder.query("UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3 WHERE workspace_id=$1 AND person_id=$2",
   [f.workspaceId,personId,seal(JSON.stringify({...opened,notes:"Concurrent synthetic change"}),crmProfileAad(f.workspaceId,personId),f.keyring)]);
  let settled=false;
  attempt=importer.importNewPeople(f.practitioner.actor,snapshot(),decide(snapshot()))
   .then(()=>({ok:true,error:null}),error=>({ok:false,error:error as Error})).finally(()=>{settled=true});
  await new Promise(resolve=>setTimeout(resolve,75));
  expect(settled).toBe(false);
  await holder.query("COMMIT");open=false;
  const result=await attempt;
  expect(result.ok).toBe(false);
  expect(result.error?.message).toContain("IMPORT_REPLAY_PROTECTED_PAYLOAD_MISMATCH");
 } finally {
  if(open)await holder.query("ROLLBACK");
  holder.release();
  if(attempt)await attempt;
  await f.pool.query("UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3 WHERE workspace_id=$1 AND person_id=$2",[f.workspaceId,personId,ciphertext]);
 }
 expect(await importer.importNewPeople(f.practitioner.actor,snapshot(),decide(snapshot()))).toEqual({sourceRevision:"synthetic-revision-1",planned:2,created:0,replayed:2});
});

test("shadow importer rejects incomplete decisions, non-practitioner and mismatched source before any contact insert", async () => {
 const otherFile = `synthetic-${randomUUID()}`;
 await expect(importer.importNewPeople(f.practitioner.actor, snapshot([one], otherFile), decide(snapshot([one], otherFile)))).rejects.toThrow("IMPORT_SOURCE_MISMATCH");
 await expect(importer.importNewPeople(f.practitioner.actor, snapshot([one], otherFile), [])).rejects.toThrow("IMPORT_SOURCE_MISMATCH");
 const fresh = new NativeShadowImporter(poolStore(f.pool), f.keyring, lookupKey, key, otherFile, sheetId);
 await expect(fresh.importNewPeople(f.practitioner.actor, snapshot([one], otherFile), [])).rejects.toThrow("IMPORT_DISPOSITION_INCOMPLETE");
 await expect(fresh.importNewPeople(f.parent.actor, snapshot([one], otherFile), decide(snapshot([one], otherFile)))).rejects.toThrow("FORBIDDEN");
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2", [f.workspaceId, otherFile])).rows[0].n).toBe(0);
});

test("shadow importer refuses a live account phone collision and preserves the whole transaction", async () => {
 const special = ["LS-LEAD-synthetic-collision", "Synthetic collision", "+15555550103", "", "New inquiry", "Call", "", "Private synthetic text"];
 const ciphertext = seal(special[2]!, `phone:${f.workspaceId}:${f.parent.actor.id}`, f.keyring);
 await f.pool.query("UPDATE ls_identity.accounts SET phone_ciphertext=$3 WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.parent.actor.id, ciphertext]);
 const collision = snapshot([one, two, special]);
 await expect(importer.importNewPeople(f.practitioner.actor, collision, decide(collision))).rejects.toThrow("IMPORT_ACCOUNT_ENDPOINT_COLLISION");
 expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2", [f.workspaceId, sourceFileId])).rows[0].n).toBe(2);
});

test("shadow importer waits for the identity workspace lock and sees a newly committed account phone", async () => {
 const raceRow = ["LS-LEAD-synthetic-race", "Synthetic race", "+15555550104", "", "New inquiry", "Call", "", "Synthetic note"];
 const holder = await f.pool.connect();
 let open = false;
 try {
  await holder.query("BEGIN");
  open = true;
  await holder.query("SELECT id FROM ls_identity.workspaces WHERE id=$1 FOR UPDATE", [f.workspaceId]);
  await holder.query("UPDATE ls_identity.accounts SET phone_ciphertext=$3 WHERE workspace_id=$1 AND id=$2", [f.workspaceId, f.parent.actor.id, seal(raceRow[2]!, `phone:${f.workspaceId}:${f.parent.actor.id}`, f.keyring)]);
  let settled = false;
  const race = snapshot([one, two, raceRow]);
  const attempt = importer.importNewPeople(f.practitioner.actor, race, decide(race))
   .then(() => ({ ok: true, error: null }), error => ({ ok: false, error: error as Error }))
   .finally(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 75));
  expect(settled).toBe(false);
  await holder.query("COMMIT");
  open = false;
  const result = await attempt;
  expect(result.ok).toBe(false);
  expect(result.error?.message).toContain("IMPORT_ACCOUNT_ENDPOINT_COLLISION");
  expect((await f.pool.query("SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2", [f.workspaceId, sourceFileId])).rows[0].n).toBe(2);
 } finally {
  if (open) await holder.query("ROLLBACK");
  holder.release();
 }
});

test("exact operator permit replays the synthetic import without a browser session or new records", async () => {
 const original = process.argv[1];
 const keys = ["LS_NATIVE_SHADOW_IMPORT_APPROVED", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_ENVIRONMENT_ID"] as const;
 const previous = Object.fromEntries(keys.map(key => [key, process.env[key]]));
 const originalBlind=await f.pool.query<{email_blind:string}>("SELECT email_blind FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);
 try {
  await f.pool.query("UPDATE ls_identity.accounts SET email_blind=$3 WHERE workspace_id=$1 AND id=$2",
   [f.workspaceId,f.practitioner.actor.id,blindEmail(`synthetic-${f.practitioner.actor.id}@example.invalid`,lookupKey)]);
  process.argv[1] = "/app/scripts/shadow-import-operator.ts";
  process.env.LS_NATIVE_SHADOW_IMPORT_APPROVED = "true";
  process.env.RAILWAY_PROJECT_ID = "3b756632-1f66-4f75-a016-eabc37aa0d67";
  process.env.RAILWAY_SERVICE_ID = "0267d061-f3ce-4a0a-82d4-ce133e4501e9";
  process.env.RAILWAY_ENVIRONMENT_ID = "dd91bd71-57cc-45e6-a75b-8c858491d7c7";
  const permit = nativeShadowOperatorPermit();
  const wrongLookup=new NativeShadowImporter(poolStore(f.pool),f.keyring,Buffer.alloc(32,7),key,sourceFileId,sheetId);
  await expect(wrongLookup.importNewPeopleAsOperator(f.workspaceId,snapshot(),decide(snapshot()),permit)).rejects.toThrow("IMPORT_OPERATOR_CRYPTO_KEYS_INVALID");
  const wrongRing={activeKeyId:f.keyring.activeKeyId,keys:{...f.keyring.keys,[f.keyring.activeKeyId]:Buffer.alloc(32,7)}};
  const wrongDataKey=new NativeShadowImporter(poolStore(f.pool),wrongRing,lookupKey,key,sourceFileId,sheetId);
  await expect(wrongDataKey.importNewPeopleAsOperator(f.workspaceId,snapshot(),decide(snapshot()),permit)).rejects.toThrow("IMPORT_OPERATOR_CRYPTO_KEYS_INVALID");
  await expect(importer.importNewPeopleAsOperator(f.workspaceId, snapshot(), decide(snapshot()), Symbol("forged"))).rejects.toThrow("IMPORT_OPERATOR_NOT_ADMITTED");
  await expect(importer.preflightNewPeopleAsOperator(f.workspaceId, snapshot(), decide(snapshot()), Symbol("forged"))).rejects.toThrow("IMPORT_OPERATOR_NOT_ADMITTED");
  const mixed=snapshot([one,["LS-LEAD-synthetic-mixed","Synthetic replacement","+15555550999","","New inquiry","Call","","Synthetic note"]]);
  await expect(importer.preflightNewPeopleAsOperator(f.workspaceId,mixed,decide(mixed),permit)).rejects.toThrow("IMPORT_EXISTING_LINK_SET_MISMATCH");
  expect(await importer.preflightNewPeopleAsOperator(f.workspaceId, snapshot(), decide(snapshot()), permit)).toEqual({sourceRevision:"synthetic-revision-1",planned:2,wouldCreate:0,replayed:2});
  expect(await importer.importNewPeopleAsOperator(f.workspaceId, snapshot(), decide(snapshot()), permit)).toEqual({sourceRevision:"synthetic-revision-1",planned:2,created:0,replayed:2});
  const prior = await f.pool.query<{email_verified_at:Date;state:string}>("SELECT email_verified_at,state FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);
  // The database correctly forbids an active account without verified email.
  // An invited account is the valid synthetic state that must not operate.
  await f.pool.query("UPDATE ls_identity.accounts SET state='invited',email_verified_at=NULL WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id]);
  try {
   await expect(importer.importNewPeopleAsOperator(f.workspaceId, snapshot(), decide(snapshot()), permit)).rejects.toThrow("IMPORT_OPERATOR_ACCOUNT_REQUIRES_REVIEW");
   await expect(importer.preflightNewPeopleAsOperator(f.workspaceId, snapshot(), decide(snapshot()), permit)).rejects.toThrow("IMPORT_OPERATOR_ACCOUNT_REQUIRES_REVIEW");
  } finally {
   await f.pool.query("UPDATE ls_identity.accounts SET state=$3,email_verified_at=$4 WHERE workspace_id=$1 AND id=$2",[f.workspaceId,f.practitioner.actor.id,prior.rows[0]!.state,prior.rows[0]!.email_verified_at]);
  }
  delete process.env.LS_NATIVE_SHADOW_IMPORT_APPROVED;
  await expect(importer.importNewPeopleAsOperator(f.workspaceId, snapshot(), decide(snapshot()), permit)).rejects.toThrow("IMPORT_OPERATOR_NOT_ADMITTED");
 } finally {
  await f.pool.query("UPDATE ls_identity.accounts SET email_blind=$3 WHERE workspace_id=$1 AND id=$2",
   [f.workspaceId,f.practitioner.actor.id,originalBlind.rows[0]!.email_blind]);
  if (original === undefined) delete process.argv[1];
  else process.argv[1] = original;
  for (const key of keys) {
   if (previous[key] === undefined) delete process.env[key];
   else process.env[key] = previous[key]!;
  }
 }
});

test("live profile creation shares the import workspace lock and an unlinked profile blocks shadow import", async () => {
 const holder = await f.pool.connect();
 let open = false;
 try {
  await holder.query("BEGIN");
  open = true;
  await holder.query("SELECT id FROM ls_identity.workspaces WHERE id=$1 FOR UPDATE", [f.workspaceId]);
  const native = new NativeCrmStore(poolStore(f.pool), f.keyring, key);
  let settled = false;
  const create = native.create(f.practitioner.actor, { personId: f.outsider.actor.personId, stage: "New inquiry", nextAction: null, followUpDate: null, notes: "Synthetic administrative note", legacyIds: [] }, `synthetic-create-${randomUUID()}`)
   .then(value => ({ ok: true, value, error: null }), error => ({ ok: false, value: null, error: error as Error }))
   .finally(() => { settled = true; });
  await new Promise(resolve => setTimeout(resolve, 75));
  expect(settled).toBe(false);
  await holder.query("COMMIT");
  open = false;
  const result = await create;
  expect(result.ok).toBe(true);
  expect(result.value).toEqual({ version: 1, replayed: false });
  await expect(importer.importNewPeople(f.practitioner.actor, snapshot(), decide(snapshot()))).rejects.toThrow("IMPORT_UNLINKED_NATIVE_PROFILE_REQUIRES_REVIEW");
 } finally {
  if (open) await holder.query("ROLLBACK");
  holder.release();
 }
});
