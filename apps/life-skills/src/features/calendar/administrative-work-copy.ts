import type {Locale} from '../../lib/locale.ts';
import {linkedInquiryTaskTitle} from '../prospects/admin-display.ts';
import {localizedCaseTaskTitle} from './case-work-copy.ts';
export const administrativeTaskKinds=['intake_followup','booking_followup','creative_approval','publishing_failure'] as const;
export type AdministrativeTaskKind=typeof administrativeTaskKinds[number];
const titles:Record<AdministrativeTaskKind,Record<Locale,string>>={
 intake_followup:{en:'Follow up submitted intake',he:'המשך טיפול לאחר הגשת טופס הקבלה'},
 booking_followup:{en:'Arrange booking after verified payment',he:'תיאום פגישה לאחר אימות תשלום'},
 creative_approval:{en:'Review artwork awaiting approval',he:'בדיקת גרפיקה שממתינה לאישור'},
 publishing_failure:{en:'Review recorded publishing failure',he:'בדיקת כשל פרסום מתועד'},
};
export function isAdministrativeTaskKind(value:unknown):value is AdministrativeTaskKind{return administrativeTaskKinds.some(kind=>kind===value);}
export function administrativeTaskTitle(kind:AdministrativeTaskKind,identity:string):string{return `${titles[kind].en} · ${identity}`.slice(0,140);}
/** Translate only our exact app-owned prefix; never rewrite the source identity
 * or unknown/custom text. No approval, payment or booking is asserted here. */
export function localizedAdministrativeTaskTitle(title:string,kind:unknown,locale:Locale):string{
 if(!isAdministrativeTaskKind(kind))return title;
 const prefix=titles[kind].en+' · ';
 return title.startsWith(prefix)?titles[kind][locale]+' · '+title.slice(prefix.length):title;
}
/** One presentation function for the Calendar card and its actual edit dialog. */
export function localizedTaskTitle(title:string,kind:unknown,locale:Locale):string{
 return localizedAdministrativeTaskTitle(localizedCaseTaskTitle(linkedInquiryTaskTitle(title,kind==='crm_followup'?'crm_followup':null,locale),kind,locale),kind,locale);
}
