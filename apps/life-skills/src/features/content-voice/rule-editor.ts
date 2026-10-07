import { createHash } from "node:crypto";

/** A correction is an owner-reviewed writing preference, never post content. */
export type CommunityRuleChange = {
  operationId: string;
  rule: string;
  language: "en" | "he" | "both";
  targetRuleId?: string | null;
  at: string;
};
export type WritingRuleScope = "community" | "general";
export type WritingRuleChange = CommunityRuleChange & { scope?: WritingRuleScope };
export type RuleEdit = {
  state: "ready" | "already_applied" | "needs_review" | "needs_playbook" | "unsafe";
  text: string;
  ruleId: string | null;
  before: string | null;
  after: string | null;
  sha256: string;
};

const headings: Record<WritingRuleScope, string> = {
  community: "### Community-reply writing preferences",
  general: "### Global writing preferences",
};
const idPattern = /^CR-[0-9a-f]{32}$/;
const entryPattern = /^\*\*(CR-[0-9a-f]{32}) — scope: (community|general); language: (en|he|both); created: ([^;]+); updated: ([^*]+)\*\* (.+)$/gm;
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const normalized = (text: string) => text.normalize("NFKC").toLocaleLowerCase().replace(/[\p{P}\p{S}]/gu, " ").replace(/\s+/g, " ").trim();
const words = (text: string) => new Set(normalized(text).split(" ").filter(word => word.length >= 3));
const languagesOverlap = (a: CommunityRuleChange["language"], b: CommunityRuleChange["language"]) => a === b || a === "both" || b === "both";
function similarity(a: string, b: string): number {
  const left = words(a), right = words(b);
  if (!left.size || !right.size) return 0;
  const shared = [...left].filter(word => right.has(word)).length;
  return shared / Math.min(left.size, right.size);
}
function unsafe(rule: string): boolean {
  // Do not put public-post identities, links, contact details or factual/medical
  // assertions into a reusable guide. This is a conservative gate, not a claim
  // that regexes can identify every private detail; the owner also reviews it.
  return rule.length < 8 || rule.length > 400 || /[\r\n\0]/.test(rule) ||
    /(?:https?:\/\/|www\.|@|\+?\d[\d ()-]{6,}\d)/i.test(rule) ||
    /(?:diagnos|autis|adhd|medication|cure|clinical trial|research proves|studies prove|אוטיזם|אבחנ|תרופ|מחקר מוכיח)/i.test(rule);
}
function playbookRule(rule: string): boolean {
  // A changed channel/publishing policy belongs in the canonical Playbook.
  return /(?:\bcta\b|call to action|whatsapp|\bdm\b|booking link|publish|posting|group rules|sales invitation|קריאה לפעולה|וואטסאפ|הודעה פרטית|פרסומ|קישור להזמנה)/i.test(rule);
}
type Entry = { id: string; language: "en" | "he" | "both"; created: string; updated: string; rule: string; full: string };
function entries(source: string, scope: WritingRuleScope): Entry[] {
  const heading = headings[scope];
  const start = source.indexOf(heading);
  if (start < 0) return [];
  const tail = source.slice(start + heading.length);
  const end = tail.search(/\n#{1,3} /);
  const section = tail.slice(0, end < 0 ? undefined : end);
  return [...section.matchAll(entryPattern)].filter(match => match[2] === scope).map(match => ({
    id: match[1]!, language: match[3] as Entry["language"], created: match[4]!,
    updated: match[5]!, rule: match[6]!, full: match[0],
  }));
}
/** IDs of scoped rules present in the exact guide bytes sent with a draft. */
export function communityRuleIdsInGuide(source: string): string[] {
  return [...new Set(entries(source, "community").map(entry => entry.id))];
}
export function communityRulesInGuide(source: string): Array<{ id: string; language: "en" | "he" | "both"; rule: string }> {
  return writingRulesInGuide(source, "community");
}
export function globalRuleIdsInGuide(source: string): string[] {
  return [...new Set(entries(source, "general").map(entry => entry.id))];
}
export function writingRulesInGuide(source: string, scope: WritingRuleScope): Array<{ id: string; language: "en" | "he" | "both"; rule: string }> {
  return entries(source, scope).map(({ id, language, rule }) => ({ id, language, rule }));
}
function bumpVersion(text: string): string {
  const match = text.match(/^\*\*Version:\*\*\s*(\d+)\.(\d+)(\s*)$/m);
  if (!match) return text;
  return text.replace(match[0], `**Version:** ${match[1]}.${Number(match[2]) + 1}${match[3]}`);
}
const result = (state: RuleEdit["state"], text: string, ruleId: string | null,
  before: string | null, after: string | null): RuleEdit => ({ state, text, ruleId, before, after, sha256: digest(text) });

/** Pure scoped edit against the just-read canonical source. Caller performs CAS. */
export function composeCommunityRule(source: string, change: CommunityRuleChange): RuleEdit {
  return composeWritingRule(source, { ...change, scope: "community" });
}
export function composeWritingRule(source: string, change: WritingRuleChange): RuleEdit {
  const scope = change.scope ?? "community";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(change.operationId) ||
      !["community", "general"].includes(scope) ||
      !["en", "he", "both"].includes(change.language) || !Number.isFinite(Date.parse(change.at)) ||
      typeof source !== "string" || !source.includes("**Profile ID:** LS-CONTENT-VOICE") || !source.includes("## 2. Article structure"))
    return result("unsafe", source, null, null, null);
  if (unsafe(change.rule)) return result("unsafe", source, null, null, null);
  const rule = change.rule.trim().replace(/\s+/g, " ");
  if (playbookRule(rule)) return result("needs_playbook", source, null, null, null);
  const ruleId = `CR-${change.operationId.replace(/-/g, "").toLowerCase()}`;
  const heading = headings[scope];
  if (source.split(heading).length > 2) return result("needs_review", source, null, null, null);
  const found = entries(source, scope);
  // One operation/rule identity cannot silently move across source scopes.
  if (entries(source, scope === "community" ? "general" : "community").some(entry => entry.id === ruleId || entry.id === change.targetRuleId))
    return result("needs_review", source, null, null, null);
  const replay = found.find(entry => entry.id === ruleId);
  if (replay) return result(replay.rule === rule ? "already_applied" : "needs_review", source, replay.id, replay.full, replay.full);
  const exactMatches = found.filter(entry => languagesOverlap(entry.language, change.language) && normalized(entry.rule) === normalized(rule));
  const otherExact = exactMatches.find(entry => change.targetRuleId && entry.id !== change.targetRuleId);
  if (otherExact) return result("needs_review", source, otherExact.id, otherExact.full, null);
  const exact = exactMatches[0];
  if (exact && (exact.language === change.language || exact.language === "both")) return result("already_applied", source, exact.id, exact.full, exact.full);
  // Widening an existing single-language rule requires explicit consolidation,
  // not a second overlapping entry or an unapproved scope change.
  if (exact && !change.targetRuleId) return result("needs_review", source, exact.id, exact.full, null);
  let target: Entry | undefined;
  if (change.targetRuleId) {
    if (!idPattern.test(change.targetRuleId)) return result("unsafe", source, null, null, null);
    target = found.find(entry => entry.id === change.targetRuleId && languagesOverlap(entry.language, change.language));
    if (!target || (target.language === "both" && change.language !== "both")) return result("needs_review", source, target?.id ?? null, target?.full ?? null, null);
  } else {
    const matches = found.filter(entry => languagesOverlap(entry.language, change.language))
      .map(entry => ({ entry, score: similarity(entry.rule, rule) })).filter(item => item.score >= 0.6)
      .sort((a, b) => b.score - a.score);
    // A semantic match is shown to the owner for explicit selection. Similarity
    // must never silently overwrite another source agent's rule.
    if (matches.length) return result("needs_review", source, matches[0]!.entry.id,
      matches[0]!.entry.full, null);
  }
  const activeId = target?.id ?? ruleId;
  const line = `**${activeId} — scope: ${scope}; language: ${change.language}; created: ${target?.created ?? change.at}; updated: ${change.at}** ${rule}`;
  let desired: string;
  if (target) desired = source.replace(target.full, line);
  else if (source.includes(heading)) desired = source.replace(heading, `${heading}\n\n${line}`);
  else desired = source.replace("## 2. Article structure", `${heading}\n\n${line}\n\n## 2. Article structure`);
  desired = bumpVersion(desired);
  return result("ready", desired, activeId, target?.full ?? null, line);
}
