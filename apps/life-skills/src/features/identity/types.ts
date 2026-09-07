import type { AccountId, CaseId, Id, WorkspaceId } from "../../lib/ids.ts";
import type { Locale } from "../../lib/locale.ts";
export type { AccountId, CaseId, WorkspaceId, Locale };
export type PersonId = Id<"person">;
export type FamilyId = Id<"family">;
export type EngagementId = Id<"engagement">;
export type AudienceId = Id<"audience">;
export const accountRoles = ["practitioner", "parent", "adult_client"] as const;
export type AccountRole = (typeof accountRoles)[number];
export const accountStates = ["invited", "active", "revoked"] as const;
export type AccountState = (typeof accountStates)[number];
export interface AccountFacts {
  id: AccountId; workspaceId: WorkspaceId; personId: PersonId;
  role: AccountRole; state: AccountState; locale: Locale;
}
/** These facts must be loaded by the server; never deserialize a browser principal. */
export interface Actor extends AccountFacts { sessionDigest: string; expiresAt: number; }
export interface RequestContext { requestId: string; now: Date; }
export const notificationEvents = ["practice_due", "appointment_changed", "new_reply", "summary_published"] as const;
export type NotificationEvent = (typeof notificationEvents)[number];
export const notificationChannels = ["in_app", "email", "push", "whatsapp"] as const;
export type NotificationChannel = (typeof notificationChannels)[number];
export interface NotificationPreference {
  eventType: NotificationEvent; channel: NotificationChannel; enabled: boolean;
  locale: Locale; timezone: string; quietStart: string | null; quietEnd: string | null;
}
export interface VerifiedContact {
  kind: "email" | "phone"; verified: boolean; value: string;
}
export interface IdentityClock { now(): Date; }
export const systemClock: IdentityClock = Object.freeze({ now: () => new Date() });
