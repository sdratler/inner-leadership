import {AppError} from '../../lib/errors.ts';
import {possibleInstants,shiftDay} from '../calendar/time.ts';
export interface DemoCalendarItem {
 sourceKey:string;caseSource:'owner-minor-a'|'owner-adult-a';kind:'individual'|'parent_guidance';
 startsAt:string;parentSourceKey:string|null;location:string;commandKey:string;
}
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('INVALID_REQUEST');
 return value as Record<string,unknown>;
}
/** Consume the supplied recipe, not another seed architecture or account list.
 * Stable keys deliberately exclude the date: changing a previously executed
 * recipe conflicts with its encrypted receipt instead of creating duplicates.
 * The four items are only the future-calendar increment, not the whole recipe.
 */
export function demoCalendarPlan(recipe:unknown,batchId:string):{anchorDate:string;items:DemoCalendarItem[]}{
 if(!/^ls-owner-[0-9]{8}$/.test(batchId))throw new AppError('INVALID_REQUEST');
 const r=object(recipe);
 if(r.schemaVersion!==1||r.recipeOnly!==true||r.notExecuted!==true||r.batchId!==batchId||r.timezone!=='Asia/Jerusalem'||
  typeof r.anchorDate!=='string'||!Array.isArray(r.appointments)||r.appointments.length>20)throw new AppError('INVALID_REQUEST');
 const anchorDate=shiftDay(r.anchorDate,0),future=r.appointments.map(object).filter(a=>a.state==='scheduled');
 if(future.length!==3)throw new AppError('INVALID_REQUEST');
 const items:DemoCalendarItem[]=future.map((a,i)=>{
  const sourceKey=`appointment-${i+1}`,adult=i===2;
  if(a.stableKey!==sourceKey||a.caseKey!==(adult?'case-adult':'case-a')||a.isDemo!==true||a.demoBatchId!==batchId||
   a.source!=='owner-acceptance-demo'||a.externalEffects!=='deny'||a.realAnalytics!=='exclude'||a.blocksRealAvailability!==false||
   a.timezone!=='Asia/Jerusalem'||a.durationMinutes!==60||typeof a.localDate!=='string'||a.localTime!==(adult?'13:00':'11:00'))throw new AppError('INVALID_REQUEST');
  const date=shiftDay(a.localDate,0),day=new Date(`${date}T12:00Z`).getUTCDay();
  if(date<=anchorDate||date>shiftDay(anchorDate,14)||day===5||day===6||i>0&&date<=String(future[i-1]?.localDate))throw new AppError('INVALID_REQUEST');
  const choices=possibleInstants(`${date}T${a.localTime}`);if(choices.length!==1)throw new AppError('INVALID_REQUEST');
  return {sourceKey,caseSource:adult?'owner-adult-a':'owner-minor-a',kind:'individual',startsAt:choices[0]!,parentSourceKey:null,
   location:'DEMO — Calendar verification; no external booking or meeting link',commandKey:`${batchId}_calendar_${sourceKey}_v1`};
 });
 items.push({sourceKey:'parent-guidance-1',caseSource:'owner-minor-a',kind:'parent_guidance',
  startsAt:new Date(Date.parse(items[0]!.startsAt)+75*60_000).toISOString(),parentSourceKey:'appointment-1',
  location:'DEMO — Parent guidance; no external booking or meeting link',commandKey:`${batchId}_calendar_parent-guidance-1_v1`});
 return {anchorDate,items};
}
