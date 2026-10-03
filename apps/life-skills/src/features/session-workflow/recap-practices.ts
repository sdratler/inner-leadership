import { AppError } from "../../lib/errors.ts";
import { asId } from "../../lib/ids.ts";
import { loadAudience, loadCase } from "../cases/data.ts";
import { unseal, type Keyring } from "../identity/crypto.ts";
import type { SqlSession } from "../identity/store.ts";
import type { AccountFacts } from "../identity/types.ts";
import { authorizeResponsibility, parseSavedResponsibility } from "../home-practice/responsibility-service.ts";
import { practiceInstructionsAad, practiceVersionSnapshotDigest } from "../home-practice/service.ts";
import type { SharedPractice } from "./types.ts";
import { recapPracticeChoiceSchema, recapPracticeSelectionSchema, type RecapPracticeChoice, type RecapPracticeSelection } from "./recap-contract.ts";

type SourceRow = Parameters<typeof practiceVersionSnapshotDigest>[0];
const sourceSql = `SELECT a.workspace_id AS "workspaceId",a.case_id AS "caseId",a.id AS "assignmentId",
 v.id AS "versionId",v.version,a.audience_id AS "audienceId",a.goal_id AS "goalId",a.commitment_id AS "commitmentId",
 v.template_key AS "templateKey",v.template_version AS "templateVersion",v.instructions_ciphertext AS "instructionsCiphertext",
 v.starts_on::text AS "startsOn",v.ends_on::text AS "endsOn",v.published_at AS "publishedAt",
 v.immutable_snapshot_digest AS "immutableSnapshotDigest",v.responsibility
 FROM ls_practice.practice_assignments a JOIN ls_practice.practice_assignment_versions v
 ON v.workspace_id=a.workspace_id AND v.assignment_id=a.id
 WHERE a.workspace_id=$1 AND a.case_id=$2 AND a.state='published' AND a.active_version_id=v.id
 AND v.state='published' AND v.responsibility IS NOT NULL`;
const localDay = (now: Date, timezone: string) => {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now).map(part => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
};

async function project(tx: SqlSession, actor: AccountFacts, caseId: string, row: SourceRow, ring: Keyring, now: Date): Promise<RecapPracticeChoice> {
  if (!row.publishedAt || !row.immutableSnapshotDigest || practiceVersionSnapshotDigest(row) !== row.immutableSnapshotDigest) throw new AppError("UNAVAILABLE");
  const item = await loadCase(tx, actor.workspaceId, asId(caseId, "case")), audience = await loadAudience(tx, actor.workspaceId, asId(caseId, "case"), row.audienceId);
  // Title/completion-only or private audiences cannot become full routine text.
  if (!item || !audience || !audience.published || audience.visibility !== "family_full") throw new AppError("NOT_FOUND");
  const instructions = unseal(row.instructionsCiphertext, practiceInstructionsAad(actor.workspaceId, row.versionId), ring);
  const responsibility = parseSavedResponsibility(row.responsibility);
  if (!responsibility || !row.endsOn || row.endsOn < localDay(now, responsibility.timezone)) throw new AppError("CONFLICT");
  await authorizeResponsibility(tx, actor, item, audience, responsibility, row.startsOn, row.endsOn, instructions);
  const value = recapPracticeChoiceSchema.safeParse({ assignmentId: row.assignmentId, versionId: row.versionId, version: row.version,
    sourceDigest: row.immutableSnapshotDigest, audienceAccountIds: [...audience.accountIds], participant: responsibility.participant,
    instructions, localTime: responsibility.localTime, timezone: responsibility.timezone, startsOn: row.startsOn, endsOn: row.endsOn,
    weekdays: responsibility.weekdays, completionMode: responsibility.completionMode });
  if (!value.success) throw new AppError("UNAVAILABLE"); return value.data;
}
/** Read a bounded page of actual currently published timed versions. No AI,
 * scheduling, recipient grants or copied private session records. */
export async function nativeRecapPracticeChoices(tx: SqlSession, actor: AccountFacts, caseId: string, ring: Keyring, now: Date, cursor?: string) {
  // Page the raw bounded source, including skipped ineligible versions. The
  // anchor is scoped to this case; it is not a grant or a source of copied text.
  const rows = await tx.query<SourceRow>(sourceSql + ` AND ($3::uuid IS NULL OR (v.published_at,v.id)<(
   SELECT anchor.published_at,anchor.id FROM ls_practice.practice_assignment_versions anchor
   JOIN ls_practice.practice_assignments anchor_assignment
   ON anchor_assignment.workspace_id=anchor.workspace_id AND anchor_assignment.id=anchor.assignment_id
   WHERE anchor.workspace_id=$1 AND anchor_assignment.case_id=$2 AND anchor.id=$3))
   ORDER BY v.published_at DESC,v.id LIMIT 21`, [actor.workspaceId, caseId, cursor??null]);
  const items: RecapPracticeChoice[] = [];
  for (const row of rows.slice(0, 20)) {
    try { items.push(await project(tx, actor, caseId, row, ring, now)); }
    catch (error) { if (!(error instanceof AppError) || !["NOT_FOUND", "CONFLICT"].includes(error.code)) throw error; }
  }
  return { items, hasMore: rows.length > 20, nextCursor: rows.length > 20 ? rows[19]!.versionId : null };
}
export async function reviewedNativeRecapPractices(tx: SqlSession, actor: AccountFacts, caseId: string, selections: readonly RecapPracticeSelection[], ring: Keyring, now: Date): Promise<SharedPractice[]> {
  if (selections.length > 20 || new Set(selections.map(row => row.versionId)).size !== selections.length) throw new AppError("INVALID_REQUEST");
  if (!selections.length) return [];
  const parsed = selections.map(row => { const result = recapPracticeSelectionSchema.safeParse(row); if (!result.success) throw new AppError("INVALID_REQUEST"); return result.data; });
  const rows = await tx.query<SourceRow>(sourceSql + " AND v.id=ANY($3::uuid[]) ORDER BY v.id LIMIT 20", [actor.workspaceId, caseId, parsed.map(row => row.versionId)]);
  if (rows.length !== parsed.length) throw new AppError("CONFLICT");
  const byId = new Map(rows.map(row => [row.versionId as string, row]));
  const result: SharedPractice[] = [];
  for (const selection of parsed) {
    const row = byId.get(selection.versionId); if (!row) throw new AppError("CONFLICT");
    const source = await project(tx, actor, caseId, row, ring, now);
    if (source.sourceDigest !== selection.expectedSourceDigest) throw new AppError("CONFLICT");
    result.push({ assignmentId: source.assignmentId, version: source.version, responsibilityId: source.versionId,
      audienceAccountIds: source.audienceAccountIds, participant: source.participant, instructions: selection.instructions,
      localTime: source.localTime, timezone: source.timezone, startsOn: source.startsOn, endsOn: source.endsOn });
  }
  return result;
}
/** Publishing freezes only an explicitly reviewed routine snapshot. Recheck
 * current native membership and source identity, not the caller's copied text. */
export async function assertRecapPracticeRecipients(tx: SqlSession, actor: AccountFacts, caseId: string, practices: readonly SharedPractice[], recipients: readonly string[], ring: Keyring, now: Date) {
  if (!practices.length) return;
  const rows = await tx.query<SourceRow>(sourceSql + " AND v.id=ANY($3::uuid[]) ORDER BY v.id LIMIT 20", [actor.workspaceId, caseId, practices.map(row => row.responsibilityId)]);
  if (rows.length !== practices.length) throw new AppError("CONFLICT");
  for (const practice of practices) {
    const row = rows.find(item => item.versionId === practice.responsibilityId); if (!row) throw new AppError("CONFLICT");
    const current = await project(tx, actor, caseId, row, ring, now);
    if (current.assignmentId !== practice.assignmentId || current.version !== practice.version || current.participant !== practice.participant || current.localTime !== practice.localTime || current.timezone !== practice.timezone || current.startsOn !== practice.startsOn || current.endsOn !== practice.endsOn) throw new AppError("CONFLICT");
    if (recipients.some(id => !practice.audienceAccountIds.includes(id) || !current.audienceAccountIds.includes(id))) throw new AppError("NOT_FOUND");
  }
}
