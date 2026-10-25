import type {AcademyRegistration} from './academy-registration.ts';
import type {GroupApplicationRecord} from './contract.ts';

export interface AcademyInquiryFiltersValue {
 stageInterest: AcademyRegistration['stageInterest'] | '';
 day: AcademyRegistration['preferredDays'][number] | '';
 time: AcademyRegistration['preferredTimes'][number] | '';
 groupLanguage: AcademyRegistration['preferredGroupLanguage'] | '';
 /** Strings preserve an empty control and invalid edits without rounding. */
 ageYears: string;
 tripMinutes: string;
}
export const emptyAcademyInquiryFilters: Readonly<AcademyInquiryFiltersValue> = Object.freeze({stageInterest:'',day:'',time:'',groupLanguage:'',ageYears:'',tripMinutes:''});

export function academyInquiryFilterNumber(value:string,min:number,max:number):number|null {
 if(!/^\d+$/.test(value))return null;
 const number=Number(value);
 return Number.isSafeInteger(number)&&number>=min&&number<=max?number:null;
}

/** Filters only saved preferences, never eligibility, booking or child membership.
 * A match retains the complete application, including all siblings. */
export function matchesAcademyInquiryFilters(record:GroupApplicationRecord,filters:AcademyInquiryFiltersValue):boolean {
 const fields=record.fields;
 if(!fields||typeof fields!=='object'||!('programId' in fields)||fields.programId!=='sunday_fishing_academy')return false;
 if(Object.values(filters).every(value=>value===''))return true;
 if(!['','foundation','independent','advanced','leadership','discuss'].includes(filters.stageInterest)||!['','sunday','monday','tuesday','wednesday','thursday','friday','flexible'].includes(filters.day)||!['','morning','afternoon','evening','flexible'].includes(filters.time)||!['','en','he','either'].includes(filters.groupLanguage))return false;
 const registration='academyRegistration' in fields?fields.academyRegistration:undefined;
 if(!registration)return false;
 if(filters.stageInterest&&registration.stageInterest!==filters.stageInterest)return false;
 if(filters.day&&(!Array.isArray(registration.preferredDays)||!registration.preferredDays.every(day=>['sunday','monday','tuesday','wednesday','thursday','friday','flexible'].includes(day))||(registration.preferredDays.includes('flexible')&&registration.preferredDays.length!==1)||!registration.preferredDays.some(day=>day===filters.day||day==='flexible')))return false;
 if(filters.time&&(!Array.isArray(registration.preferredTimes)||!registration.preferredTimes.every(time=>['morning','afternoon','evening','flexible'].includes(time))||(registration.preferredTimes.includes('flexible')&&registration.preferredTimes.length!==1)||!registration.preferredTimes.some(time=>time===filters.time||time==='flexible')))return false;
 if(filters.groupLanguage&&registration.preferredGroupLanguage!==filters.groupLanguage&&registration.preferredGroupLanguage!=='either')return false;
 if(filters.ageYears!==''){
  const age=academyInquiryFilterNumber(filters.ageYears,0,17);
  if(age===null||!Array.isArray(registration.learners)||!registration.learners.some(child=>child&&Number.isInteger(child.ageYears)&&child.ageYears===age))return false;
 }
 if(filters.tripMinutes!==''){
  const minutes=academyInquiryFilterNumber(filters.tripMinutes,5,120),willing=registration.driveMinutes;
  if(minutes===null||!Number.isInteger(willing)||willing<5||willing>120||willing<minutes)return false;
 }
 return true;
}
