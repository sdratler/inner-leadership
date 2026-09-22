/** Extension contracts: adapt to the existing home-practice services; do not create a competing task engine. */
export type CheckInState = "done" | "partly_done" | "not_done" | "rescheduled" | "not_applicable";
export interface Responsibility {
    id: string;
    assignmentId: string;
    version: number;
    workspaceId: string;
    caseId: string;
    subjectPersonId: string;
    participant: "client" | "parent";
    instructions: string;
    assigneeAccountIds: readonly string[];
    assistedByParentAccountIds: readonly string[];
    audienceAccountIds: readonly string[];
    reminderRecipients: readonly {
        accountId: string;
        purpose: "self" | "support" | "remind_child";
    }[];
    completionMode: "any_assignee" | "each_assignee";
    startsOn: string;
    endsOn: string;
    weekdays: readonly number[];
    localTime: string | null;
    timezone: string;
    timeOrigin: "session_agreement" | "practitioner" | "case_default";
    state: "draft" | "published" | "paused" | "ended";
}
export interface SavedPracticeDefault {
    localTime: string;
    timezone: string;
    selectedByAccountId: string;
    selectedAt: string;
}
export interface PracticeOccurrence {
    id: string;
    assignmentId: string;
    responsibilityId: string;
    responsibilityVersion: number;
    workspaceId: string;
    caseId: string;
    localDate: string;
    localTime: string;
    timezone: string;
    startsAt: string;
    timeOrigin: Responsibility["timeOrigin"];
}
export interface CheckIn {
    id: string;
    occurrenceId: string;
    responsibilityId: string;
    responsibilityVersion: number;
    workspaceId: string;
    caseId: string;
    authenticatedAccountId: string;
    subjectPersonId: string;
    authorship: "self" | "parent_assisted_child" | "parent_reporting_child";
    state: CheckInState;
    note: string;
    recordedAt: string;
    revision: number;
    replacesId: string | null;
}
export interface ReminderPreferences {
    accountId: string;
    channels: readonly ("in_app" | "email" | "push" | "whatsapp")[];
    practiceEnabled: boolean;
    timezone: string;
    doNotDisturb: {
        enabled: boolean;
        start: string;
        end: string;
    };
}
