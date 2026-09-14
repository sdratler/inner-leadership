import { AppError } from '../../lib/errors.ts';
import { audienceAccess, caseAccess, requirePractitioner, validateAssignees } from '../cases/policy.ts';
import type { CaseFacts, GuardianFacts, AudienceFacts } from '../cases/policy.ts';
import type { AccountFacts } from '../identity/types.ts';
import type { Appointment, CreateBooking, Notice, NoticeInput, Availability } from './types.ts';
import { ms, iso, endOfAppointment, noticeEligibility, MINUTE_MS } from './time.ts';
export function authorizeAppointment(actor: AccountFacts, item: CaseFacts | null, guardians: readonly GuardianFacts[], audience: AudienceFacts | null, appointment: Pick<Appointment,'workspaceId'|'caseId'|'audienceId'|'practitionerId'>, practitionerOnly=false) {
 if (!audience || !item || appointment.workspaceId!==actor.workspaceId || appointment.caseId!==item.id || appointment.audienceId!==audience.id || appointment.practitionerId!==item.practitionerAccountId) throw new AppError('NOT_FOUND');
 audienceAccess(actor,item,guardians,audience);
 if (practitionerOnly) caseAccess(actor,item,guardians,'write');
}
export function validateBooking(actor: AccountFacts, item: CaseFacts, guardians: readonly GuardianFacts[], audience: AudienceFacts, input: CreateBooking, now: string) {
 requirePractitioner(actor); caseAccess(actor,item,guardians,'write');
 if (item.kind!=='minor' || !['active','intake'].includes(item.state)) throw new AppError('CONFLICT');
 if (input.caseId!==item.id || audience.caseId!==item.id || input.audienceId!==audience.id || !audience.published || audience.visibility!=='family_full') throw new AppError('INVALID_REQUEST');
 if (!['individual','parent_guidance'].includes(input.kind)) throw new AppError('INVALID_REQUEST');
 if (!Number.isInteger(input.bufferBefore) || !Number.isInteger(input.bufferAfter) || input.bufferBefore<0 || input.bufferAfter<0 || input.bufferBefore>120 || input.bufferAfter>120) throw new AppError('INVALID_REQUEST');
 if (ms(input.startsAt)<=ms(now) || ms(input.startsAt)>ms(now)+366*86_400_000) throw new AppError('INVALID_REQUEST');
 if (input.location.length>280 || /[\u0000-\u001f]/.test(input.location)) throw new AppError('INVALID_REQUEST');
 if (input.kind==='parent_guidance') {
  if (!input.parentForId) throw new AppError('INVALID_REQUEST'); validateAssignees(actor,item,guardians,audience,input.parentIds);
 } else if (input.parentForId!==null || input.parentIds.length) throw new AppError('INVALID_REQUEST');
 return {startsAt:iso(input.startsAt), endsAt:endOfAppointment(input.startsAt,input.kind)};
}
export function paddedSlot(a: Pick<Appointment,'startsAt'|'endsAt'|'bufferBefore'|'bufferAfter'>) {
 return {startsAt:new Date(ms(a.startsAt)-a.bufferBefore*MINUTE_MS).toISOString(), endsAt:new Date(ms(a.endsAt)+a.bufferAfter*MINUTE_MS).toISOString()};
}
export function assertAvailable(slot: {startsAt:string;endsAt:string}, windows: readonly Availability[], busy: readonly {startsAt:string;endsAt:string}[]) {
 const start=ms(slot.startsAt), end=ms(slot.endsAt);
 if (end<=start || !windows.some(w=>w.kind==='open' && ms(w.startsAt)<=start && ms(w.endsAt)>=end) || windows.some(w=>w.kind==='blocked' && ms(w.startsAt)<end && start<ms(w.endsAt)) || busy.some(w=>ms(w.startsAt)<end && start<ms(w.endsAt))) throw new AppError('CONFLICT');
}
export function validateWindows(input: NoticeInput) {
 if (input.proposedWindows.length>3 || (input.kind==='cancel' && input.proposedWindows.length)) throw new AppError('INVALID_REQUEST');
 for (const w of input.proposedWindows) if (ms(w.endsAt)<=ms(w.startsAt) || ms(w.endsAt)-ms(w.startsAt)>7*86_400_000) throw new AppError('INVALID_REQUEST');
}
export function makeNoticeFields(appointment: Appointment, input: NoticeInput, receivedAt: string, recordedAt: string) {
 validateWindows(input);
 if (ms(receivedAt)>ms(recordedAt) || ms(receivedAt)<ms(appointment.createdAt)) throw new AppError('INVALID_REQUEST');
 return {kind:input.kind, receivedAt:iso(receivedAt), recordedAt:iso(recordedAt), originalStart:appointment.startsAt,
 noticeMilliseconds:ms(appointment.startsAt)-ms(receivedAt), termsVersion:appointment.termsVersion,
 eligibility:noticeEligibility(appointment.startsAt,receivedAt),
 proposedWindows:input.proposedWindows.map(w=>({startsAt:iso(w.startsAt),endsAt:iso(w.endsAt)}))};
}
export function creditRuleLabel(a: Pick<Appointment,'kind'>, n: Pick<Notice,'eligibility'> | null): 'included_checkin'|'protected'|'late_notice'|'standard' {
 if (a.kind==='parent_guidance') return 'included_checkin';
 if (n?.eligibility==='credit_preserved' || n?.eligibility==='practitioner_exception') return 'protected';
 return n ? 'late_notice' : 'standard';
}
