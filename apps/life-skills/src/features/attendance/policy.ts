import { AppError } from '../../lib/errors.ts';
import type { Appointment, Attendance, AttendanceInput } from '../calendar/types.ts';
import { iso, ms } from '../calendar/time.ts';
export function attended(state: Attendance['state']): boolean { return state==='present' || state==='late'; }
export function countsAsChildSession(kind: Appointment['kind'], state: Attendance['state'] | undefined): boolean {
 return kind==='individual' && (state==='present' || state==='late');
}
export function validateAttendance(a: Appointment, prior: Attendance|null, input: AttendanceInput, now:string) {
 if (!['present','late','no_show','canceled'].includes(input.state) || input.expectedVersion!==(prior?.version??0)) throw new AppError('CONFLICT');
 if ((prior || a.status==='rescheduled' || a.status.startsWith('canceled')) && !input.correctionReason?.trim()) throw new AppError('INVALID_REQUEST');
 if (input.correctionReason && input.correctionReason.length>500) throw new AppError('INVALID_REQUEST');
 if (input.state==='no_show' && ms(now)<ms(a.endsAt)) throw new AppError('CONFLICT');
 if (attended(input.state)) {
  if (!input.arrivedAt || ms(now)<ms(a.startsAt) || ms(input.arrivedAt)>ms(now) || ms(input.arrivedAt)<ms(a.startsAt)-30*60_000 || ms(input.arrivedAt)>=ms(a.endsAt)) throw new AppError('INVALID_REQUEST');
  if (input.state==='late' && ms(input.arrivedAt)<=ms(a.startsAt)) throw new AppError('INVALID_REQUEST');
  if (input.state==='present' && ms(input.arrivedAt)>ms(a.startsAt)) throw new AppError('INVALID_REQUEST');
 } else if (input.arrivedAt!==null) throw new AppError('INVALID_REQUEST');
 return {state:input.state,attended:attended(input.state),arrivedAt:input.arrivedAt?iso(input.arrivedAt):null,version:(prior?.version??0)+1};
}
