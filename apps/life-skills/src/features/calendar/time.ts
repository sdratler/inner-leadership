import { AppError } from '../../lib/errors.ts';
import { instant, PRACTICE_TIME_ZONE } from '../../lib/time.ts';
export const NOTICE_PROTECTION_MS = 86_400_000;
export const MINUTE_MS = 60_000;
export function iso(value: string): string { try { return instant(value); } catch { throw new AppError('INVALID_REQUEST'); } }
export function ms(value: string): number { return Date.parse(iso(value)); }
export function noticeEligibility(originalStart: string, receivedAt: string): 'credit_preserved' | 'late_notice' {
 return ms(originalStart) - ms(receivedAt) >= NOTICE_PROTECTION_MS ? 'credit_preserved' : 'late_notice';
}
export function endOfAppointment(start: string, kind: 'individual' | 'parent_guidance'): string {
 return new Date(ms(start) + (kind === 'individual' ? 60 : 15) * MINUTE_MS).toISOString();
}
export function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
 return ms(aStart) < ms(bEnd) && ms(bStart) < ms(aEnd);
}
const wallFormatter = new Intl.DateTimeFormat('en-CA', {
 timeZone: PRACTICE_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
});
export function localMinute(value: string): string {
 const parts = Object.fromEntries(wallFormatter.formatToParts(new Date(ms(value))).map(p => [p.type,p.value]));
 return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}
/** Returns zero for a spring gap, two for an autumn fold. Never silently chooses an offset. */
export function possibleInstants(local: string): string[] {
 if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) throw new AppError('INVALID_REQUEST');
 const nominal = Date.parse(local + ':00Z');
 if (!Number.isFinite(nominal) || new Date(nominal).toISOString().slice(0,16) !== local) throw new AppError('INVALID_REQUEST');
 const found: string[] = [];
 for (let offset = -14 * 60; offset <= 14 * 60; offset += 15) {
  const candidate = new Date(nominal - offset * MINUTE_MS).toISOString();
  if (localMinute(candidate) === local) found.push(candidate);
 }
 return [...new Set(found)].sort();
}
export function civilDate(value: string): string { return localMinute(value).slice(0,10); }
export function shiftDay(date: string, days: number): string {
 if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isInteger(days)) throw new AppError('INVALID_REQUEST');
 const d = new Date(`${date}T12:00:00Z`);
 if (!Number.isFinite(d.valueOf()) || d.toISOString().slice(0,10) !== date) throw new AppError('INVALID_REQUEST');
 d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0,10);
}
export function dayStart(date: string): string {
 const choices = possibleInstants(`${shiftDay(date,0)}T00:00`);
 if (!choices[0]) throw new AppError('INVALID_REQUEST'); return choices[0];
}
export function calendarView(value: unknown): 'day' | 'week' | 'month' | 'agenda' {
 return value === 'day' || value === 'month' || value === 'agenda' ? value : 'week';
}
export function dateRange(date: string, view: 'day' | 'week' | 'month' | 'agenda') {
 let start = shiftDay(date,0), count = 1;
 if (view === 'week') { start = shiftDay(date,-new Date(`${date}T12:00Z`).getUTCDay()); count=7; }
 if (view === 'agenda') count=14;
 if (view === 'month') {
  const first=date.slice(0,8)+'01'; start=shiftDay(first,-new Date(`${first}T12:00Z`).getUTCDay()); count=42;
 }
 return { dates: Array.from({length:count},(_,i)=>shiftDay(start,i)), from:dayStart(start), to:dayStart(shiftDay(start,count)) };
}

/** Navigate calendar months by their actual month, clamping the anchor day. */
export function shiftMonth(date:string,delta:number):string {
 civilDate(date+'T12:00:00.000Z');
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isSafeInteger(delta)||Math.abs(delta)>1200)throw new AppError('INVALID_REQUEST');
 const [year,month,day]=date.split('-').map(Number) as [number,number,number];
 const first=new Date(Date.UTC(year,month-1+delta,1,12));
 const last=new Date(Date.UTC(first.getUTCFullYear(),first.getUTCMonth()+1,0,12)).getUTCDate();
 first.setUTCDate(Math.min(day,last));return first.toISOString().slice(0,10);
}
