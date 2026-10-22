/** Actual additive upgrade on the exclusive disposable native database.
 * Historical V1/V2 source facts are explicitly synthetic storage fixtures;
 * they confer no curriculum, merchant, migration or production admission. */
import {admitNativeCi,nativeCiProofPath} from '../native-ci-admission.ts';
import {createHash,randomUUID} from 'node:crypto';
import {readFile,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import type {PoolClient} from 'pg';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {programFixture} from './native-program-fixture.ts';
import {migrate} from '../../../src/db/migration-runner.ts';
import {loadAcademySchemaSources,type AcademySchemaConnection} from '../../../src/db/academy-schema-preflight.ts';
import {loadTravelCreditSchemaSources,readTravelCreditSchemaPreflight,travelCreditSchemaPins} from '../../../src/db/academy-travel-credit-preflight.ts';
import {AcademySessionCreditStore,academyCreditFactsSchema,academyCreditFactsV2Schema,academyCreditDigest} from '../../../src/features/fishing-stage/academy-session-credit-store.ts';
import {academySessionPolicyNativeVersion,academyCalendarCompatibilityVersion,type AcademySessionCreditCommandResult} from '../../../src/features/fishing/academy-session-policy-native-contract.ts';
import {academyPolicyPreflightVersion} from '../../../src/features/fishing/academy-policy-preflight-contract.ts';
const hash=(value:string)=>createHash('sha256').update(value).digest('hex');
const qualified=(value:string)=>{if(!/^ls_fishing_(?:payments|stage)\.[a-z_]+$/.test(value))throw Error('FIXED_CANDIDATE_TABLE_REQUIRED');return value;};
test('real 32-to-35-to-41 upgrade preserves V1/V2 sealed history, rolls failed DDL back, replays once and detects actual catalog drift without admitting runtime',async()=>{
 const ci=await admitNativeCi(['base']);
 if(!ci&&(process.env.LS_ACADEMY_TRAVEL_UPGRADE!=='SYNTHETIC_LOOPBACK_ONLY'))throw Error('EXPLICIT_DISPOSABLE_TRAVEL_UPGRADE_REQUIRED');
 const f=await programFixture({confirmation:{kind:'all_native_dues_paid'}});let client:PoolClient|null=null;
 try{
  const root=new URL('../../../',import.meta.url),base=await loadAcademySchemaSources(root),overlay=await loadTravelCreditSchemaSources(root);
  expect(base.tables).toHaveLength(32);expect(overlay.tables).toHaveLength(41);expect(base.baseline).toHaveLength(55);
  const manifestBytes=await readFile(new URL('migrations/manifest.json',root),'utf8'),manifest=JSON.parse(manifestBytes) as {name:string;sha256:string}[];
  const files=await Promise.all(manifest.map(async pin=>{const sql=await readFile(new URL('migrations/'+pin.name,root),'utf8');expect(hash(sql)).toBe(pin.sha256);return {name:pin.name,checksum:pin.sha256,sql};}));
  const sqls=await Promise.all(travelCreditSchemaPins.map(async pin=>{const sql=await readFile(new URL(pin.path,root),'utf8');expect(hash(sql)).toBe(pin.sha256);return sql;}));
  for(const sql of sqls)expect(sql).not.toMatch(/^\s*(?:DROP|UPDATE|DELETE|TRUNCATE|GRANT|CREATE OR REPLACE)\b/im);
  await f.createPlan();const family=await f.family(),purchase=await f.prepare(family);await f.settle(purchase);const enrollment=await f.enroll(purchase);await f.publish();
  const parentBefore=await f.stage(family.parent,enrollment.result.id).read(family.parent,f.ref),paymentBefore=await f.paymentStore.readPayment(f.owner,purchase.purchaseId);
  expect(parentBefore?.occurrences).toHaveLength(12);expect(paymentBefore?.paidCents).toBe(175000);
  client=await f.pool.connect();const dbClient=client,connection:AcademySchemaConnection={query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>dbClient.query<R>(sql,[...values])};
  const actual=(await client.query('SELECT current_database() AS name,host(inet_server_addr()) AS host,inet_server_port() AS port')).rows[0];
  const target=new URL(process.env.TEST_DATABASE_URL!);if(actual.name!==target.pathname.slice(1)||(ci?actual.name!==ci.database:!/^ls_calendar_test_rm_guard_[a-f0-9]{32}_test$/.test(actual.name))||actual.host!==(ci?.serverAddress??'127.0.0.1')||actual.port!==Number(target.port))throw Error('EXCLUSIVE_NATIVE_UPGRADE_TARGET_REQUIRED');
  const originalCatalog=await readTravelCreditSchemaPreflight(connection,base,null);expect(originalCatalog).toMatchObject({state:'unreviewed',baselineMatches:true,mutationAllowed:false});
  expect(originalCatalog.catalog.relations.filter(r=>r.kind==='r')).toHaveLength(32);
  await client.query(sqls[0]!);const oldTables=[...base.tables,...sqls[0]!.matchAll(/CREATE TABLE\s+(ls_fishing_stage\.[a-z_]+)/g)].map(v=>typeof v==='string'?v:v[1]!);
  expect(oldTables).toHaveLength(35);
  const seeded=[];
  for(const [index,kind]of ['V1','V2'].entries()){
   const occurrence=parentBefore!.occurrences[index]!,anchor={workspaceId:f.workspaceId,learnerId:family.learnerId,cohortId:f.ref.cohortId,stageId:f.ref.stageId,occurrenceId:occurrence.id,ordinal:index+1,moduleId:f.template.modules[index]!.moduleId,moduleVersion:f.template.modules[index]!.moduleVersion,activityId:'synthetic-archived-'+kind};
   const facts=academyCreditFactsSchema.parse({anchor,enrollmentId:enrollment.result.id,purchaseId:purchase.purchaseId,purchaseLineId:purchase.offer.lines[0]!.id,householdId:family.householdId,guardianBindingId:'synthetic-archived-guardian',acceptedTermsVersion:'synthetic-archived-terms',inquiry:{workspaceId:f.workspaceId,applicationId:randomUUID(),fieldsDigest:hash('synthetic archived inquiry'),learnerIndex:0,drivePreferenceDigest:hash('synthetic archived preference')},stageRevision:parentBefore!.revision,sourceEvidenceId:'synthetic-archived-'+kind,evidenceRevision:1,evidenceDigest:hash('synthetic archived evidence '+kind),duration:{version:academyPolicyPreflightVersion,sessionKind:'ordinary',time:{kind:'undated',timeZone:'America/New_York'}},travel:{version:academyPolicyPreflightVersion,original:anchor,sessionKind:'ordinary',obligation:{anchor,evidenceId:'synthetic-archived-paid-original',state:'purchased_undelivered'},change:{anchor,kind:'academy_schedule',evidenceId:'synthetic-archived-'+kind,weatherQualification:'unknown',recordedDriveLimit:'up_to_30',revisedOneWayMinutes:45,familyCannotAttend:true}},legacyCredit:null});
   const value=kind==='V1'?facts:academyCreditFactsV2Schema.parse({...facts,compatibility:{version:academyCalendarCompatibilityVersion,originalStage:1},travel:{...facts.travel,change:{...facts.travel.change,recordedDriveLimit:35}}});
   const operationId=randomUUID(),requestDigest=academyCreditDigest({syntheticHistoricalCommand:kind,operationId}),credit={id:randomUUID(),anchor,enrollmentId:enrollment.result.id,purchaseId:purchase.purchaseId,purchaseLineId:purchase.offer.lines[0]!.id,state:'outstanding' as const,replacementReservationId:null},result:AcademySessionCreditCommandResult={version:academySessionPolicyNativeVersion,outcome:'issued',reason:'academy_change_exceeds_limit',credit,replayed:false,mayBook:false,mayMarkDelivered:false,specificDateOrSeatGuaranteed:false};
   await f.db.transaction(async tx=>{const store=new AcademySessionCreditStore(tx,f.ring),now=new Date(),evidenceId=await store.recordEvidence(value,now);await store.insert(credit,evidenceId,now);await store.recordEvent(f.workspaceId,family.parent.id,operationId,requestDigest,evidenceId,value,result,now);});
   seeded.push({operationId,requestDigest,facts:value,credit,result});
  }
  const capture=async()=>Promise.all(oldTables.map(async table=>({table,rows:(await dbClient.query('SELECT to_jsonb(t) AS row FROM '+qualified(table)+' t ORDER BY to_jsonb(t)::text')).rows})));
  const oldRows=await capture(),historyBefore=(await client.query('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows;
  const before=await readTravelCreditSchemaPreflight(connection,overlay,null);expect(before).toMatchObject({state:'partial',baselineMatches:true,mutationAllowed:false});
  const name='9999_synthetic_travel_overlay.sql',proposal={name,sql:sqls[1]!,checksum:hash(sqls[1]!)},failedSql=sqls[1]!+'\nSELECT 1/0;\n';
  await expect(migrate(client,[...files,{name,sql:failedSql,checksum:hash(failedSql)}],false)).rejects.toThrow('MIGRATION_FAILED');
  expect(await capture()).toEqual(oldRows);expect((await client.query('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows).toEqual(historyBefore);
  expect(await readTravelCreditSchemaPreflight(connection,overlay,null)).toMatchObject({state:'partial',catalogSha256:before.catalogSha256,mutationAllowed:false});
  expect(await migrate(client,[...files,proposal],false)).toEqual({applied:1,pending:0});expect(await migrate(client,[...files,proposal],false)).toEqual({applied:0,pending:0});
  await expect(migrate(client,[...files,{...proposal,checksum:hash(proposal.sql+'\n')}],false)).rejects.toThrow('MIGRATION_HISTORY_DIVERGED');expect(await capture()).toEqual(oldRows);
  const current=await readTravelCreditSchemaPreflight(connection,overlay,null);expect(current).toMatchObject({state:'baseline_mismatch',baselineMatches:false,mutationAllowed:false,identity:{readonly:'on',isolation:'repeatable read'}});expect(current.catalog.relations.filter(r=>r.kind==='r')).toHaveLength(41);
  expect(current.catalog.triggers.filter(r=>r.function==='academy_travel_immutable'&&!r.internal)).toHaveLength(9);expect(current.catalog.functions.filter(r=>r.name==='academy_travel_immutable')).toHaveLength(1);
  // A disposable reference with an explicit synthetic56 ledger can exercise
  // catalog drift classification. The real pinned55 source stays mismatched.
  const syntheticSources={...overlay,baseline:[...overlay.baseline,{name,checksum:proposal.checksum}]},reference=current.catalogSha256;
  expect(await readTravelCreditSchemaPreflight(connection,syntheticSources,reference)).toMatchObject({state:'match',mutationAllowed:false});
  const checkRestored=async()=>expect(await readTravelCreditSchemaPreflight(connection,syntheticSources,reference)).toMatchObject({state:'match',catalogSha256:reference,mutationAllowed:false});
  await client.query('ALTER TABLE ls_fishing_stage.academy_travel_declarations RENAME TO synthetic_missing_declarations');
  try{expect((await readTravelCreditSchemaPreflight(connection,syntheticSources,reference)).state).toBe('partial');}finally{await client.query('ALTER TABLE ls_fishing_stage.synthetic_missing_declarations RENAME TO academy_travel_declarations');}await checkRestored();
  await client.query('CREATE INDEX synthetic_travel_drift ON ls_fishing_stage.academy_travel_changes(learner_id)');
  try{expect((await readTravelCreditSchemaPreflight(connection,syntheticSources,reference)).state).toBe('drift');}finally{await client.query('DROP INDEX ls_fishing_stage.synthetic_travel_drift');}await checkRestored();
  await client.query('GRANT SELECT ON ls_fishing_stage.academy_session_credits TO PUBLIC');
  try{expect((await readTravelCreditSchemaPreflight(connection,syntheticSources,reference)).state).toBe('drift');}finally{await client.query('REVOKE SELECT ON ls_fishing_stage.academy_session_credits FROM PUBLIC');}await checkRestored();
  // Never disable an integrity trigger, even in this disposable upgrade test.
  for(const table of ['academy_session_policy_evidence','academy_session_credits','academy_session_credit_events']){
   await expect(client.query('UPDATE ls_fishing_stage.'+table+' SET workspace_id=workspace_id WHERE workspace_id=$1',[f.workspaceId])).rejects.toThrow('ACADEMY_TRAVEL_HISTORY_IMMUTABLE');
   await expect(client.query('DELETE FROM ls_fishing_stage.'+table+' WHERE workspace_id=$1',[f.workspaceId])).rejects.toThrow('ACADEMY_TRAVEL_HISTORY_IMMUTABLE');
  }
  const records=await f.db.transaction(tx=>new AcademySessionCreditStore(tx,f.ring).selected(f.workspaceId,enrollment.result.id,family.learnerId));expect(records).toEqual(seeded.map(s=>s.credit));
  for(const item of seeded)expect(await f.db.transaction(tx=>new AcademySessionCreditStore(tx,f.ring).replay(f.workspaceId,family.parent.id,item.operationId,item.requestDigest,item.facts))).toEqual({...item.result,replayed:true});
  expect(await f.stage(family.parent,enrollment.result.id).read(family.parent,f.ref)).toEqual(parentBefore);expect(await f.paymentStore.readPayment(f.owner,purchase.purchaseId)).toEqual(paymentBefore);
  let attempted=false;const readOnlyTrap:AcademySchemaConnection={query:async<R extends object>(sql:string,values:readonly unknown[]=[])=>{if(sql.startsWith('SELECT current_database()')){attempted=true;await dbClient.query('CREATE TABLE ls_fishing_stage.synthetic_forbidden_travel(id integer)');}return connection.query<R>(sql,values);}};
  await expect(readTravelCreditSchemaPreflight(readOnlyTrap,syntheticSources,reference)).rejects.toThrow(/read-only/);expect(attempted).toBe(true);expect((await client.query("SELECT to_regclass('ls_fishing_stage.synthetic_forbidden_travel') AS found")).rows[0]!.found).toBeNull();expect((await client.query('SHOW transaction_read_only')).rows[0]!.transaction_read_only).toBe('off');await checkRestored();
  expect(await capture()).toEqual(oldRows);expect(await readFile(new URL('migrations/manifest.json',root),'utf8')).toBe(manifestBytes);
  expect(await readTravelCreditSchemaPreflight(connection,overlay,reference)).toMatchObject({state:'baseline_mismatch',mutationAllowed:false});
  const ciProof=nativeCiProofPath('travel-upgrade-proof.json'),proofPath=ciProof??resolve(process.env.LS_ACADEMY_TRAVEL_UPGRADE_PROOF??'');if(!ciProof&&!/^C:\/Users\/User\/Documents\/Codex\/2026-10-21\/files-pasted-by-the-user-codex\/work\/pr193-pg-[A-Za-z0-9]+\/travel-upgrade-proof\.json$/.test(proofPath.replaceAll('\\','/')))throw Error('OWNED_TRAVEL_UPGRADE_PROOF_PATH_REQUIRED');
  await writeFile(proofPath,JSON.stringify({scope:'DISPOSABLE_SYNTHETIC_TRAVEL_ADDITIVE_UPGRADE_NOT_ADOPTED',baselineManifest55Unchanged:true,originalTables:32,historicalTables:35,upgradedTables:41,historicalEnvelopes:['V1','V2'],historicalRowsAndCiphertextPreserved:true,preservedTables:oldRows.map(t=>({table:t.table,rowCount:t.rows.length,sha256:hash(JSON.stringify(t.rows))})),failedDdlAndLedgerRolledBack:true,appliedOnceReplayNoopChecksumMismatchDenied:true,oldReceiptsReadableAndReplayable:true,ordinaryParentTwelveLessonReadbackPreserved:true,nativePrepay175000ReadbackPreserved:true,immutableTriggers:9,oldPopulatedCreditTablesUpdateAndDeleteDenied:3,partialAndIndexAndAclDriftRestored:true,readOnlyDdlDeniedAndRolledBack:true,actualPinned55AfterSynthetic56:'baseline_mismatch',mutationAllowed:false,sourcePins:travelCreditSchemaPins,sourceAndServingCatalogAdopted:false,productionOrProviderEffect:false},null,2));
 }finally{client?.release();await f.close();}
},120000);
