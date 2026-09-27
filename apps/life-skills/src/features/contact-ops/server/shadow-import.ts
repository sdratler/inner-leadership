import "server-only";
import type { IdentityStore, SqlSession } from "../../identity/store.ts";
import { blindEmail, seal, unseal, type Keyring } from "../../identity/crypto.ts";
import { freshActor, lockWorkspace } from "../../identity/data.ts";
import { demoAccountBatch } from "../../demo/provenance.ts";
import { systemClock, type Actor, type IdentityClock, type WorkspaceId } from "../../identity/types.ts";
import { requirePractitioner } from "../../cases/policy.ts";
import { normalizePhone } from "../core/contact-resolution.js";
import { canonical, requireThat } from "../core/validation.js";
import { importedFollowUpDate, planImport, type ImportRow, type SheetSnapshot } from "./import-plan.ts";
import { crmProfileAad, type CrmProfile } from "./native-store.ts";

export type NewPersonDisposition = { sourceRow: number; sourceRevision: string; legacyId: string; rowDigest: string; kind: "new_person" };
export type ShadowImportResult = { sourceRevision: string; planned: number; created: number; replayed: number };
export type ShadowPreflightResult = { sourceRevision: string; planned: number; wouldCreate: number; replayed: number };

const OPERATOR_PERMIT = Symbol("native-shadow-operator");
const EXACT_PROJECT = "3b756632-1f66-4f75-a016-eabc37aa0d67";
const EXACT_SERVICE = "0267d061-f3ce-4a0a-82d4-ce133e4501e9";
const EXACT_ENVIRONMENT = "dd91bd71-57cc-45e6-a75b-8c858491d7c7";

/** This separate one-shot path is unavailable to the Next server and HTTP routes. */
export function shadowOperatorAdmitted(env: Record<string, string | undefined>, entryPoint: string | undefined): boolean {
 return env.LS_NATIVE_SHADOW_IMPORT_APPROVED === "true" &&
  env.RAILWAY_PROJECT_ID === EXACT_PROJECT && env.RAILWAY_SERVICE_ID === EXACT_SERVICE &&
  env.RAILWAY_ENVIRONMENT_ID === EXACT_ENVIRONMENT &&
  /(?:^|[\\/])scripts[\\/]shadow-import-operator\.ts$/.test(entryPoint ?? "");
}

export function nativeShadowOperatorPermit(): symbol {
 if (!shadowOperatorAdmitted(process.env, process.argv[1])) throw new Error("IMPORT_OPERATOR_NOT_ADMITTED");
 return OPERATOR_PERMIT;
}

/** This service has no HTTP or provider entry point. A trusted operator must first
 * prove the full source revision and decide every row; it cannot fence the Sheet.
 */
export class NativeShadowImporter {
 constructor(
  private readonly db: IdentityStore,
  private readonly keyring: Keyring,
  private readonly lookupKey: Buffer,
  private readonly integrityKey: string,
  private readonly sourceFileId: string,
  private readonly sourceSheetId: number,
  private readonly clock: IdentityClock = systemClock,
 ) {
  requireThat(lookupKey.length === 32 && integrityKey.length >= 32, "IMPORT_KEYS_REQUIRED");
  requireThat(Boolean(sourceFileId) && Number.isSafeInteger(sourceSheetId) && sourceSheetId >= 0, "IMPORT_SOURCE_REQUIRED");
 }

 async importNewPeople(actor: Actor, snapshot: SheetSnapshot, dispositions: readonly NewPersonDisposition[]): Promise<ShadowImportResult> {
  return this.importAuthorized(actor.workspaceId, snapshot, dispositions, async tx => {
   requirePractitioner(await freshActor(tx, actor, this.clock.now()));
  });
 }

 /** Only the exact reviewed CLI may call this. It checks the real verified,
  * non-demo practitioner inside the same workspace-locked transaction; it does
  * not mint a browser session or grant a prospect account/case relationship.
  */
 async importNewPeopleAsOperator(workspaceId: WorkspaceId, snapshot: SheetSnapshot, dispositions: readonly NewPersonDisposition[], permit: symbol): Promise<ShadowImportResult> {
  if (permit !== OPERATOR_PERMIT || !shadowOperatorAdmitted(process.env, process.argv[1])) throw new Error("IMPORT_OPERATOR_NOT_ADMITTED");
  return this.importAuthorized(workspaceId, snapshot, dispositions, tx => this.authorizeOperator(tx, workspaceId));
 }

 async preflightNewPeopleAsOperator(workspaceId: WorkspaceId, snapshot: SheetSnapshot, dispositions: readonly NewPersonDisposition[], permit: symbol): Promise<ShadowPreflightResult> {
  if (permit !== OPERATOR_PERMIT || !shadowOperatorAdmitted(process.env, process.argv[1])) throw new Error("IMPORT_OPERATOR_NOT_ADMITTED");
  const result = await this.importAuthorized(workspaceId, snapshot, dispositions, tx => this.authorizeOperator(tx, workspaceId), false);
  return {sourceRevision:result.sourceRevision, planned:result.planned, wouldCreate:result.created, replayed:result.replayed};
 }

 private async authorizeOperator(tx: SqlSession, workspaceId: WorkspaceId): Promise<void> {
   const owners = await tx.query<{id:string;role:"practitioner";state:"active";emailVerifiedAt:Date|null}>(
    `SELECT id,role,state,email_verified_at AS "emailVerifiedAt" FROM ls_identity.accounts
     WHERE workspace_id=$1 AND role='practitioner' AND state='active'`, [workspaceId]);
   requireThat(owners.length === 1 && Boolean(owners[0]?.emailVerifiedAt), "IMPORT_OPERATOR_ACCOUNT_REQUIRES_REVIEW");
   requireThat(await demoAccountBatch(tx, workspaceId, owners[0]!.id) === null, "IMPORT_DEMO_OPERATOR_FORBIDDEN");
 }

 private async importAuthorized(workspaceId: WorkspaceId, snapshot: SheetSnapshot, dispositions: readonly NewPersonDisposition[], authorize: (tx: SqlSession) => Promise<void>, apply = true): Promise<ShadowImportResult> {
  requireThat(snapshot.fileId === this.sourceFileId && snapshot.sheetId === this.sourceSheetId, "IMPORT_SOURCE_MISMATCH");
  const plan = planImport(snapshot, workspaceId, this.integrityKey);
  requireThat(plan.canImport && plan.rows.length > 0 && plan.rows.every(row => row.issues.length === 0), "IMPORT_PLAN_NEEDS_REVIEW");
  const decisions = new Map<number, NewPersonDisposition>();
  for (const item of dispositions) {
   requireThat(item.kind === "new_person" && Number.isSafeInteger(item.sourceRow) && !decisions.has(item.sourceRow), "IMPORT_DISPOSITION_INVALID");
   decisions.set(item.sourceRow, item);
  }
  requireThat(decisions.size === plan.rows.length && plan.rows.every(row => decisions.has(row.sourceRow)), "IMPORT_DISPOSITION_INCOMPLETE");
  for (const row of plan.rows) {
   const decision = decisions.get(row.sourceRow)!;
   requireThat(decision.sourceRevision === snapshot.revision && decision.legacyId === row.legacyId && decision.rowDigest === row.rowDigest, "IMPORT_DISPOSITION_STALE");
  }
  const phones = new Set<string>(), emails = new Set<string>();
  for (const row of plan.rows) {
   importedFollowUpDate(row);
   if (row.normalizedPhone) {
    requireThat(!phones.has(row.normalizedPhone), "IMPORT_SHARED_ENDPOINT_REQUIRES_REVIEW");
    phones.add(row.normalizedPhone);
   }
   if (row.normalizedEmail) {
    const email = row.normalizedEmail.toLocaleLowerCase();
    requireThat(!emails.has(email), "IMPORT_SHARED_ENDPOINT_REQUIRES_REVIEW");
    emails.add(email);
   }
  }
  return this.db.transaction(async tx => {
   // Identity mutations use this row lock. READ COMMITTED lets the account scan
   // see a mutation that committed while this transaction waited for the lock.
   await lockWorkspace(tx, workspaceId);
   await authorize(tx);
   await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${workspaceId}:crm-import:${snapshot.fileId}:${snapshot.sheetId}`]);
   const links = await tx.query<{ legacyId: string; personId: string; rowDigest: string; sourceRevision: string; snapshotCiphertext: string }>(
    'SELECT legacy_lead_id AS "legacyId",person_id AS "personId",row_digest AS "rowDigest",source_revision AS "sourceRevision",snapshot_ciphertext AS "snapshotCiphertext" FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2 AND source_sheet_id=$3',
    [workspaceId, snapshot.fileId, snapshot.sheetId],
   );
   const prior = new Map(links.map(link => [link.legacyId, link]));
   const plannedIds = new Set(plan.rows.map(row => row.legacyId));
   requireThat(prior.size === links.length && links.length <= plan.rows.length &&
    links.every(link => plannedIds.has(link.legacyId)), "IMPORT_EXISTING_LINK_SET_MISMATCH");
   const unrelatedProfiles = await tx.query<{ n: number }>(
    `SELECT count(*)::integer AS n FROM ls_contact_ops.profiles p
     WHERE p.workspace_id=$1 AND p.record_mode='live' AND NOT EXISTS(
      SELECT 1 FROM ls_contact_ops.legacy_links l
      WHERE l.workspace_id=p.workspace_id AND l.person_id=p.person_id
       AND l.source_file_id=$2 AND l.source_sheet_id=$3)`,
    [workspaceId, snapshot.fileId, snapshot.sheetId],
   );
   requireThat(unrelatedProfiles.length === 1 && unrelatedProfiles[0]!.n === 0, "IMPORT_UNLINKED_NATIVE_PROFILE_REQUIRES_REVIEW");
   const accounts = await tx.query<{ id: string; personId: string | null; emailBlind: string; phoneCiphertext: string | null }>(
    'SELECT a.id,s.person_id AS "personId",a.email_blind AS "emailBlind",a.phone_ciphertext AS "phoneCiphertext" FROM ls_identity.accounts a LEFT JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id WHERE a.workspace_id=$1',
    [workspaceId],
   );
   const existingPhones = new Map<string, Set<string | null>>(), existingEmails = new Map<string, Set<string | null>>();
   for (const account of accounts) {
    addOwner(existingEmails, account.emailBlind, account.personId);
    if (account.phoneCiphertext) {
     const phone = normalizePhone(unseal(account.phoneCiphertext, `phone:${workspaceId}:${account.id}`, this.keyring));
     if (phone) addOwner(existingPhones, phone, account.personId);
    }
   }
   for (const row of plan.rows) {
    // Exact replay may follow legitimate account creation, but an endpoint now
    // owned by a different person is never silently accepted as the same lead.
    const linkedPersonId = prior.get(row.legacyId)?.personId;
    const phoneOwners = row.normalizedPhone ? existingPhones.get(row.normalizedPhone) : undefined;
    const emailOwners = row.normalizedEmail ? existingEmails.get(blindEmail(row.normalizedEmail, this.lookupKey)) : undefined;
    for (const owners of [phoneOwners, emailOwners]) {
     if (!owners) continue;
     requireThat(Boolean(linkedPersonId) && [...owners].every(personId => personId === linkedPersonId), "IMPORT_ACCOUNT_ENDPOINT_COLLISION");
    }
   }
   let created = 0, replayed = 0;
   for (const row of plan.rows) {
    const linked = prior.get(row.legacyId);
    if (linked) {
     requireThat(linked.personId === row.suggestedPersonId && linked.rowDigest === row.rowDigest && linked.sourceRevision === snapshot.revision, "IMPORT_EXISTING_LINK_CONFLICT");
     const person = await tx.query<{kind:string;profileCiphertext:string}>(
      'SELECT kind,profile_ciphertext AS "profileCiphertext" FROM ls_identity.people WHERE workspace_id=$1 AND id=$2 FOR UPDATE',
      [workspaceId,linked.personId]);
     requireThat(person.length === 1 && person[0]?.kind === "adult", "IMPORT_REPLAY_PERSON_MISSING");
     const existing = await tx.query<{payloadCiphertext:string;recordMode:string;demoBatchId:string|null}>(
      'SELECT payload_ciphertext AS "payloadCiphertext",record_mode AS "recordMode",demo_batch_id AS "demoBatchId" FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2 FOR UPDATE',
      [workspaceId,linked.personId]);
     requireThat(existing.length === 1 && existing[0]?.recordMode === "live" && existing[0]?.demoBatchId === null,"IMPORT_REPLAY_PROFILE_MISSING");
     let identityProfile:unknown,profile:unknown,storedSnapshot:unknown;
     try {
      identityProfile=JSON.parse(unseal(person[0]!.profileCiphertext,`person:${workspaceId}:${linked.personId}`,this.keyring));
      profile=JSON.parse(unseal(existing[0]!.payloadCiphertext,crmProfileAad(workspaceId,linked.personId),this.keyring));
      storedSnapshot=JSON.parse(unseal(linked.snapshotCiphertext,legacyAad(workspaceId,snapshot,row.legacyId),this.keyring));
     } catch { throw new Error("IMPORT_REPLAY_CIPHERTEXT_UNREADABLE"); }
     requireThat(canonical(identityProfile) === canonical({displayName:row.protectedPayload.displayName}) &&
      canonical(profile) === canonical(profileFromRow(row)) &&
      canonical(storedSnapshot) === canonical({sourceRow:row.sourceRow,payload:row.protectedPayload}),
      "IMPORT_REPLAY_PROTECTED_PAYLOAD_MISMATCH");
     replayed++;
     continue;
    }
    const collision = await tx.query<{ id: string }>('SELECT id FROM ls_identity.people WHERE workspace_id=$1 AND id=$2', [workspaceId, row.suggestedPersonId]);
    requireThat(collision.length === 0, "IMPORT_PERSON_ID_COLLISION");
    const profile = profileFromRow(row);
    if (apply) {
     const personCiphertext = seal(JSON.stringify({ displayName: row.protectedPayload.displayName }), `person:${workspaceId}:${row.suggestedPersonId}`, this.keyring);
     const profileCiphertext = seal(JSON.stringify(profile), crmProfileAad(workspaceId, row.suggestedPersonId), this.keyring);
     const snapshotCiphertext = seal(JSON.stringify({ sourceRow: row.sourceRow, payload: row.protectedPayload }), legacyAad(workspaceId, snapshot, row.legacyId), this.keyring);
     await tx.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)", [row.suggestedPersonId, workspaceId, personCiphertext, this.clock.now()]);
     await tx.query("INSERT INTO ls_contact_ops.profiles(workspace_id,person_id,payload_ciphertext,record_mode,demo_batch_id) VALUES($1,$2,$3,'live',NULL)", [workspaceId, row.suggestedPersonId, profileCiphertext]);
     await tx.query("INSERT INTO ls_contact_ops.legacy_links(workspace_id,source_file_id,source_sheet_id,source_tab_title,legacy_lead_id,person_id,source_revision,row_digest,snapshot_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [workspaceId, snapshot.fileId, snapshot.sheetId, snapshot.tab, row.legacyId, row.suggestedPersonId, snapshot.revision, row.rowDigest, snapshotCiphertext]);
    }
    created++;
   }
   requireThat(created + replayed === plan.rows.length, "IMPORT_ROW_COUNT_MISMATCH");
   if (apply) {
    const count = await tx.query<{ n: number }>('SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2 AND source_sheet_id=$3', [workspaceId, snapshot.fileId, snapshot.sheetId]);
    requireThat(count.length === 1 && count[0]!.n === plan.rows.length, "IMPORT_FINAL_LINK_COUNT_MISMATCH");
    const profiles = await tx.query<{ n: number }>("SELECT count(*)::integer AS n FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND record_mode='live'",[workspaceId]);
    requireThat(profiles.length === 1 && profiles[0]!.n === plan.rows.length, "IMPORT_FINAL_PROFILE_COUNT_MISMATCH");
   }
   return { sourceRevision: snapshot.revision, planned: plan.rows.length, created, replayed };
  });
 }
}

function profileFromRow(row: ImportRow): CrmProfile {
 const stage = row.protectedPayload.stageText.trim() || "new";
 const nextAction = sourceField(row, "Next action").trim() || null;
 const followUpDate = importedFollowUpDate(row);
 const notes = sourceField(row, "General sales notes");
 requireThat(stage.length <= 120 && (nextAction === null || nextAction.length <= 500) && notes.length <= 5000, "IMPORT_PROFILE_FIELD_TOO_LONG");
 return { personId: row.suggestedPersonId, stage, nextAction, followUpDate, notes, legacyIds: [row.legacyId] };
}

function sourceField(row: ImportRow, name: string): string {
 const entry = Object.entries(row.protectedPayload.sourceFields).find(([header]) => header.trim() === name);
 return entry?.[1] ?? "";
}

function addOwner(owners: Map<string, Set<string | null>>, endpoint: string, personId: string | null): void {
 const people = owners.get(endpoint) ?? new Set<string | null>();
 people.add(personId);
 owners.set(endpoint, people);
}

function legacyAad(workspaceId: string, source: SheetSnapshot, leadId: string): string {
 return `ls_contact_ops/legacy/v1/${workspaceId}/${source.fileId}/${source.sheetId}/${leadId}`;
}
