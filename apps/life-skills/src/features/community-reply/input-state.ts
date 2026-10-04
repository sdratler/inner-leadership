import type { CommunityReplyResult } from "./bridge.ts";
import type { CommunitySavedDraft } from "./drafts-bridge.ts";
export type CommunitySourceInput = { question: string; originalUrl: string };

/** JSON property order is not identity; array order and every recorded value are. */
function sameRecordedValue(left:unknown,right:unknown):boolean {
  if(left===right)return true;
  if(!left||!right||typeof left!=='object'||typeof right!=='object')return false;
  if(Array.isArray(left)||Array.isArray(right))return Array.isArray(left)&&Array.isArray(right)&&left.length===right.length&&left.every((value,index)=>sameRecordedValue(value,right[index]));
  const a=left as Record<string,unknown>,b=right as Record<string,unknown>,keys=Object.keys(a);
  return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&sameRecordedValue(a[key],b[key]));
}

/** Reopening or editing cannot reassign a draft to another immutable input/source envelope. */
export function matchesSavedDraftBinding(row:CommunitySavedDraft|undefined,previous:CommunitySavedDraft):row is CommunitySavedDraft {
  return !!row&&row.draftId===previous.draftId&&row.question===previous.question&&row.originalUrl===previous.originalUrl&&
    row.expiresAt===previous.expiresAt&&sameRecordedValue(row.generated,previous.generated);
}

/** Mutable edit/safety fields must match the exact receipt; immutable source identity cannot change. */
export function matchesEditedDraftReadback(row:CommunitySavedDraft|undefined,previous:CommunitySavedDraft,receipt:CommunitySavedDraft,draft:string):row is CommunitySavedDraft {
  return matchesSavedDraftBinding(row,previous)&&matchesSavedDraftBinding(receipt,previous)&&receipt.revision===previous.revision+1&&
    receipt.draft===draft&&sameRecordedValue(row,receipt);
}

/** A generation is confirmed only by its complete persisted source, safety and provenance binding. */
export function matchesGeneratedReadback(row:CommunitySavedDraft|undefined,value:CommunityReplyResult,input:CommunitySourceInput|null):boolean {
  if(!row||!input)return false;
  let originalUrl:string|null=null;
  try{originalUrl=input.originalUrl.trim()?new URL(input.originalUrl.trim()).toString():null;}catch{return false;}
  return row.draftId===value.operationId&&row.question===input.question&&row.originalUrl===originalUrl&&value.originalUrl===originalUrl&&
    sameRecordedValue(row.generated,value)&&
    (row.revision!==1||(row.copyAllowed===value.copyAllowed&&sameRecordedValue(row.reviewFlags,value.reviewFlags)));
}

/** The same public source boundary applies before generation and when reading saved drafts. */
export function isCommunitySourceUrl(value: string): boolean {
  if (value.length > 1000) return false;
  try { const url = new URL(value); return url.protocol === "https:" && !url.username && !url.password &&
    ["facebook.com", "www.facebook.com", "m.facebook.com"].includes(url.hostname); }
  catch { return false; }
}

/** Only the authenticated API's explicit limit response warrants a limit-specific message. */
export function replyFailureKind(status: number, code?: string): "limited" | "unconfirmed" {
  return status === 429 && code === "RATE_LIMITED" ? "limited" : "unconfirmed";
}

/** A previous draft stays editable, but must not be copied or revised under changed source input. */
export function matchesSubmittedInput(current: CommunitySourceInput, submitted: CommunitySourceInput | null): boolean {
  return !!submitted && current.question.trim() === submitted.question && current.originalUrl.trim() === submitted.originalUrl;
}

/** Restoring a correction must not silently replace another question, edit or generated reply. */
export function ruleDraftPromotionNeedsConfirmation(current: CommunitySourceInput, restored: CommunitySourceInput, editedDraft = false,
  activeOperationId?: string, restoredOperationId?: string): boolean {
  return editedDraft || (!!activeOperationId && activeOperationId !== restoredOperationId) ||
    ((current.question.trim().length > 0 || current.originalUrl.trim().length > 0) &&
    !matchesSubmittedInput(current, restored));
}

/** Validation-only results have no stored command to resume. Conflicts need fresh source review. */
export function canResumeRuleOperation(status: string): boolean {
  return ["pending", "permission_denied", "unknown", "saved", "draft_pending"].includes(status);
}

/** A fresh generation never inherits a proposal from an earlier revision. */
export function proposalForResult(mode: "generate" | "revise_once", suggestedRule: string, scope: "" | "community" | "general") {
  return mode === "revise_once" ? { rule: suggestedRule, scope: scope === "general" ? "general" as const : "community" as const } : { rule: "", scope: "community" as const };
}
