import "server-only";
import type { IdentityStore } from "../../identity/store.ts";
import { blindEmail, seal, unseal, type Keyring } from "../../identity/crypto.ts";
import { freshActor } from "../../identity/data.ts";
import { systemClock, type Actor, type IdentityClock } from "../../identity/types.ts";
import { requirePractitioner } from "../../cases/policy.ts";
import { normalizePhone } from "../core/contact-resolution.js";
import { dateOnly, requireThat } from "../core/validation.js";
import { planImport, type ImportRow, type SheetSnapshot } from "./import-plan.ts";
import { crmProfileAad, type CrmProfile } from "./native-store.ts";

export type NewPersonDisposition = { sourceRow: number; kind: "new_person" };
export type ShadowImportResult = { sourceRevision: string; planned: number; created: number; replayed: number };

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
  requireThat(snapshot.fileId === this.sourceFileId && snapshot.sheetId === this.sourceSheetId, "IMPORT_SOURCE_MISMATCH");
  const plan = planImport(snapshot, actor.workspaceId, this.integrityKey);
  requireThat(plan.canImport && plan.rows.length > 0 && plan.rows.every(row => row.issues.length === 0), "IMPORT_PLAN_NEEDS_REVIEW");
  const decisions = new Map<number, NewPersonDisposition>();
  for (const item of dispositions) {
   requireThat(item.kind === "new_person" && Number.isSafeInteger(item.sourceRow) && !decisions.has(item.sourceRow), "IMPORT_DISPOSITION_INVALID");
   decisions.set(item.sourceRow, item);
  }
  requireThat(decisions.size === plan.rows.length && plan.rows.every(row => decisions.has(row.sourceRow)), "IMPORT_DISPOSITION_INCOMPLETE");
  const phones = new Set<string>(), emails = new Set<string>();
  for (const row of plan.rows) {
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
   await tx.query("SET TRANSACTION ISOLATION LEVEL SERIALIZABLE");
   requirePractitioner(await freshActor(tx, actor, this.clock.now()));
   await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [`${actor.workspaceId}:crm-import:${snapshot.fileId}:${snapshot.sheetId}`]);
   const links = await tx.query<{ legacyId: string; personId: string; rowDigest: string; sourceRevision: string }>(
    'SELECT legacy_lead_id AS "legacyId",person_id AS "personId",row_digest AS "rowDigest",source_revision AS "sourceRevision" FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2 AND source_sheet_id=$3',
    [actor.workspaceId, snapshot.fileId, snapshot.sheetId],
   );
   const prior = new Map(links.map(link => [link.legacyId, link]));
   requireThat(prior.size === links.length && links.length <= plan.rows.length, "IMPORT_EXISTING_LINK_SET_MISMATCH");
   const unrelatedProfiles = await tx.query<{ n: number }>(
    `SELECT count(*)::integer AS n FROM ls_contact_ops.profiles p
     WHERE p.workspace_id=$1 AND p.record_mode='live' AND NOT EXISTS(
      SELECT 1 FROM ls_contact_ops.legacy_links l
      WHERE l.workspace_id=p.workspace_id AND l.person_id=p.person_id
       AND l.source_file_id=$2 AND l.source_sheet_id=$3)`,
    [actor.workspaceId, snapshot.fileId, snapshot.sheetId],
   );
   requireThat(unrelatedProfiles.length === 1 && unrelatedProfiles[0]!.n === 0, "IMPORT_UNLINKED_NATIVE_PROFILE_REQUIRES_REVIEW");
   const accounts = await tx.query<{ id: string; emailBlind: string; phoneCiphertext: string | null }>(
    'SELECT id,email_blind AS "emailBlind",phone_ciphertext AS "phoneCiphertext" FROM ls_identity.accounts WHERE workspace_id=$1',
    [actor.workspaceId],
   );
   const existingPhones = new Set(accounts.flatMap(account => {
    if (!account.phoneCiphertext) return [];
    const phone = normalizePhone(unseal(account.phoneCiphertext, `phone:${actor.workspaceId}:${account.id}`, this.keyring));
    return phone ? [phone] : [];
   }));
   const existingEmails = new Set(accounts.map(account => account.emailBlind));
   for (const row of plan.rows) {
    // A person may legitimately gain an account after the shadow import. Replaying
    // that exact legacy link must not be mistaken for a new-person collision.
    if (prior.has(row.legacyId)) continue;
    requireThat(!row.normalizedPhone || !existingPhones.has(row.normalizedPhone), "IMPORT_ACCOUNT_ENDPOINT_COLLISION");
    requireThat(!row.normalizedEmail || !existingEmails.has(blindEmail(row.normalizedEmail, this.lookupKey)), "IMPORT_ACCOUNT_ENDPOINT_COLLISION");
   }
   let created = 0, replayed = 0;
   for (const row of plan.rows) {
    const linked = prior.get(row.legacyId);
    if (linked) {
     requireThat(linked.personId === row.suggestedPersonId && linked.rowDigest === row.rowDigest && linked.sourceRevision === snapshot.revision, "IMPORT_EXISTING_LINK_CONFLICT");
     replayed++;
     continue;
    }
    const collision = await tx.query<{ id: string }>('SELECT id FROM ls_identity.people WHERE workspace_id=$1 AND id=$2', [actor.workspaceId, row.suggestedPersonId]);
    requireThat(collision.length === 0, "IMPORT_PERSON_ID_COLLISION");
    const profile = profileFromRow(row);
    const personCiphertext = seal(JSON.stringify({ displayName: row.protectedPayload.displayName }), `person:${actor.workspaceId}:${row.suggestedPersonId}`, this.keyring);
    const profileCiphertext = seal(JSON.stringify(profile), crmProfileAad(actor.workspaceId, row.suggestedPersonId), this.keyring);
    const snapshotCiphertext = seal(JSON.stringify({ sourceRow: row.sourceRow, payload: row.protectedPayload }), legacyAad(actor.workspaceId, snapshot, row.legacyId), this.keyring);
    await tx.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)", [row.suggestedPersonId, actor.workspaceId, personCiphertext, this.clock.now()]);
    await tx.query("INSERT INTO ls_contact_ops.profiles(workspace_id,person_id,payload_ciphertext,record_mode,demo_batch_id) VALUES($1,$2,$3,'live',NULL)", [actor.workspaceId, row.suggestedPersonId, profileCiphertext]);
    await tx.query("INSERT INTO ls_contact_ops.legacy_links(workspace_id,source_file_id,source_sheet_id,source_tab_title,legacy_lead_id,person_id,source_revision,row_digest,snapshot_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)", [actor.workspaceId, snapshot.fileId, snapshot.sheetId, snapshot.tab, row.legacyId, row.suggestedPersonId, snapshot.revision, row.rowDigest, snapshotCiphertext]);
    created++;
   }
   requireThat(created + replayed === plan.rows.length, "IMPORT_ROW_COUNT_MISMATCH");
   const count = await tx.query<{ n: number }>('SELECT count(*)::integer AS n FROM ls_contact_ops.legacy_links WHERE workspace_id=$1 AND source_file_id=$2 AND source_sheet_id=$3', [actor.workspaceId, snapshot.fileId, snapshot.sheetId]);
   requireThat(count.length === 1 && count[0]!.n === plan.rows.length, "IMPORT_FINAL_LINK_COUNT_MISMATCH");
   return { sourceRevision: snapshot.revision, planned: plan.rows.length, created, replayed };
  });
 }
}

function profileFromRow(row: ImportRow): CrmProfile {
 const fields = row.protectedPayload.sourceFields;
 const stage = row.protectedPayload.stageText.trim() || "new";
 const nextAction = fields["Next action"]?.trim() || null;
 const rawDate = fields["Next-action date"]?.trim() || "";
 const notes = fields["General sales notes"] ?? "";
 requireThat(stage.length <= 120 && (nextAction === null || nextAction.length <= 500) && notes.length <= 5000, "IMPORT_PROFILE_FIELD_TOO_LONG");
 return { personId: row.suggestedPersonId, stage, nextAction, followUpDate: dateOnly(rawDate) ? rawDate : null, notes, legacyIds: [row.legacyId] };
}

function legacyAad(workspaceId: string, source: SheetSnapshot, leadId: string): string {
 return `ls_contact_ops/legacy/v1/${workspaceId}/${source.fileId}/${source.sheetId}/${leadId}`;
}
