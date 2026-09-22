import { AppError } from '../../lib/errors.ts';

/** Browser-safe monetary validation. No payment-state or provider decisions. */
export function assertMinor(value:number,max=10_000_000):number{if(!Number.isSafeInteger(value)||value<1||value>max)throw new AppError('INVALID_REQUEST');return value;}
export function parseIlsMinor(value:string):number{
 const match=/^(0|[1-9][0-9]{0,6})(?:\.([0-9]{1,2}))?$/.exec(value.trim());if(!match)throw new AppError('INVALID_REQUEST');
 return assertMinor(Number(match[1])*100+Number((match[2]??'').padEnd(2,'0')));
}
