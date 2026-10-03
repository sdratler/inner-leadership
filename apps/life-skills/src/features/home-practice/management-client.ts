import { IdentityClientError, sessionInfo, type IdentityClientErrorCode } from "../identity/client.ts";
import type { GoalView } from "../goals/types.ts";
import type { CommitmentView } from "../commitments/types.ts";
import type { PracticeManagementPage,ScheduledOccurrence } from "./types.ts";
import {sameResponsibilityInput,type ResponsibilityInput,type ResponsibilityParticipants} from "./responsibility-input.ts";

export interface PracticeAudience { id: string; published: boolean; visibility: "private" | "family_full" | "family_title_completion"; }
export interface PracticeManagementData { practice: PracticeManagementPage; goals: GoalView[]; commitments: CommitmentView[];participants?:ResponsibilityParticipants;scheduled?:ScheduledOccurrence[]; }
/** Keep section/case context while making the selected audience navigable. */
export function practiceAudienceHref(pathname: string, search: string, caseId: string, audienceId: string): string {
  const query = new URLSearchParams(search);
  query.set("caseId", caseId); query.set("audienceId", audienceId);
  return pathname + "?" + query;
}
const codes: readonly IdentityClientErrorCode[] = ["INVALID_REQUEST", "UNAUTHENTICATED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "RATE_LIMITED", "UNAVAILABLE", "INTERNAL"];
async function request<T>(path: string, init: RequestInit, signal?: AbortSignal): Promise<T> {
  try {
    const response = await fetch(path, { ...init, ...(signal ? { signal } : {}), credentials: "same-origin", cache: "no-store", redirect: "error", referrerPolicy: "no-referrer" });
    const payload = await response.json() as { ok?: boolean; data?: T; error?: { code?: string } };
    if (response.ok && payload?.ok === true && Object.hasOwn(payload, "data")) return payload.data as T;
    throw new IdentityClientError(codes.includes(payload?.error?.code as IdentityClientErrorCode) ? payload.error!.code as IdentityClientErrorCode : "UNAVAILABLE");
  } catch (error) {
    if (signal?.aborted || error instanceof IdentityClientError) throw error;
    throw new IdentityClientError("UNAVAILABLE");
  }
}
export async function managementAudiences(caseId: string, signal: AbortSignal): Promise<PracticeAudience[]> {
  const rows = await request<PracticeAudience[]>("/api/identity/audiences?" + new URLSearchParams({ caseId }), { method: "GET" }, signal);
  if (!Array.isArray(rows) || rows.some(row => !row || typeof row.id !== "string" || typeof row.published !== "boolean" || !["private", "family_full", "family_title_completion"].includes(row.visibility))) throw new IdentityClientError("UNAVAILABLE");
  return rows;
}
export async function readPracticeManagement(caseId: string, audienceId: string, signal: AbortSignal): Promise<PracticeManagementData> {
  const query = new URLSearchParams({ view: "management", caseId, audienceId });
  const [practice, goals, commitments] = await Promise.all([
    request<PracticeManagementPage>("/api/home-practice?" + new URLSearchParams({ view: "management", caseId, audienceId }), { method: "GET" }, signal),
    request<GoalView[]>("/api/goals?" + query, { method: "GET" }, signal),
    request<CommitmentView[]>("/api/commitments?" + query, { method: "GET" }, signal),
  ]);
  if (!practice || !Array.isArray(practice.items) || typeof practice.hasMore !== "boolean" || !Array.isArray(goals) || !Array.isArray(commitments) ||
    [...practice.items, ...goals, ...commitments].some(row => !row || row.caseId !== caseId || row.audienceId !== audienceId) ||
    practice.items.some(row => !["draft", "published"].includes(row.state) || typeof row.instructions !== "string" || typeof row.active !== "boolean")) throw new IdentityClientError("UNAVAILABLE");
  return { practice, goals, commitments };
}
export type PracticeAuthoringCommand =
  | { action: "create_draft"; caseId: string; audienceId: string; instructions: string; startsOn: string; endsOn: string | null; templateKey: string; templateVersion: string; goalId?: string; commitmentId?: string;responsibility?:ResponsibilityInput }
  | { action: "revise"; assignmentId: string; instructions: string; startsOn: string; endsOn: string | null;responsibility?:ResponsibilityInput }
  | { action: "publish"; assignmentId: string; versionId: string }
  | { action:"schedule";assignmentId:string;occursOn:string;period:"morning"|"evening" }
  | { action: "goal"; caseId: string; audienceId: string; title: string }
  | { action: "commitment"; caseId: string; audienceId: string; goalId: string; title: string };
export async function savePracticeAuthoring(command: PracticeAuthoringCommand): Promise<Record<string, unknown>> {
  // A role check is useful UI recovery, not a substitute for server case policy.
  const session = await sessionInfo();
  if (session.role !== "practitioner") throw new IdentityClientError("NOT_FOUND");
  const { action, ...fields } = command;
  return request(action === "goal" ? "/api/goals" : action === "commitment" ? "/api/commitments" : "/api/home-practice", {
    method: "POST", headers: { "Content-Type": "application/json", "X-CSRF-Token": session.csrfToken },
    body: JSON.stringify(action === "goal" || action === "commitment" ? fields : command),
  });
}
/** Verify the exact returned version/ID; a matching title is not save evidence. */
export function authoringReadback(command: PracticeAuthoringCommand, receipt: Record<string, unknown>, data: PracticeManagementData): boolean {
  if(command.action==="schedule")return data.scheduled?.some(row=>row.id===receipt.id&&row.assignmentId===command.assignmentId&&row.practiceVersionId===receipt.practiceVersionId&&row.coordinationVersionId===receipt.coordinationVersionId&&row.occursOn===command.occursOn&&row.period===command.period&&row.occursAt===receipt.occursAt&&row.state!=="cancelled")===true;
  if (command.action === "goal") return data.goals.some(row => row.id === receipt.id && row.caseId === command.caseId && row.audienceId === command.audienceId && row.title === command.title);
  if (command.action === "commitment") return data.commitments.some(row => row.id === receipt.id && row.goalId === command.goalId && row.caseId === command.caseId && row.audienceId === command.audienceId && row.title === command.title);
  const versionId = command.action === "publish" ? command.versionId : receipt.versionId;
  const assignmentId = command.action === "create_draft" ? receipt.assignmentId : command.assignmentId;
  const row = data.practice.items.find(item => item.versionId === versionId && item.assignmentId === assignmentId);
  if (!row) return false;
  if (command.action === "publish") return row.state === "published" && row.active && Boolean(row.publishedAt && row.immutableSnapshotDigest);
  return row.state === "draft" && row.instructions === command.instructions && row.startsOn === command.startsOn && row.endsOn === command.endsOn &&
    (command.responsibility===undefined||sameResponsibilityInput(row.responsibility,command.responsibility))&&
    (command.action !== "create_draft" || row.caseId === command.caseId && row.audienceId === command.audienceId && row.goalId === (command.goalId ?? null) && row.commitmentId === (command.commitmentId ?? null));
}
