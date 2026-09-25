/** Browser-safe projections. None of these types carries clinical notes or credentials. */
export type Locale = "he" | "en";
export type Channel = "whatsapp" | "email" | "app";
export type PeopleView = "all" | "prospects" | "paid" | "active" | "archived";
export type IntakeStage = "new" | "contacted" | "form_sent" | "form_submitted" | "payment_pending" | "payment_verified" | "booked" | "needs_review";
export type RecordMode = "live" | "demo";
export interface AdministrativePerson {
    personId: string;
    workspaceId: string;
    displayName: string;
    kind: "contact" | "guardian" | "adult_client" | "child";
    locale: Locale | null;
    endpoints: readonly {
        channel: "whatsapp" | "email";
        value: string;
        verified: boolean;
        shared: boolean;
    }[];
    legacyLeadIds: readonly string[];
    caseIds: readonly string[];
    mode: RecordMode;
    demoBatchId: string | null;
    archivedAt: string | null;
    doNotContact: boolean;
    version: number;
}
export interface JourneyFacts {
    personId: string;
    enrollmentId: string;
    caseId: string | null;
    /** Set by the actual intake transaction, NOT by a Sheet's status text. */
    formSubmittedAt: string | null;
    formSentAt: string | null;
    contactedAt: string | null;
    /** Actual non-reversed payment allocation; never a boolean imported from Sheet. */
    paymentAllocationId: string | null;
    paymentReversedAt: string | null;
    /** Actual confirmed booking; a sent link is not a booking. */
    confirmedAppointmentId: string | null;
    activeCase: boolean;
    suspended: boolean;
}
export interface PersonRow {
    id: string;
    displayName: string;
    kind: AdministrativePerson["kind"];
    phone: string | null;
    email: string | null;
    locale: Locale | null;
    stage: IntakeStage;
    stages: readonly IntakeStage[];
    archived: boolean;
    active: boolean;
    openProspect: boolean;
    paidAwaitingBooking: boolean;
    doNotContact: boolean;
    demo: boolean;
    caseCount: number;
    nextAction: string | null;
    followUpDate: string | null;
    nextAppointmentAt: string | null;
    unreadCount: number;
    version: number;
}
export interface PersonAttention {
    personId: string;
    nextAction: string | null;
    followUpDate: string | null;
    nextAppointmentAt: string | null;
    unreadCount: number;
}
export interface Page<T> {
    items: readonly T[];
    total: number;
    page: number;
    pageSize: number;
    pages: number;
}
export type DeliveryState = "draft" | "queued" | "sending" | "accepted" | "delivered" | "read" | "failed" | "unknown" | "cancelled";
export interface AdministrativeMessage {
    id: string;
    conversationId: string;
    channel: "whatsapp" | "email";
    direction: "inbound" | "outbound";
    bodyText: string;
    at: string;
    state: DeliveryState;
    /** Attachment bytes must be delivered through an authenticated app route. */
    attachments: readonly {
        id: string;
        displayName: string;
        state: "available" | "blocked" | "unavailable";
        href: string | null;
    }[];
}
export interface ConversationRow {
    id: string;
    personId: string | null;
    title: string;
    channel: "whatsapp" | "email";
    preview: string;
    lastAt: string;
    unread: number;
    demo: boolean;
    unresolvedIdentity: boolean;
}
export interface SourceStamp {
    fileId: string;
    contentHash: string;
    revision: string | null;
    declaredVersion: string | null;
    modifiedAt: string;
    checkedAt: string;
}
export type CalendarLayer = "appointments" | "tasks" | "followups" | "practice" | "broadcasts" | "content";
