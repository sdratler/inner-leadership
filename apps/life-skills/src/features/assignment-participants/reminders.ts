import type { CaseContext } from "../session-workflow/types.ts";
import { invariant, validIso, validTimezone } from "../session-workflow/policy.ts";
import type { PracticeOccurrence, ReminderPreferences, Responsibility } from "./contracts.ts";
import { validClock } from "./scheduling.ts";
export type ReminderDecision = {
    eligible: true;
    purpose: "self" | "support" | "remind_child";
    channels: ReminderPreferences["channels"];
} | {
    eligible: false;
    reason: string;
};
export function inDoNotDisturb(instant: string, prefs: ReminderPreferences): boolean {
    invariant(validIso(instant) && validTimezone(prefs.timezone), "REMINDER_TIMEZONE");
    if (!prefs.doNotDisturb.enabled)
        return false;
    const { start, end } = prefs.doNotDisturb;
    invariant(validClock(start) && validClock(end) && start !== end, "DND_INTERVAL");
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: prefs.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(instant)).map(x => [x.type, x.value]));
    const clock = `${p.hour}:${p.minute}`;
    return start < end ? clock >= start && clock < end : clock >= start || clock < end;
}
/** Evaluate immediately before each delivery, after loading current membership/preferences. No external effects here. */
export function reminderDecision(context: CaseContext, r: Responsibility, o: PracticeOccurrence, prefs: ReminderPreferences, now: string, alreadyComplete: boolean): ReminderDecision {
    if (!context.active || r.state !== "published" || r.caseId !== context.caseId || r.workspaceId !== context.workspaceId || o.responsibilityId !== r.id || o.responsibilityVersion !== r.version || o.caseId !== context.caseId || o.workspaceId !== context.workspaceId)
        return { eligible: false, reason: "inactive_or_stale" };
    const member = context.members.find(m => m.accountId === prefs.accountId && m.active), recipient = r.reminderRecipients.find(v => v.accountId === prefs.accountId);
    if (!member || !recipient || !r.audienceAccountIds.includes(prefs.accountId))
        return { eligible: false, reason: "not_authorized" };
    if (recipient.purpose === "remind_child" && member.role !== "parent")
        return { eligible: false, reason: "invalid_support_role" };
    if (alreadyComplete)
        return { eligible: false, reason: "already_completed" };
    if (!prefs.practiceEnabled || !prefs.channels.length)
        return { eligible: false, reason: "opted_out" };
    if (inDoNotDisturb(now, prefs))
        return { eligible: false, reason: "do_not_disturb" };
    const delta = Date.parse(now) - Date.parse(o.startsAt);
    if (!Number.isFinite(delta) || delta < 0 || delta > 3600000)
        return { eligible: false, reason: "not_due_or_expired" };
    return { eligible: true, purpose: recipient.purpose, channels: [...new Set(prefs.channels)] };
}
export const LOCKSCREEN_PRACTICE_NOTICE = { en: "You have a reminder in Life Skills. Open the app to view it.", he: "ממתינה לך תזכורת בכישורי חיים. אפשר לפתוח את האפליקציה לצפייה." } as const;
