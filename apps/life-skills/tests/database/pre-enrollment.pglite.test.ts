import { readFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, relative, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const http=vi.hoisted(()=>({runtime:vi.fn(),project:vi.fn(async()=>false)}));
vi.mock("../../src/features/identity/runtime.ts",()=>({identityRuntime:http.runtime}));
vi.mock("../../src/features/contact-ops/server/authoritative-prospect-send.ts",()=>({projectIntakeToLegacyIfCurrent:http.project}));
import {POST as publicPost} from "../../src/app/api/intake/route.ts";
import {POST as staffPost,GET as staffGet} from "../../src/app/api/intake/staff/route.ts";
import {SESSION_COOKIE} from "../../src/lib/security/session.ts";
import { SqlPreEnrollmentRepository } from "../../src/features/forms/pre-enrollment/repository.ts";
import { PreEnrollmentService, type PreEnrollmentRepository } from "../../src/features/forms/pre-enrollment/service.ts";
import { PreEnrollmentStaffService } from "../../src/features/forms/pre-enrollment/staff.ts";
import { publicConsentHash } from "../../src/features/forms/pre-enrollment/consent.ts";
import type { IdentityStore, SqlSession } from "../../src/features/identity/store.ts";
import type { Actor } from "../../src/features/identity/types.ts";
import {issueSyntheticIntake,isSyntheticIntakeReceipt} from "../../src/features/forms/pre-enrollment/synthetic-fixture.ts";
import {projectSubmittedIntake} from "../../src/features/forms/pre-enrollment/submission-projection.ts";

type DbTx = { query<T extends object = Record<string, unknown>>(text: string, values?: readonly unknown[]): Promise<{ rows: T[] }>; exec(text: string): Promise<unknown> };
type Db = DbTx & { transaction<T>(work: (tx: DbTx) => Promise<T>): Promise<T>; close(): Promise<void> };
type PGliteCtor = new (path?: string) => Db;
const workspace = "00000000-0000-4000-8000-000000000001";
const otherWorkspace = "00000000-0000-4000-8000-000000000002";
const practitioner = "00000000-0000-4000-8000-000000000003";
const parent = "00000000-0000-4000-8000-000000000004";
const otherPractitioner = "00000000-0000-4000-8000-000000000005";
const now = new Date("2029-01-01T12:00:00.000Z");
const ring = { activeKeyId: "k", keys: { k: Buffer.alloc(32, 1) } };
const consent = { version: "test-source-20260916", sourceHashes: ["701cce537e8cc14f94b593cc6c321330ee0275207386ff8137f259630ca5e073", "3d9dc543abeee4d168130d3ab63d6a66b9367aab218868f30b05b78bfbc1f73d"], displayText: ["Synthetic source-controlled display text."], acknowledgements: ["One.", "Two.", "Three."] };
process.env.LS_INTAKE_PUBLIC_CONSENT_JSON = JSON.stringify(consent);

function store(db: Db): IdentityStore { return { transaction: <T>(work: (tx: SqlSession) => Promise<T>) => db.transaction(tx => work({ query: <R extends object>(text: string, values: readonly unknown[] = []): Promise<R[]> => tx.query<R>(text, values).then(result => result.rows) })) }; }
function sessionDigest(id: string) { return id.replaceAll("-", "").padEnd(64, "0"); }
function actor(id: string, role: Actor["role"], workspaceId = workspace): Actor { return { id: id as Actor["id"], personId: id as Actor["personId"], workspaceId: workspaceId as Actor["workspaceId"], role, state: "active", locale: "en", sessionDigest: sessionDigest(id), expiresAt: now.getTime() + 86_400_000 }; }
async function migrate(db: Db) {
  await db.exec("CREATE SCHEMA ls_control");
  for (const name of ["0001_ls_foundation.sql", "0010_ls_identity_cases_20260906.sql", "0030_ls_calendar_attendance_20260907.sql", "0090_ls_parents_first.sql", "0091_ls_pre_enrollment.sql", "0096_ls_intake_followup.sql", "0097_ls_demo_provenance.sql", "0100_ls_demo_prospect_marker_gate.sql"]) await db.exec(await readFile(join("migrations", name), "utf8"));
  for (const id of [workspace, otherWorkspace]) await db.query("INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)", [id, now]);
  for (const [id, workspaceId, role] of [[practitioner, workspace, "practitioner"], [parent, workspace, "parent"], [otherPractitioner, otherWorkspace, "practitioner"]] as const) {
    await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','sealed',$3)", [id, workspaceId, now]);
    await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'sealed',$5,'hash',$5,$5)", [id, workspaceId, role, `${id.replaceAll("-", "").slice(0, 64)}`.padEnd(64, "0"), now]);
    await db.query("INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)", [workspaceId, id]);
    await db.query("INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)", [sessionDigest(id), workspaceId, id, now, new Date(now.getTime() + 86_400_000)]);
  }
}
function payload(slots: readonly string[], overrides: Record<string, unknown> = {}) { return { parentName: "Synthetic Parent", contactNumber: "+972500000000", preferredLanguage: "he", email: "", children: slots.map((childSlotId, index) => ({ childSlotId, firstName: `Child ${index}`, age: 8 })), locationPreference: "synthetic-location", arrivalNeeds: "", availableDays: ["sun"], timeWindows: ["afternoon"], availabilityNote: "", privateContext: "private synthetic context", cp01: "not_now", willingToBeContacted: "yes", accessSupportNeeded: "no", consentAcknowledgements: [true, true, true], consentVersion: consent.version, consentHash: publicConsentHash(consent), consentLanguage: "he", signerName: "Synthetic Signer", ...overrides }; }
async function cleanupMkdtemp(directory: string) {
  const target = resolve(directory), temp = resolve(tmpdir()), pathWithinTemp = relative(temp, target);
  if (pathWithinTemp === "" || pathWithinTemp.startsWith("..") || !basename(target).startsWith("ls-intake-")) throw new Error("unsafe intake test cleanup target");
  await rm(target, { recursive: true, force: true });
}

describe("pre-enrollment PGlite", () => {
  it("uses actual HTTP handlers with ordinary role/origin/CSRF checks and no client skip flag",async()=>{
    const {PGlite}=await import("@electric-sql/pglite"),db=new PGlite() as unknown as Db;
    const origin="https://synthetic.invalid",csrf="a".repeat(43),batch="ls-owner-20261007";
    const request=(path:string,body:unknown,headers:Record<string,string>={})=>new Request(origin+path,{method:"POST",headers:{host:"synthetic.invalid",origin,"sec-fetch-site":"same-origin","content-type":"application/json",cookie:`${SESSION_COOKIE}=synthetic-session`,"x-csrf-token":csrf,...headers},body:JSON.stringify(body)});
    try{
      await migrate(db);const identity=store(db),owner=actor(practitioner,"practitioner");
      await db.query("INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,$2,$3)",[workspace,batch,practitioner]);
      await db.query("INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,$3,'fixture-parent')",[workspace,parent,batch]);
      const sessionActor=vi.fn(async()=>owner);
      http.runtime.mockResolvedValue({store:identity,config:{origin,workspaceId:workspace,keyring:ring,lookupKey:Buffer.alloc(32,7)},clock:{now:()=>now},services:{sessions:{actor:sessionActor,csrf:()=>csrf}}});
      vi.stubEnv("LS_APP_ORIGIN",origin);vi.stubEnv("LS_INTAKE_REAL_DATA_RELEASE","true");vi.stubEnv("LS_INTAKE_SYNTHETIC_FIXTURE_ENABLED","true");vi.stubEnv("LS_INTAKE_SYNTHETIC_FIXTURE_BINDING_JSON",JSON.stringify({batch,accountId:parent}));
      const command={action:"issue_synthetic_fixture",operationId:randomUUID()};
      for(const headers of [{cookie:""},{"x-csrf-token":"bad"},{origin:"https://evil.invalid"}])expect((await staffPost(request("/api/intake/staff",command,headers))).status).toBe(headers.cookie===""?401:403);
      sessionActor.mockResolvedValueOnce(actor(parent,"parent"));expect((await staffPost(request("/api/intake/staff",command))).status).toBe(403);
      for(const extra of [{skipProjection:true},{accountId:parent},{stableLeadRef:"LS-LEAD-real"}])expect((await staffPost(request("/api/intake/staff",{...command,...extra}))).status).toBe(400);
      const issuedResponse=await staffPost(request("/api/intake/staff",command));expect(issuedResponse.status).toBe(201);const issued=(await issuedResponse.json()).data;
      const exchanged=await publicPost(request("/api/intake",{action:"exchange",token:issued.token}));expect(exchanged.status).toBe(200);const exchange=(await exchanged.json()).data;expect(exchange.synthetic).toBe(true);
      const body={action:"submit",token:issued.token,idempotencyKey:randomUUID(),payload:payload(exchange.childSlotIds)};
      expect((await publicPost(request("/api/intake",{...body,synthetic:true}))).status).toBe(400);
      const submitted=await publicPost(request("/api/intake",body));expect(submitted.status).toBe(200);const receipt=(await submitted.json()).data;expect(receipt.projectionPending).toBe(false);expect(http.project).not.toHaveBeenCalled();
      const readback=await staffGet(new Request(origin+"/api/intake/staff?receiptId="+receipt.receiptId,{headers:{cookie:`${SESSION_COOKIE}=synthetic-session`}}));expect(readback.status).toBe(200);expect((await readback.json()).data[0].input.parentName).toBe("Synthetic Parent");
      const normal=await new PreEnrollmentStaffService(identity,ring,()=>now).issue(owner,"LS-LEAD-http-normal",1);
      const normalExchange=(await(await publicPost(request("/api/intake",{action:"exchange",token:normal.token}))).json()).data;
      expect(normalExchange.synthetic).toBeUndefined();
      http.project.mockRejectedValueOnce(new Error("synthetic provider outage"));
      const normalResponse=await publicPost(request("/api/intake",{action:"submit",token:normal.token,idempotencyKey:randomUUID(),payload:payload(normalExchange.childSlotIds)}));expect(normalResponse.status).toBe(200);expect((await normalResponse.json()).data.projectionPending).toBe(true);expect(http.project).toHaveBeenCalledTimes(1);
    }finally{vi.unstubAllEnvs();http.project.mockReset();await db.close();}
  },30_000);
  it("contains only the exact synthetic operation through the authenticated HTTP boundary after issuance is off",async()=>{
    const {PGlite}=await import("@electric-sql/pglite"),db=new PGlite() as unknown as Db;
    const origin="https://synthetic.invalid",csrf="b".repeat(43),batch="ls-owner-20261007";
    const request=(body:unknown,headers:Record<string,string>={})=>new Request(origin+"/api/intake/staff",{method:"POST",headers:{host:"synthetic.invalid",origin,"sec-fetch-site":"same-origin","content-type":"application/json",cookie:`${SESSION_COOKIE}=synthetic-session`,"x-csrf-token":csrf,...headers},body:JSON.stringify(body)});
    try{
      await migrate(db);const identity=store(db),owner=actor(practitioner,"practitioner");
      await db.query("INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,$2,$3)",[workspace,batch,practitioner]);
      await db.query("INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,$3,'fixture-parent')",[workspace,parent,batch]);
      const sessionActor=vi.fn(async()=>owner);
      http.runtime.mockResolvedValue({store:identity,config:{origin,workspaceId:workspace,keyring:ring,lookupKey:Buffer.alloc(32,7)},clock:{now:()=>now},services:{sessions:{actor:sessionActor,csrf:()=>csrf}}});
      vi.stubEnv("LS_APP_ORIGIN",origin);vi.stubEnv("LS_INTAKE_REAL_DATA_RELEASE","true");vi.stubEnv("LS_INTAKE_SYNTHETIC_FIXTURE_ENABLED","true");vi.stubEnv("LS_INTAKE_SYNTHETIC_FIXTURE_BINDING_JSON",JSON.stringify({batch,accountId:parent}));
      const operationId=randomUUID(),issue={action:"issue_synthetic_fixture",operationId},issued=(await(await staffPost(request(issue))).json()).data;
      vi.stubEnv("LS_INTAKE_SYNTHETIC_FIXTURE_ENABLED","false");
      const revoke={action:"revoke_synthetic_fixture",operationId};
      for(const extra of [{invitationId:randomUUID()},{token:issued.token},{stableLeadRef:"LS-LEAD-real"}])expect((await staffPost(request({...revoke,...extra}))).status).toBe(400);
      sessionActor.mockResolvedValueOnce(actor(parent,"parent"));expect((await staffPost(request(revoke))).status).toBe(403);
      const first=await staffPost(request(revoke));expect(first.status).toBe(200);const contained=(await first.json()).data;
      expect(contained).toEqual({synthetic:true,revokedAt:now.toISOString(),replayed:false});
      const replay=await staffPost(request(revoke));expect(replay.status).toBe(200);expect((await replay.json()).data).toEqual({...contained,replayed:true});
      const service=new PreEnrollmentService(new SqlPreEnrollmentRepository(identity,workspace),ring,()=>now,true,workspace);
      await expect(service.exchange(issued.token)).rejects.toMatchObject({code:"NOT_FOUND"});
      await expect(service.submit(issued.token,randomUUID(),payload([randomUUID()]))).rejects.toMatchObject({code:"NOT_FOUND"});
      vi.stubEnv("LS_INTAKE_SYNTHETIC_FIXTURE_ENABLED","true");
      expect((await staffPost(request(issue))).status).toBe(404);
      expect((await staffPost(request({action:"revoke_synthetic_fixture",operationId:randomUUID()}))).status).toBe(404);
      const ordinary=await new PreEnrollmentStaffService(identity,ring,()=>now).issue(owner,"LS-LEAD-ordinary-unrelated",1);
      expect((await staffPost(request({action:"revoke_synthetic_fixture",operationId:randomUUID()}))).status).toBe(404);
      const ordinaryDigest=createHash("sha256").update(ordinary.token).digest("hex");
      expect((await db.query("SELECT revoked_at FROM ls_intake.pre_enrollment_invitations WHERE token_digest=$1",[ordinaryDigest])).rows).toEqual([{revoked_at:null}]);
    }finally{vi.unstubAllEnvs();http.runtime.mockReset();await db.close();}
  },30_000);
  it("atomically registers an owner demo fixture, persists provenance and suppresses only its projection",async()=>{
    const {PGlite}=await import("@electric-sql/pglite"),db=new PGlite() as unknown as Db;
    try{
      await migrate(db);const identity=store(db),owner=actor(practitioner,"practitioner"),batch="ls-owner-20261007",binding={batch,accountId:parent};
      await db.query("INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,$2,$3)",[workspace,batch,practitioner]);
      await db.query("INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,$3,'fixture-parent')",[workspace,parent,batch]);
      const operation=randomUUID(),issued=await issueSyntheticIntake(identity,owner,operation,binding,Buffer.alloc(32,7),now);
      expect(await issueSyntheticIntake(identity,owner,operation,binding,Buffer.alloc(32,7),now)).toEqual({...issued,replayed:true});
      expect((await db.query("SELECT * FROM ls_intake.pre_enrollment_invitations")).rows).toHaveLength(1);
      const service=new PreEnrollmentService(new SqlPreEnrollmentRepository(identity,workspace),ring,()=>now,true,workspace);
      const exchange=await service.exchange(issued.token);expect(exchange).toMatchObject({synthetic:true,bankTransfer:null});
      const key=randomUUID(),input=payload(exchange.childSlotIds),receipt=await service.submit(issued.token,key,input);
      expect(await service.submit(issued.token,key,input)).toMatchObject({receiptId:receipt.receiptId,duplicate:true});
      expect(await identity.transaction(tx=>isSyntheticIntakeReceipt(tx,workspace,receipt.receiptId,receipt.stableLeadId))).toBe(true);
      const project=vi.fn(async()=>false);expect(await projectSubmittedIntake(identity,workspace,receipt,project)).toBe(false);expect(project).not.toHaveBeenCalled();
      expect((await db.query("SELECT entity_kind FROM ls_demo.records ORDER BY entity_kind")).rows).toEqual([{entity_kind:"form"},{entity_kind:"submission"}]);
      const staff=new PreEnrollmentStaffService(identity,ring,()=>now);expect((await staff.history(owner,receipt.receiptId))[0]).toMatchObject({synthetic:true,input:{parentName:"Synthetic Parent"}});
      expect((await staff.list(owner))[0]).toMatchObject({receiptId:receipt.receiptId,synthetic:true});
      await expect(staff.history(actor(parent,"parent"),receipt.receiptId)).rejects.toMatchObject({code:"FORBIDDEN"});
      expect((await db.query("SELECT state FROM ls_onboarding.prospect_journeys")).rows).toEqual([{state:"awaiting_payment"}]);
      const real=await staff.issue(owner,"LS-LEAD-fixture-forged-name",1),realSlots=(await service.exchange(real.token)).childSlotIds;
      const normal=await service.submit(real.token,randomUUID(),payload(realSlots));
      expect(await projectSubmittedIntake(identity,workspace,normal,project)).toBe(false);
      expect(project).toHaveBeenCalledExactlyOnceWith(normal.stableLeadId,{formSubmitted:normal.receivedAt,stage:"Intake submitted / awaiting payment",updateProvenance:"private-app:intake-submitted"});
      await expect(projectSubmittedIntake(identity,workspace,{...receipt,stableLeadId:normal.stableLeadId},project)).rejects.toMatchObject({code:"UNAVAILABLE"});
      await expect(projectSubmittedIntake(identity,otherWorkspace,receipt,project)).rejects.toMatchObject({code:"UNAVAILABLE"});
      expect(project).toHaveBeenCalledTimes(1);
      // Even a separately injected generic receipt marker is not sufficient provenance.
      await db.query("INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,account_id) VALUES($1,$2,'submission',$3,'forged-receipt',$4)",[workspace,batch,normal.receiptId,parent]);
      await expect(projectSubmittedIntake(identity,workspace,normal,project)).rejects.toMatchObject({code:"UNAVAILABLE"});
      expect(project).toHaveBeenCalledTimes(1);
      await expect(db.query("INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,account_id) VALUES($1,$2,'prospect','LS-LEAD-any','forged',$3)",[workspace,batch,parent])).rejects.toThrow();
    }finally{await db.close();}
  },30_000);
  it("rejects unowned/disabled/revoked producers and rolls back invitation when registration fails",async()=>{
    const {PGlite}=await import("@electric-sql/pglite"),db=new PGlite() as unknown as Db;
    try{
      await migrate(db);const identity=store(db),owner=actor(practitioner,"practitioner"),batch="ls-owner-20261007",binding={batch,accountId:parent};
      await expect(issueSyntheticIntake(identity,owner,randomUUID(),null,Buffer.alloc(32,7),now)).rejects.toMatchObject({code:"NOT_FOUND"});
      await expect(issueSyntheticIntake(identity,owner,randomUUID(),binding,Buffer.alloc(32,7),now)).rejects.toMatchObject({code:"FORBIDDEN"});
      await db.query("INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,$2,$3)",[workspace,batch,practitioner]);
      await db.query("INSERT INTO ls_demo.accounts(workspace_id,account_id,batch_id,source_key) VALUES($1,$2,$3,'fixture-parent')",[workspace,parent,batch]);
      await expect(issueSyntheticIntake(identity,actor(parent,"parent"),randomUUID(),binding,Buffer.alloc(32,7),now)).rejects.toMatchObject({code:"FORBIDDEN"});
      const failMarker:IdentityStore={transaction:work=>identity.transaction(tx=>work({query:async(sql,values)=>{if(sql.includes("INSERT INTO ls_demo.records"))throw Error("synthetic registration failure");return tx.query(sql,values);}}))};
      await expect(issueSyntheticIntake(failMarker,owner,randomUUID(),binding,Buffer.alloc(32,7),now)).rejects.toThrow("synthetic registration failure");
      expect((await db.query("SELECT * FROM ls_intake.pre_enrollment_invitations")).rows).toHaveLength(0);
      const issued=await issueSyntheticIntake(identity,owner,randomUUID(),binding,Buffer.alloc(32,7),now);
      const service=new PreEnrollmentService(new SqlPreEnrollmentRepository(identity,workspace),ring,()=>now,true,workspace);
      const slots=(await service.exchange(issued.token)).childSlotIds;
      const failingService=new PreEnrollmentService(new SqlPreEnrollmentRepository(failMarker,workspace),ring,()=>now,true,workspace);
      await expect(failingService.submit(issued.token,randomUUID(),payload(slots))).rejects.toThrow("synthetic registration failure");
      expect((await db.query("SELECT * FROM ls_intake.pre_enrollment_receipts")).rows).toHaveLength(0);
      expect((await db.query("SELECT consumed_at FROM ls_intake.pre_enrollment_invitations")).rows).toEqual([{consumed_at:null}]);
      expect((await db.query("SELECT * FROM ls_onboarding.prospect_journeys")).rows).toHaveLength(0);
      await expect(service.submit(issued.token,randomUUID(),payload(slots))).resolves.toMatchObject({duplicate:false});
      await db.query("UPDATE ls_identity.sessions SET revoked_at=$1 WHERE account_id=$2",[now,practitioner]);
      await expect(issueSyntheticIntake(identity,owner,randomUUID(),binding,Buffer.alloc(32,7),now)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
    }finally{await db.close();}
  },30_000);
  it("preserves bilingual consent evidence and rejects amendment evidence or new weekend availability changes", async () => {
    const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite"); const connection = new (PGlite as unknown as PGliteCtor)();
    const translated = { ...consent, translations: { en: { displayText: ["Exact English paragraph one.", "Exact English paragraph two."], acknowledgements: ["Exact English acknowledgement one.", "Exact English acknowledgement two.", "Exact English acknowledgement three."] } } };
    try {
      await migrate(connection); const identity = store(connection); const staff = new PreEnrollmentStaffService(identity, ring, () => now); const issued = await staff.issue(actor(practitioner, "practitioner"), "LS-LEAD-bilingual", 1);
      process.env.LS_INTAKE_PUBLIC_CONSENT_JSON = JSON.stringify(translated); const service = new PreEnrollmentService(new SqlPreEnrollmentRepository(identity, workspace), ring, () => now, true, workspace); const slots = (await service.exchange(issued.token)).childSlotIds; const original = payload(slots, { preferredLanguage: "he", consentLanguage: "en", consentVersion: translated.version, consentHash: publicConsentHash(translated) }); const receipt = await service.submit(issued.token, randomUUID(), original); const history = await staff.history(actor(practitioner, "practitioner"), receipt.receiptId);
      const bilingual = history[0]?.consent as (typeof translated & { hash: string }) | null; expect(history[0]?.input.consentLanguage).toBe("en"); expect(bilingual?.translations.en.displayText).toEqual(translated.translations.en.displayText); expect(bilingual?.translations.en.acknowledgements).toEqual(translated.translations.en.acknowledgements);
      await expect(staff.amend(actor(practitioner, "practitioner"), receipt.receiptId, { ...original, consentLanguage: "he" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await expect(staff.amend(actor(practitioner, "practitioner"), receipt.receiptId, { ...original, signerName: "Forged signer" })).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await expect(staff.amend(actor(practitioner, "practitioner"), receipt.receiptId, { ...original, availableDays: ["fri"] })).rejects.toBeTruthy();
    } finally { process.env.LS_INTAKE_PUBLIC_CONSENT_JSON = JSON.stringify(consent); await connection.close(); }
  }, 30_000);

  it("uses real identity state for issue, exchange, submit, immutable history, authorization and durable ciphertext", async () => {
    const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite"); const directory = await mkdtemp(join(tmpdir(), "ls-intake-")); const connection = new (PGlite as unknown as PGliteCtor)(directory);
    try {
      await migrate(connection); const identity = store(connection); const staff = new PreEnrollmentStaffService(identity, ring, () => now);
      const issued = await staff.issue(actor(practitioner, "practitioner"), "LS-LEAD-synthetic", 2);
      const service = new PreEnrollmentService(new SqlPreEnrollmentRepository(identity, workspace), ring, () => now, true, workspace);
      const exchange = await service.exchange(issued.token); expect(exchange.consent).toMatchObject({ version: consent.version, hash: publicConsentHash(consent), sourceHashes: consent.sourceHashes }); expect(exchange.childSlotIds).toHaveLength(2);
      const first = await service.submit(issued.token, randomUUID(), payload(exchange.childSlotIds));
      const history = await staff.history(actor(practitioner, "practitioner"), first.receiptId); expect(history).toHaveLength(1); expect(history[0]).toMatchObject({ kind: "original", actorAccountId: null, consent: { hash: publicConsentHash(consent), acknowledgements: consent.acknowledgements } }); expect(history[0]!.input).toEqual(payload(exchange.childSlotIds));
      await staff.amend(actor(practitioner, "practitioner"), first.receiptId, payload(exchange.childSlotIds, { locationPreference: "changed" }));
      expect((await staff.history(actor(practitioner, "practitioner"), first.receiptId)).map(row => row.kind)).toEqual(["original", "amendment"]);
      await expect(staff.amend(actor(practitioner, "practitioner"), first.receiptId, payload([...exchange.childSlotIds].reverse()))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      await expect(staff.history(actor(parent, "parent"), first.receiptId)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(new PreEnrollmentStaffService(identity, ring, () => now).history(actor(otherPractitioner, "practitioner", otherWorkspace), first.receiptId)).rejects.toMatchObject({ code: "NOT_FOUND" });
      const row = await connection.query<{ payload_ciphertext: string }>("SELECT payload_ciphertext FROM ls_intake.pre_enrollment_receipts"); expect(row.rows[0]!.payload_ciphertext).not.toContain("Synthetic Parent");
      await connection.close(); const reopened = new (PGlite as unknown as PGliteCtor)(directory); expect((await reopened.query("SELECT receipt_id FROM ls_intake.pre_enrollment_receipts")).rows).toHaveLength(1); await reopened.close();
    } finally { await cleanupMkdtemp(directory); }
  }, 30_000);

  it("rejects expired, revoked, false or stale consent and preserves retry semantics", async () => {
    const { PGlite } = await import(process.env.PGLITE_MODULE || "@electric-sql/pglite"); const connection = new (PGlite as unknown as PGliteCtor)();
    try {
      await migrate(connection); const identity = store(connection), staff = new PreEnrollmentStaffService(identity, ring, () => now);
      const expired = await staff.issue(actor(practitioner, "practitioner"), "LS-LEAD-expired", 1); const later = new PreEnrollmentService(new SqlPreEnrollmentRepository(identity, workspace), ring, () => new Date(now.getTime() + 8 * 86_400_000), true, workspace); await expect(later.exchange(expired.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
      const revoked = await staff.issue(actor(practitioner, "practitioner"), "LS-LEAD-revoked", 1); await connection.query("UPDATE ls_intake.pre_enrollment_invitations SET revoked_at=$1 WHERE token_digest=$2", [now, (await import("node:crypto")).createHash("sha256").update(revoked.token).digest("hex")]); const service = new PreEnrollmentService(new SqlPreEnrollmentRepository(identity, workspace), ring, () => now, true, workspace); await expect(service.exchange(revoked.token)).rejects.toMatchObject({ code: "NOT_FOUND" });
      const active = await staff.issue(actor(practitioner, "practitioner"), "LS-LEAD-active", 1); const slots = (await service.exchange(active.token)).childSlotIds; await expect(service.submit(active.token, randomUUID(), payload(slots, { consentAcknowledgements: [true, false, true] }))).rejects.toBeTruthy(); await expect(service.submit(active.token, randomUUID(), payload(slots, { consentHash: "0".repeat(64) }))).rejects.toMatchObject({ code: "INVALID_REQUEST" });
      const key = randomUUID(), accepted = payload(slots), first = await service.submit(active.token, key, accepted), duplicate = await service.submit(active.token, key, accepted); expect(duplicate).toMatchObject({ receiptId: first.receiptId, duplicate: true }); await expect(service.submit(active.token, key, payload(slots, { locationPreference: "different" }))).rejects.toMatchObject({ code: "CONFLICT" });
      const concurrent = await staff.issue(actor(practitioner, "practitioner"), "LS-LEAD-concurrent", 1); const concurrentSlots = (await service.exchange(concurrent.token)).childSlotIds;
      const contenders = await Promise.allSettled([service.submit(concurrent.token, randomUUID(), payload(concurrentSlots)), service.submit(concurrent.token, randomUUID(), payload(concurrentSlots))]); expect(contenders.filter(result => result.status === "fulfilled")).toHaveLength(1); expect(contenders.filter(result => result.status === "rejected")).toHaveLength(1);
      const failing = await staff.issue(actor(practitioner, "practitioner"), "LS-LEAD-failure", 1); const failingSlots = (await service.exchange(failing.token)).childSlotIds, repository = new SqlPreEnrollmentRepository(identity, workspace);
      const failAfterInsert: PreEnrollmentRepository = {
        transaction: work => repository.transaction(async tx => {
          const failedTx: PreEnrollmentRepository = { transaction: nested => tx.transaction(nested), findToken: digest => tx.findToken(digest), findReceiptByIdempotency: (digest, key) => tx.findReceiptByIdempotency(digest, key), insertReceipt: async row => { await tx.insertReceipt(row); throw new Error("simulated failure after receipt insert"); }, consumeToken: (digest, at) => tx.consumeToken(digest, at) };
          return work(failedTx);
        }),
        findToken: digest => repository.findToken(digest), findReceiptByIdempotency: (digest, key) => repository.findReceiptByIdempotency(digest, key), insertReceipt: row => repository.insertReceipt(row), consumeToken: (digest, at) => repository.consumeToken(digest, at),
      };
      await expect(new PreEnrollmentService(failAfterInsert, ring, () => now, true, workspace).submit(failing.token, randomUUID(), payload(failingSlots))).rejects.toThrow("simulated failure after receipt insert");
      const persisted = await connection.query<{ receiptCount: number; consumedAt: Date | null }>("SELECT count(r.receipt_id)::int AS \"receiptCount\",i.consumed_at AS \"consumedAt\" FROM ls_intake.pre_enrollment_invitations i LEFT JOIN ls_intake.pre_enrollment_receipts r ON r.workspace_id=i.workspace_id AND r.invitation_id=i.invitation_id WHERE i.workspace_id=$1 AND i.token_digest=$2 GROUP BY i.consumed_at", [workspace, createHash("sha256").update(failing.token).digest("hex")]); expect(persisted.rows).toEqual([{ receiptCount: 0, consumedAt: null }]); expect((await service.exchange(failing.token)).childSlotIds).toEqual(failingSlots); await expect(service.submit(failing.token, randomUUID(), payload(failingSlots))).resolves.toMatchObject({ duplicate: false });
    } finally { await connection.close(); }
  }, 30_000);
});
