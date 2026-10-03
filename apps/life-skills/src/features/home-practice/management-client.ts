import { IdentityClientError, sessionInfo, type IdentityClientErrorCode } from "../identity/client.ts";
import type { GoalView } from "../goals/types.ts";
import type { CommitmentView } from "../commitments/types.ts";
import type { PracticeManagementPage,ScheduledOccurrence } from "./types.ts";
import {sameResponsibilityInput,type ResponsibilityInput,type ResponsibilityParticipants} from "./responsibility-input.ts";
import {recurrenceInput,recurrenceCommand,recurrencePlan,type RecurrenceInput,type RecurrenceCommand,type RecurrencePlan} from "./recurrence-input.ts";

export interface PracticeAudience { id: string; published: boolean; visibility: "private" | "family_full" | "family_title_completion"; }
export interface PracticeManagementData { practice: PracticeManagementPage; goals: GoalView[]; commitments: CommitmentView[];participants?:ResponsibilityParticipants;scheduled?:ScheduledOccurrence[]; }
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

function checkedRecurrence(value:unknown,input:RecurrenceInput,caseId:string,audienceId:string):RecurrencePlan{
 const parsed=recurrencePlan.safeParse(value);if(!parsed.success)throw new IdentityClientError("UNAVAILABLE");const plan=parsed.data;
 if(plan.caseId!==caseId||plan.audienceId!==audienceId||plan.assignmentId!==input.assignmentId||plan.practiceVersionId!==input.expectedVersionId||plan.from!==input.from||plan.to!==input.to||new Set(plan.items.map(row=>row.id)).size!==plan.items.length||plan.items.some(row=>row.assignmentId!==input.assignmentId||row.practiceVersionId!==input.expectedVersionId||row.occursOn<input.from||row.occursOn>input.to))throw new IdentityClientError("UNAVAILABLE");
 return plan;
}
export async function readRecurrence(input:RecurrenceInput,caseId:string,audienceId:string,signal?:AbortSignal):Promise<RecurrencePlan>{
 const parsed=recurrenceInput.safeParse(input);if(!parsed.success)throw new IdentityClientError("INVALID_REQUEST");
 return checkedRecurrence(await request("/api/home-practice?"+new URLSearchParams({view:"recurrence",...parsed.data}),{method:"GET"},signal),parsed.data,caseId,audienceId);
}
export async function saveRecurrence(input:RecurrenceCommand,caseId:string,audienceId:string):Promise<RecurrencePlan>{
 const parsed=recurrenceCommand.safeParse(input);if(!parsed.success)throw new IdentityClientError("INVALID_REQUEST");const session=await sessionInfo();if(session.role!=="practitioner")throw new IdentityClientError("NOT_FOUND");
 return checkedRecurrence(await request("/api/home-practice",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":session.csrfToken},body:JSON.stringify({action:"schedule_range",...parsed.data})}),parsed.data,caseId,audienceId);
}
export function recurrenceReadback(approved:RecurrencePlan,saved:RecurrencePlan):boolean{
  return saved.planDigest===approved.planDigest&&saved.assignmentId===approved.assignmentId&&saved.practiceVersionId===approved.practiceVersionId&&saved.caseId===approved.caseId&&saved.audienceId===approved.audienceId&&saved.from===approved.from&&saved.to===approved.to&&saved.localTime===approved.localTime&&saved.timezone===approved.timezone&&JSON.stringify(saved.weekdays)===JSON.stringify(approved.weekdays)&&saved.items.length===approved.items.length&&saved.items.every((row,index)=>{const original=approved.items[index];return row.existing&&original!==undefined&&row.id===original.id&&row.assignmentId===original.assignmentId&&row.practiceVersionId===original.practiceVersionId&&row.coordinationVersionId===original.coordinationVersionId&&row.occursAt===original.occursAt&&row.occursOn===original.occursOn&&row.period===original.period;});
}
