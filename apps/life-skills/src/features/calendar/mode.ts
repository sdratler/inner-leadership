import {AppError} from '../../lib/errors.ts';
import type {CaseChoice} from './forms.tsx';
export type CalendarMode='live'|'demo';
export function calendarMode(value:unknown):CalendarMode {
 if(value===undefined)return 'live';
 if(value!=='live'&&value!=='demo')throw new AppError('INVALID_REQUEST');return value;
}
/** The existing authorized API supplies immutable provenance; never infer it
 * from names or silently filter a corrupt/mixed response into an empty list. */
export function calendarCasesForMode(value:unknown,mode:CalendarMode):CaseChoice[]{
 if(!Array.isArray(value)||value.length>100)throw new AppError('UNAVAILABLE');
 for(const item of value)if(!item||typeof item!=='object'||typeof item.id!=='string'||!item.id||typeof item.displayName!=='string'||typeof item.state!=='string'||!['minor','adult'].includes(item.kind)||item.mode!==mode)throw new AppError('UNAVAILABLE');
 return value as CaseChoice[];
}
