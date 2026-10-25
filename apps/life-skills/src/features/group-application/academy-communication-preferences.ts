import {z} from 'zod';
// Versioned optional choices, separate from mandatory registration contact consent.
export const academyCommunicationNotice={id:'jlfa-parent-communication-options',version:'JLFA-PARENT-COMMS-OPTIONS-20261025-01-v1',en:"Optional: I would like educational Fishing Academy emails after I confirm my interest. I may decline without affecting free registration. Private WhatsApp contact is a separate optional choice; it does not add me to any group. Neither choice authorizes payment, unrelated marketing or sharing private child information.",he:"לבחירה: ברצוני לקבל דוא״ל חינוכי מהאקדמיה לדיג לאחר אישור ההתעניינות. אפשר לסרב בלי לפגוע בהרשמה החינמית. קשר פרטי ב־WhatsApp הוא בחירה נפרדת ולא חובה; הוא אינו מצרף אותי לקבוצה. אף בחירה אינה מתירה תשלום, שיווק שאינו קשור או שיתוף מידע פרטי על הילדים."} as const;
export const academyCommunicationNoticeHashes={en:'1e7f1d1d418ce4a51d75eabd67d7fe589d8bf979ed33cfbbd06103276aa7c661',he:'d70f0a50cc0b02d48caa1aeb1d8e059c4fa1e34bdd769a2f9620b1b35f3dcaeb'} as const;
export const academyCommunicationPreferencesSchema=z.object({
 version:z.literal('academy-parent-communication-preferences-v1'),
 parentLanguage:z.enum(['en','he']),nurtureEmail:z.boolean(),privateWapi:z.boolean(),
 notice:z.object({documentId:z.literal(academyCommunicationNotice.id),version:z.literal(academyCommunicationNotice.version),language:z.enum(['en','he']),textSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict(),
}).strict().superRefine((value,context)=>{if(value.notice.textSha256!==academyCommunicationNoticeHashes[value.notice.language])context.addIssue({code:'custom',path:['notice'],message:'communication_notice_mismatch'});});
export type AcademyCommunicationPreferences=z.infer<typeof academyCommunicationPreferencesSchema>;
export const academyRecordedCommunicationPreferencesSchema=z.object({selection:academyCommunicationPreferencesSchema,revision:z.number().int().positive(),applicationId:z.uuid(),recordedAt:z.iso.datetime(),source:z.literal('completed_parent_registration')}).strict();
export type AcademyRecordedCommunicationPreferences=z.infer<typeof academyRecordedCommunicationPreferencesSchema>;
export function communicationPreferenceSelection(parentLanguage:'en'|'he',nurtureEmail:boolean,privateWapi:boolean,noticeLanguage:'en'|'he'):AcademyCommunicationPreferences{return {version:'academy-parent-communication-preferences-v1',parentLanguage,nurtureEmail,privateWapi,notice:{documentId:academyCommunicationNotice.id,version:academyCommunicationNotice.version,language:noticeLanguage,textSha256:academyCommunicationNoticeHashes[noticeLanguage]}};}
/** Called only after the existing immutable application is accepted; callers cannot supply proof timestamps. */
export function captureCommunicationPreferences(selection:unknown,applicationId:string,recordedAt:Date,previous?:AcademyRecordedCommunicationPreferences):AcademyRecordedCommunicationPreferences{
 return academyRecordedCommunicationPreferencesSchema.parse({selection:academyCommunicationPreferencesSchema.parse(selection),revision:(previous?.revision??0)+1,applicationId,recordedAt:recordedAt.toISOString(),source:'completed_parent_registration'});
}
/** Missing legacy evidence stays unknown. No UI, group, phone or CRM label inference. */
export function communicationPreferenceReadback(value:unknown){
 const parsed=academyRecordedCommunicationPreferencesSchema.safeParse(value);
 return parsed.success?{parentLanguage:parsed.data.selection.parentLanguage,nurtureEmail:parsed.data.selection.nurtureEmail?'requested' as const:'not_requested' as const,privateWapi:parsed.data.selection.privateWapi?'requested' as const:'not_requested' as const,revision:parsed.data.revision,recordedAt:parsed.data.recordedAt}:{parentLanguage:null,nurtureEmail:'unknown' as const,privateWapi:'unknown' as const,revision:null,recordedAt:null};
}

/** Labels describe captured choices only; never a provider or send permission claim. */
export function communicationPreferenceStatusLabel(status:unknown,locale:'en'|'he'){
 const labels=status==='requested'?['Requested','התבקש']:status==='not_requested'?['Not requested','לא התבקש']:['Not recorded — optional permission not established','לא תועד — הרשאה אופציונלית לא אומתה'];
 return labels[locale==='he'?1:0]!;
}
