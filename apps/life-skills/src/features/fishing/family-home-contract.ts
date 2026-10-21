import {z} from 'zod';
import type {Locale} from '../../lib/locale.ts';
import type {StageView} from '../fishing-stage/contract.ts';
import type {FamilyPaymentView} from '../fishing-payments/domain.ts';
import {fishingCalendarSearch,fishingCalendarSelectionQuery,type FishingCalendarSelection,type FishingCalendarEvent} from './program-calendar-contract.ts';

export type FishingFamilyHome={sharedEvents?:readonly FishingCalendarEvent[];nextPhysical?:FishingCalendarEvent|null;selection:FishingCalendarSelection;label:string;view:StageView;payment:FamilyPaymentView|null};
const keys=['fishing','learnerId','enrollmentId','cohortId','stageId','stage'] as const;
/** Navigation hints only. Missing or malformed tuples never select a child. */
export function fishingFamilyContext(input:URLSearchParams):URLSearchParams|null{
 const value=new URLSearchParams();for(const key of keys){const all=input.getAll(key);if(all.length>1)return null;if(all.length)value.set(key,all[0]!);}
 if(value.get('fishing')!=='1')return null;
 if(['enrollmentId','cohortId','stageId','stage'].some(key=>value.has(key))){
  const selected=new URLSearchParams(value);selected.delete('fishing');
  try{const parsed=fishingCalendarSelectionQuery(selected);if(!parsed.learnerId||!parsed.enrollmentId)return null;return new URLSearchParams('fishing=1&'+fishingCalendarSearch(parsed));}catch{return null;}
 }
 if(value.has('learnerId')&&!z.uuid().safeParse(value.get('learnerId')).success)return null;
 return value;
}
export function fishingFamilyHref(locale:Locale,path:'family'|'family/schedule',context:URLSearchParams):string{
 const safe=fishingFamilyContext(context);return '/'+locale+'/'+path+(safe?'?'+safe:'');
}
export function fishingNextTrip(view:StageView){
 const matching=view.occurrences.filter(o=>o.id===view.nextOccurrenceId);
 if(view.role!=='parent'||!view.enrollmentId||matching.length!==1)return null;
 const o=matching[0]!;
 return o.state==='published'&&o.cohortId===view.cohortId&&o.stageId===view.stageId&&o.stage===view.stage&&o.time.kind==='scheduled'&&o.time.timeZone==='America/New_York'?o:null;
}
