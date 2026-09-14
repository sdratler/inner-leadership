import type { AccountId, CaseId, Id, WorkspaceId } from '../../lib/ids.ts';
import type { AudienceId, EngagementId } from '../identity/types.ts';
import type { CreditEffectReference, RescheduleEligibilityReference } from '../identity/interfaces.ts';
export type AppointmentId = Id<'appointment'>;
export type NoticeId = Id<'reschedule_request'>;
export type AppointmentKind = 'individual' | 'parent_guidance';
export type AppointmentStatus = 'scheduled' | 'completed' | 'canceled_family' | 'canceled_practitioner' | 'rescheduled';
export type AttendanceState = 'present' | 'late' | 'no_show' | 'canceled';
export interface Appointment {
 id: AppointmentId; workspaceId: WorkspaceId; caseId: CaseId; audienceId: AudienceId;
 engagementId: EngagementId; practitionerId: AccountId; termsVersion: string;
 kind: AppointmentKind; startsAt: string; endsAt: string; status: AppointmentStatus;
 parentForId: AppointmentId | null; originalId: AppointmentId | null;
 parentIds: AccountId[]; bufferBefore: number; bufferAfter: number; version: number;
 location: string; createdBy: AccountId; createdAt: string;
}
export interface Notice {
 id: NoticeId; appointmentId: AppointmentId; caseId: CaseId;
 kind: 'cancel' | 'reschedule'; source: 'app' | 'phone' | 'whatsapp_manual';
 receivedAt: string; recordedAt: string; originalStart: string; noticeMilliseconds: number;
 requestedBy: AccountId; enteredBy: AccountId; termsVersion: string;
 eligibility: RescheduleEligibilityReference['eligibility'];
 state: 'pending' | 'confirmed' | 'closed'; replacementId: AppointmentId | null;
 proposedWindows: Array<{ startsAt: string; endsAt: string }>;
}
export interface Attendance {
 state: AttendanceState; attended: boolean; arrivedAt: string | null;
 version: number; recordedAt: string; recordedBy: AccountId;
}
export interface AppointmentView extends Appointment {
 notice: Notice | null; attendance: Attendance | null;
 /** Never derived from payment consumption; true only for an attended individual appointment. */
 countsAsChildSession: boolean;
 checkinNeedsReview: boolean;
 replacementId: AppointmentId | null;
 creditException: {reasonCode: 'practitioner_exception' | 'provider_unavailable'; recordedAt:string} | null;
}
export interface Availability {
 id: string; startsAt: string; endsAt: string; kind: 'open' | 'blocked'; version: number;
}
export interface CreateBooking {
 caseId: CaseId; audienceId: AudienceId; kind: AppointmentKind; startsAt: string;
 parentForId: AppointmentId | null; parentIds: AccountId[];
 bufferBefore: number; bufferAfter: number; location: string;
 /** A check-in after a missed/canceled child meeting needs deliberate practitioner discretion. */
 checkinExceptionReason: string | null;
}
export interface NoticeInput {
 kind: 'cancel' | 'reschedule'; proposedWindows: Array<{ startsAt: string; endsAt: string }>;
}
export interface ManualNoticeInput extends NoticeInput {
 source: 'phone' | 'whatsapp_manual'; receivedAt: string; requestedBy: AccountId;
}
export interface AttendanceInput {
 state: AttendanceState; arrivedAt: string | null; expectedVersion: number;
 correctionReason: string | null;
}
export interface CalendarCreditEnvelope {
 schemaVersion: 1; workspaceId: WorkspaceId; streamId: AppointmentId; sequence: number;
 credit: CreditEffectReference;
}
export type CalendarEvent =
 | { type: 'notice_received'; reference: RescheduleEligibilityReference }
 | { type: 'credit_effect'; reference: CreditEffectReference }
 | { type: 'attendance_recorded'; appointmentId: AppointmentId; state: AttendanceState; attended: boolean; version: number; occurredAt: string }
 | { type: 'appointment_changed'; appointmentId: AppointmentId; version: number; occurredAt: string };
export interface SchedulePage { items: AppointmentView[]; nextCursor: string | null; serverNow: string; }
