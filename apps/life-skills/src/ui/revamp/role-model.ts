import type { Role, Locale } from "../../features/session-workflow/types.ts";
export interface RoleDestination {
    key: string;
    en: string;
    he: string;
}
/** Presentation only. The authenticated server must separately authorize every destination and record. */
const commonClient: readonly RoleDestination[] = [{ key: "home", en: "Home", he: "בית" }, { key: "calendar", en: "Calendar", he: "יומן" }, { key: "practice", en: "Practice", he: "תרגול" }, { key: "messages", en: "Messages", he: "הודעות" }];
export function roleDestinations(role: Role): readonly RoleDestination[] {
    return role === "practitioner" ? [
        { key: "calendar", en: "Calendar", he: "יומן" }, { key: "clients", en: "Clients", he: "לקוחות" }, { key: "messages", en: "Communications", he: "תקשורת" }, { key: "reports", en: "Reports", he: "דוחות" }, { key: "marketing", en: "Marketing", he: "שיווק" }
    ] : commonClient;
}
export const CLIENT_SECTIONS: readonly RoleDestination[] = [{ key: "overview", en: "Overview", he: "סקירה" }, { key: "calendar", en: "Calendar", he: "יומן" }, { key: "assignments", en: "Assignments", he: "משימות" }, { key: "communications", en: "Communications", he: "תקשורת" }, { key: "sessions", en: "Sessions", he: "מפגשים" }, { key: "reports", en: "Reports", he: "דוחות" }, { key: "materials", en: "Forms & resources", he: "טפסים ומשאבים" }, { key: "access", en: "Access", he: "גישה" }];
export function roleLabel(role: Role, locale: Locale): string { return { practitioner: { en: "Practitioner", he: "מטפל" }, parent: { en: "Parent", he: "הורה" }, adult_client: { en: "My space", he: "המרחב שלי" }, child: { en: "My space", he: "המרחב שלי" } }[role][locale]; }
