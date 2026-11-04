import en from './academy-trip390-en.json' with {type:'json'};
import he from './academy-trip390-he.json' with {type:'json'};
import type {Locale} from '../../lib/locale.ts';

/** Prepared source-bound agreement. This export grants no legal/signature activation. */
export const TRIP390_STUDENT_AGREEMENT_VERSION='JLFA-STUDENT-AGREEMENT-20261104-06-v1' as const;
const digests={"en": "a945a42a93a35f20a68780015a2350a04f4a08ac7ce217f780e4cf89d9769ef2", "he": "d79a3b2f9cb9e0071d98a8b63e0642373443eea5fac2c29daba6d7d5e74f9a8f"} as const;
export function trip390StudentAgreement(locale:Locale){
 const catalog=locale==='he'?he:en;
 const copy={...catalog.studentAgreement,acknowledgment:catalog.form.conduct};
 const text=[copy.title,copy.intro,...copy.sections.map(section=>section.title+'\n'+section.body),copy.acknowledgment,copy.signatureLabel].join('\n\n');
 return {...copy,version:TRIP390_STUDENT_AGREEMENT_VERSION,language:locale,text,textDigest:digests[locale]};
}
