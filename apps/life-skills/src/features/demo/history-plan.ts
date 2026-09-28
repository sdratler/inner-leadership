import {AppError} from '../../lib/errors.ts';
import {possibleInstants,shiftDay} from '../calendar/time.ts';
import {METRICS,type MetricValues} from '../session-workflow/metrics.ts';
export interface DemoHistoryItem {sourceKey:string;caseSource:'owner-minor-a';startsAt:string;location:string;commandKey:string;values:MetricValues;}
function object(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('INVALID_REQUEST');return value as Record<string,unknown>;}
function marked(value:Record<string,unknown>,batch:string){if(value.isDemo!==true||value.demoBatchId!==batch||value.source!=='owner-acceptance-demo'||value.externalEffects!=='deny'||value.realAnalytics!=='exclude')throw new AppError('INVALID_REQUEST');}
/** Read only the already-supplied synthetic recipe. No identity, DB, provider or
 * observation write; the owner subsequently saves scores through the real UI.
 * reflective_capacity is explicitly mapped to the current reflection metric.
 */
export function demoHistoryPlan(recipe:unknown,batchId:string):{anchorDate:string;items:DemoHistoryItem[]}{
 if(!/^ls-owner-[0-9]{8}$/.test(batchId))throw new AppError('INVALID_REQUEST');const r=object(recipe);
 if(r.schemaVersion!==1||r.recipeOnly!==true||r.notExecuted!==true||r.batchId!==batchId||r.timezone!=='Asia/Jerusalem'||typeof r.anchorDate!=='string'||!Array.isArray(r.appointments)||r.appointments.length>20||!Array.isArray(r.observations)||r.observations.length!==5)throw new AppError('INVALID_REQUEST');
 const anchorDate=shiftDay(r.anchorDate,0),past=r.appointments.map(object).filter(a=>a.state==='completed'),observations=r.observations.map(object);
 if(past.length!==5)throw new AppError('INVALID_REQUEST');
 const items:DemoHistoryItem[]=past.map((a,i)=>{marked(a,batchId);const sourceKey=`session-${i+1}`,o=observations[i]!;marked(o,batchId);
  if(a.stableKey!==sourceKey||a.caseKey!=='case-a'||a.attendance!=='present'||a.durationMinutes!==60||a.blocksRealAvailability!==false||a.timezone!=='Asia/Jerusalem'||a.localTime!=='11:00'||typeof a.localDate!=='string'||o.stableKey!==`observation-${i+1}`||o.caseKey!=='case-a'||o.sessionKey!==sourceKey||o.observedDate!==a.localDate||o.visibility!=='practitioner_private')throw new AppError('INVALID_REQUEST');
  const date=shiftDay(a.localDate,0),weekday=new Date(date+'T12:00Z').getUTCDay();
  if(date>=anchorDate||date<shiftDay(anchorDate,-31)||weekday===5||weekday===6||i>0&&date<=String(past[i-1]?.localDate))throw new AppError('INVALID_REQUEST');
  const instants=possibleInstants(date+'T11:00');if(instants.length!==1)throw new AppError('INVALID_REQUEST');
  const original=object(o.values),expected=METRICS.map(m=>m.id==='reflection'?'reflective_capacity':m.id).sort();
  if(Object.keys(original).sort().join()!==expected.join())throw new AppError('INVALID_REQUEST');
  const values=Object.fromEntries(METRICS.map(m=>{const v=object(original[m.id==='reflection'?'reflective_capacity':m.id]);
   if(v.note!=='Synthetic observation for interface verification only.'||v.score!==null&&(!Number.isInteger(v.score)||Number(v.score)<1||Number(v.score)>10))throw new AppError('INVALID_REQUEST');
   return [m.id,{score:v.score as number|null,notObservedReason:v.score===null?'Synthetic measure not observed':null,note:v.note}];})) as MetricValues;
  return {sourceKey,caseSource:'owner-minor-a',startsAt:instants[0]!,location:'DEMO — Historical synthetic session; no external booking or meeting link',commandKey:`${batchId}_history_${sourceKey}_v1`,values};
 });return {anchorDate,items};
}
