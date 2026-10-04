import {AppError} from '../../lib/errors.ts';
import {assertCalendarDate} from '../home-practice/policy.ts';
import {validClock} from '../assignment-participants/wall-time.ts';

export interface DemoPracticeItem {
 caseSource:'owner-minor-a'|'owner-adult-a';role:'parent'|'child'|'adult';
 commandKey:string;instructions:string;startsOn:string;endsOn:string;occursOn:string;localTime:string;
}
function object(value:unknown):Record<string,unknown>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw new AppError('INVALID_REQUEST');
 return value as Record<string,unknown>;
}
/** Consume the existing two-assignment recipe; no new copy, account, clock or
 * provider policy. A chosen occurrence date must remain inside both windows. */
export function demoPracticePlan(recipe:unknown,batch:string,occursOn:string):DemoPracticeItem[]{
 if(!/^ls-owner-[0-9]{8}$/.test(batch))throw new AppError('INVALID_REQUEST');
 const date=assertCalendarDate(occursOn),r=object(recipe);
 if(r.schemaVersion!==1||r.recipeOnly!==true||r.notExecuted!==true||r.batchId!==batch||r.timezone!=='Asia/Jerusalem'||
  !Array.isArray(r.assignments)||r.assignments.length!==2)throw new AppError('INVALID_REQUEST');
 const items:DemoPracticeItem[]=[];
 for(const raw of r.assignments){
  const a=object(raw),minor=a.stableKey==='practice-a',adult=a.stableKey==='practice-adult';
  if(!minor&&!adult||a.caseKey!==(minor?'case-a':'case-adult')||a.isDemo!==true||a.demoBatchId!==batch||
   a.source!=='owner-acceptance-demo'||a.externalEffects!=='deny'||a.realAnalytics!=='exclude'||a.timezone!=='Asia/Jerusalem'||a.revision!==1||
   typeof a.startDate!=='string'||typeof a.endDate!=='string'||!Array.isArray(a.responsibilities)||a.responsibilities.length!==(minor?2:1))throw new AppError('INVALID_REQUEST');
  const startsOn=assertCalendarDate(a.startDate),endsOn=assertCalendarDate(a.endDate);
  if(date<startsOn||date>endsOn||Date.parse(endsOn)-Date.parse(startsOn)>31*86400000)throw new AppError('INVALID_REQUEST');
  const seen=new Set<string>();
  for(const rawResponsibility of a.responsibilities){
   const v=object(rawResponsibility),role=v.key==='child-action'&&minor?'child':v.key==='parent-support'&&minor?'parent':v.key==='adult-action'&&adult?'adult':null;
   if(!role||v.participantKey!==`${role}-a`||seen.has(role)||typeof v.text!=='string'||!v.text.trim()||v.text.length>1900||typeof v.localTime!=='string'||!validClock(v.localTime))throw new AppError('INVALID_REQUEST');
   seen.add(role);
   items.push({caseSource:minor?'owner-minor-a':'owner-adult-a',role,commandKey:`${batch}_practice_${role}_v1`,
    instructions:`DEMO — ${v.text}`,startsOn,endsOn,occursOn:date,localTime:v.localTime});
  }
 }
 if(new Set(items.map(v=>v.role)).size!==3)throw new AppError('INVALID_REQUEST');
 return items;
}
