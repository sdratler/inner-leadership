import en from './academy-trip390-en.json' with {type:'json'};
import he from './academy-trip390-he.json' with {type:'json'};
import type {Locale} from '../../lib/locale.ts';

/** Read-to-child attestation only, distinct from the frozen -06 typed document. */
export const TRIP390_STUDENT_CONDUCT_VERSION='JLFA-STUDENT-CONDUCT-20261104-07-v1' as const;
const digests={"en": "ef7f1a1348ad51fb3ed7b0ae926de2d5b91aeab690661ab38240660a5d2b4aa1", "he": "9e5c548095a8a0c5de3561138e60db819748353500ff5ff1677c689823d67743"} as const;
export function trip390StudentConduct(locale:Locale){
 const c=locale==='he'?he:en,body=c.studentAgreement,acknowledgment=c.form.conduct;
 const text=[body.title,body.intro,...body.sections.map(s=>s.title+'\n'+s.body),acknowledgment].join('\n\n');
 return {title:body.title,intro:body.intro,sections:body.sections,acknowledgment,version:TRIP390_STUDENT_CONDUCT_VERSION,language:locale,text,textDigest:digests[locale]};
}
