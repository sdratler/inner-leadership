import type { AdministrativePerson, JourneyFacts, PersonAttention, PersonRow, PeopleView, IntakeStage, Page } from "./types.js";
import { dateOnly, epoch, requireThat } from "./validation.js";
/** Preserve a person's multiple enrollments; one sibling's payment never marks another as paid. */
export function journeyStage(f: JourneyFacts): IntakeStage {
    if (f.suspended)
        return "needs_review";
    if (f.confirmedAppointmentId)
        return "booked";
    if (f.paymentAllocationId && !f.paymentReversedAt)
        return "payment_verified";
    if (f.formSubmittedAt)
        return "payment_pending";
    if (f.formSentAt)
        return "form_sent";
    if (f.contactedAt)
        return "contacted";
    return "new";
}
const order: IntakeStage[] = ["new", "contacted", "form_sent", "form_submitted", "payment_pending", "payment_verified", "booked", "needs_review"];
export function projectPeople(workspaceId: string, people: readonly AdministrativePerson[], facts: readonly JourneyFacts[], attention: readonly PersonAttention[]): PersonRow[] {
    const seen = new Set<string>();
    return people.map(p => {
        requireThat(p.workspaceId === workspaceId, "CROSS_WORKSPACE");
        requireThat(!seen.has(p.personId), "DUPLICATE_PERSON");
        seen.add(p.personId);
        requireThat(p.mode !== "demo" || Boolean(p.demoBatchId), "UNMARKED_DEMO");
        const fs = facts.filter(f => f.personId === p.personId), a = attention.find(x => x.personId === p.personId);
        const stages = fs.map(journeyStage);
        const stage = stages.sort((a, b) => order.indexOf(b) - order.indexOf(a))[0] ?? "new";
        if (a?.followUpDate)
            requireThat(dateOnly(a.followUpDate), "BAD_FOLLOWUP_DATE");
        if (a?.nextAppointmentAt)
            epoch(a.nextAppointmentAt);
        requireThat(!a || Number.isSafeInteger(a.unreadCount) && a.unreadCount >= 0, "BAD_UNREAD_COUNT");
        return { id: p.personId, displayName: p.mode === "demo" && !p.displayName.startsWith("DEMO — ") ? "DEMO — " + p.displayName : p.displayName,
            kind: p.kind, phone: p.endpoints.find(x => x.channel === "whatsapp")?.value ?? null, email: p.endpoints.find(x => x.channel === "email")?.value ?? null,
            locale: p.locale, stage, archived: p.archivedAt !== null, active: fs.some(f => f.activeCase && !f.suspended),
            openProspect: fs.length === 0 || fs.some(f => !f.activeCase && !f.confirmedAppointmentId && !f.suspended),
            paidAwaitingBooking: fs.some(f => Boolean(f.paymentAllocationId) && !f.paymentReversedAt && !f.confirmedAppointmentId && !f.suspended),
            doNotContact: p.doNotContact, demo: p.mode === "demo", caseCount: new Set(p.caseIds).size,
            nextAction: a?.nextAction ?? null, followUpDate: a?.followUpDate ?? null, nextAppointmentAt: a?.nextAppointmentAt ?? null, unreadCount: a?.unreadCount ?? 0, version: p.version };
    });
}
export interface PeopleQuery {
    view: PeopleView;
    search: string;
    stage?: IntakeStage;
    locale?: "he" | "en";
    due?: "any" | "today" | "overdue";
    today: string;
    page: number;
    pageSize: number;
    sort?: "name" | "followup";
}
export function selectPeople(rows: readonly PersonRow[], q: PeopleQuery): Page<PersonRow> {
    requireThat(dateOnly(q.today), "BAD_TODAY");
    requireThat(Number.isSafeInteger(q.page) && q.page >= 1, "BAD_PAGE");
    requireThat(Number.isSafeInteger(q.pageSize) && q.pageSize >= 1 && q.pageSize <= 100, "BAD_PAGE_SIZE");
    const text = q.search.trim().toLocaleLowerCase();
    const filtered = rows.filter(r => {
        if (q.view === "all" && r.archived)
            return false;
        if (q.view === "prospects" && (!r.openProspect || r.archived))
            return false;
        if (q.view === "paid" && (!r.paidAwaitingBooking || r.archived))
            return false;
        if (q.view === "active" && (!r.active || r.archived))
            return false;
        if (q.view === "archived" && !r.archived)
            return false;
        if (q.stage && r.stage !== q.stage)
            return false;
        if (q.locale && q.locale !== r.locale)
            return false;
        if (q.due === "today" && (!r.followUpDate || r.followUpDate > q.today))
            return false;
        if (q.due === "overdue" && (!r.followUpDate || r.followUpDate >= q.today))
            return false;
        return !text || [r.displayName, r.phone ?? "", r.email ?? ""].some(s => s.toLocaleLowerCase().includes(text));
    }).sort((a, b) => q.sort === "followup" ? (a.followUpDate ?? "9999").localeCompare(b.followUpDate ?? "9999") || a.id.localeCompare(b.id) : a.displayName.localeCompare(b.displayName) || a.id.localeCompare(b.id));
    const pages = Math.max(1, Math.ceil(filtered.length / q.pageSize)), page = Math.min(q.page, pages);
    return { items: filtered.slice((page - 1) * q.pageSize, page * q.pageSize), total: filtered.length, page, pageSize: q.pageSize, pages };
}
