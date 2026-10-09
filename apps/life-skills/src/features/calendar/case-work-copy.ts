import type {Locale} from '../../lib/locale.ts';
export const caseTaskKinds=['calendar_notice','form_review','update_review','session_observations','report_review'] as const;
export type CaseTaskKind=typeof caseTaskKinds[number];
const titles:Record<CaseTaskKind,Record<Locale,string>>={
 calendar_notice:{en:'Review appointment request',he:'בדיקת בקשה לגבי פגישה'},
 form_review:{en:'Review submitted form',he:'עיון בטופס שהוגש'},
 update_review:{en:'Review new app communication',he:'בדיקת תקשורת חדשה באפליקציה'},
 session_observations:{en:'Record private session observations',he:'תיעוד התרשמויות פרטיות מהמפגש'},
 report_review:{en:'Complete saved report draft',he:'השלמת טיוטת דוח שמורה'},
};
export function caseTaskTitle(kind:CaseTaskKind,locale:Locale):string{return titles[kind][locale];}
export function isCaseTaskKind(value:unknown):value is CaseTaskKind{return caseTaskKinds.some(kind=>kind===value);}
/** Only the complete app-owned label is translated. Preserve unknown/custom text. */
export function localizedCaseTaskTitle(title:string,kind:unknown,locale:Locale):string{
 return isCaseTaskKind(kind)&&title===caseTaskTitle(kind,'en')?caseTaskTitle(kind,locale):title;
}
