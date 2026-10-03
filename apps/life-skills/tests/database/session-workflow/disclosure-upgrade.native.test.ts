/** Populated 31→32 in a fresh disposable loopback database. No live migration. */
import {expect,test,vi} from "vitest";
import {readFileSync} from "node:fs";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import pg from "pg";
import {fixture,poolStore,safeTestUrl,type Fixture} from "../calendar/fixture.ts";
import {migrate,type MigrationClient} from "../../../src/db/migration-runner.ts";
import type {Migration} from "../../../src/db/migration-plan.ts";
import {scopedDisclosureCatalog,scopedDisclosureIntegrity,SCOPED_DISCLOSURE_USE_MIGRATION} from "../../../src/db/scoped-disclosure-integrity.ts";
import type {SqlSession} from "../../../src/features/identity/store.ts";
import {SessionDatabaseService} from "../../../src/features/session-workflow/database.ts";
import {systemClock} from "../../../src/features/identity/types.ts";
test("populated native disclosure upgrade preserves all original scopes/receipts/catalogs and admits only actual-use operation",async()=>{
 const cluster=new URL(safeTestUrl());expect(["localhost","127.0.0.1","[::1]"]).toContain(cluster.hostname);
 const name="ls_calendar_test_disclosure_upgrade_"+randomBytes(8).toString("hex");if(!/^ls_calendar_test_disclosure_upgrade_[a-f0-9]{16}$/.test(name))throw Error("DISPOSABLE_NAME_REQUIRED");
 const adminUrl=new URL(cluster);adminUrl.pathname="/postgres";const dbUrl=new URL(cluster);dbUrl.pathname="/"+name;
 const admin=new pg.Pool({connectionString:adminUrl.toString(),ssl:false,max:1}),pool=new pg.Pool({connectionString:dbUrl.toString(),ssl:false,max:1});let created=false,client:pg.PoolClient|undefined,f:Fixture|undefined;
 try{await admin.query(`CREATE DATABASE "${name}"`);created=true;client=await pool.connect();
  const manifest=JSON.parse(readFileSync(new URL("../../../migrations/manifest.json",import.meta.url),"utf8")) as {name:string;sha256:string}[],files:Migration[]=manifest.map(m=>{const sql=readFileSync(new URL(`../../../migrations/${m.name}`,import.meta.url),"utf8");expect(createHash("sha256").update(sql).digest("hex")).toBe(m.sha256);return {name:m.name,checksum:m.sha256,sql};});
  // Keep this historical 31→32 test exact, even when later registered suffixes exist.
  files.splice(files.findIndex(file=>file.name===SCOPED_DISCLOSURE_USE_MIGRATION.name)+1);
  expect(files).toHaveLength(32);expect(files.at(-1)?.name).toBe(SCOPED_DISCLOSURE_USE_MIGRATION.name);
  const runner:MigrationClient={query:async(sql,args)=>client!.query(sql,args?[...args]:undefined)},tx:SqlSession={query:async <R extends object>(sql:string,args:readonly unknown[]=[]) => (await client!.query<R>(sql,[...args])).rows};
  expect(await migrate(runner,files.slice(0,-1),false)).toEqual({applied:31,pending:0});vi.stubEnv("TEST_DATABASE_URL",dbUrl.toString());vi.stubEnv("LS_CALENDAR_TEST_ALLOW","true");f=await fixture();
  const service=new SessionDatabaseService(poolStore(f.pool),f.keyring,systemClock),sessionId=(await service.ensureForAppointment(f.practitioner.actor,f.first.id,await f.seed(f.at(-24)))).sessionId,input={recipient:"DEMO — Synthetic agreed contact",purpose:"Specific synthetic purpose",topic:"Only agreed classroom practice",authorityBasis:"Synthetic actual signed scope/reference and checked authority, no legal certification.",authorityState:"checked" as const,channel:"phone" as const,authorizedByAccountId:f.parent.actor.id,childDiscussionRecorded:true,authorizedAt:f.at(-24),expiresAt:f.at(24)};
  const key=randomUUID(),record=await service.authorizeDisclosure(f.practitioner.actor,sessionId,input,key);
  const snapshot=async()=>{const result:Record<string,unknown>={};for(const table of ["recording_consents","sessions","command_receipts","disclosure_authorizations"])result[table]=(await client!.query(`SELECT to_jsonb(t) AS row FROM ls_sessions.${table} t ORDER BY to_jsonb(t)::text`)).rows;return result;};
  const before=await snapshot(),ledger=(await client.query("SELECT * FROM ls_control.migrations ORDER BY name")).rows,catalog=await scopedDisclosureCatalog(tx);
  console.log(JSON.stringify({cleanSessionBaselineCatalogSha256:catalog.sha256,baselineOperation:catalog.operation}));
  expect(await scopedDisclosureIntegrity(tx,files)).toEqual({baselineOperation:true,currentOperation:false,schemaCatalog:true,foreignKeys:true,permissions:true});
  await expect(service.recordDisclosureUse(f.practitioner.actor,sessionId,record.disclosureId,{usedAt:f.at(-1)},randomUUID())).rejects.toMatchObject({cause:{code:"23514"}});expect(await snapshot()).toEqual(before);
  expect(await migrate(runner,files,false)).toEqual({applied:1,pending:0});expect(await snapshot()).toEqual(before);expect((await client.query("SELECT * FROM ls_control.migrations WHERE name<>$1 ORDER BY name",[SCOPED_DISCLOSURE_USE_MIGRATION.name])).rows).toEqual(ledger);
  expect(await migrate(runner,files,false)).toEqual({applied:0,pending:0});expect(await migrate(runner,files,true)).toEqual({applied:0,pending:0});expect(await service.authorizeDisclosure(f.practitioner.actor,sessionId,input,key)).toEqual(record);
  const proof={baselineOperation:false,currentOperation:true,schemaCatalog:true,foreignKeys:true,permissions:true};expect(await scopedDisclosureIntegrity(tx,files)).toEqual(proof);expect((await scopedDisclosureCatalog(tx)).sha256).toBe(catalog.sha256);
  const used=await service.recordDisclosureUse(f.practitioner.actor,sessionId,record.disclosureId,{usedAt:f.at(-1)},randomUUID());expect((await service.disclosures(f.practitioner.actor,sessionId,record.disclosureId))[0]).toMatchObject({usedAt:used.usedAt,effective:false});
  for(const [sql,key] of [["ALTER TABLE ls_sessions.disclosure_authorizations ADD COLUMN drift text","schemaCatalog"],["GRANT SELECT ON ls_sessions.disclosure_authorizations TO PUBLIC","permissions"],["ALTER TABLE ls_sessions.command_receipts DROP CONSTRAINT command_receipts_operation_check","currentOperation"],["ALTER TABLE ls_sessions.disclosure_authorizations DISABLE TRIGGER ALL","foreignKeys"]] as const){await client.query("BEGIN");try{await client.query(sql);expect((await scopedDisclosureIntegrity(tx,files))[key]).toBe(false);}finally{await client.query("ROLLBACK");}}
  expect(await scopedDisclosureIntegrity(tx,files)).toEqual(proof);
 }finally{vi.unstubAllEnvs();await f?.pool.end();client?.release();await pool.end();if(created)await admin.query(`DROP DATABASE "${name}"`);await admin.end();}
},30_000);
