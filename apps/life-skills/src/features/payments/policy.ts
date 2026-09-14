import { createHash } from 'node:crypto';
import { AppError } from '../../lib/errors.ts';
import type { CreditEffectReference } from '../identity/interfaces.ts';
export const APPOINTMENT_RATE_MINOR=55_000 as const;
export const BLOCK_PRICE_MINOR=220_000 as const;
export const CREDITS_PER_BLOCK=4 as const;
export const TERMS_VERSION='Product2.3' as const;
export const CURRENCY='ILS' as const;
export const IDEMPOTENCY_KEY=/^[A-Za-z0-9][A-Za-z0-9_.:-]{15,99}$/;
export function assertMinor(value:number,max=10_000_000):number{if(!Number.isSafeInteger(value)||value<1||value>max)throw new AppError('INVALID_REQUEST');return value;}
export function parseIlsMinor(value:string):number{
 const match=/^(0|[1-9][0-9]{0,6})(?:\.([0-9]{1,2}))?$/.exec(value.trim());if(!match)throw new AppError('INVALID_REQUEST');
 return assertMinor(Number(match[1])*100+Number((match[2]??'').padEnd(2,'0')));
}
function normalized(value:unknown):unknown{
 if(Array.isArray(value))return value.map(normalized);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,normalized(v)]));
 if(value===null||['string','number','boolean'].includes(typeof value))return value;
 throw new AppError('INVALID_REQUEST');
}
export function canonicalJson(value:unknown):string{return JSON.stringify(normalized(value));}
export function bodyDigest(value:unknown):string{return createHash('sha256').update(canonicalJson(value)).digest('hex');}
export interface CalendarFacts {kind:'individual'|'parent_guidance';termsVersion:string;noticeEligibility:'credit_preserved'|'late_notice'|null;attendanceState:'present'|'late'|'no_show'|'canceled'|null;exceptionReason:'practitioner_exception'|'provider_unavailable'|null;priorConsumed:boolean;}
export function calendarDisposition(effect:CreditEffectReference['effect'],facts:CalendarFacts):'consume'|'restore'|'preserve'{
 if(facts.kind!=='individual'||facts.termsVersion!==TERMS_VERSION)throw new AppError('CONFLICT');
 const protectedCredit=facts.noticeEligibility==='credit_preserved'||facts.exceptionReason!==null;
 if(effect==='preserve'){if(!protectedCredit)throw new AppError('CONFLICT');return 'preserve';}
 if(effect==='restore'){if(!protectedCredit||!facts.priorConsumed)throw new AppError('CONFLICT');return 'restore';}
 const consumable=facts.noticeEligibility==='late_notice'||facts.attendanceState==='present'||facts.attendanceState==='late'||facts.attendanceState==='no_show';
 if(protectedCredit||!consumable)throw new AppError('CONFLICT');return 'consume';
}
export function creditReason(effect:'consume'|'restore'|'preserve',facts:CalendarFacts):string{
 if(effect==='restore'||effect==='preserve')return facts.exceptionReason??'timely_notice';
 if(facts.noticeEligibility==='late_notice')return 'late_notice';
 return facts.attendanceState==='no_show'?'no_show':'attended';
}
