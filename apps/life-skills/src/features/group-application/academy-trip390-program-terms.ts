import en from './academy-trip390-en.json' with {type:'json'};
import he from './academy-trip390-he.json' with {type:'json'};
import type {Locale} from '../../lib/locale.ts';
export const TRIP390_PROGRAM_TERMS_VERSION='JLFA-PROGRAM-TERMS-20261104-06-v1' as const;
const digests={"en": "f8b41c07a2bec549482e804b79cae0e8253dfdf7e69f8e2846e842358a2e8f4b", "he": "ef4ac0f48fd03c57bbd353f037d44948aafc053998ac238fd14f63997e51a1be"} as const;
/** Current displayed inquiry information; not authority for live signatures or charges. */
export function trip390ProgramTerms(locale:Locale){
 const copy=(locale==='he'?he:en).programTerms;
 const text=[copy.title,copy.priceLabel,copy.freeRegistration,...copy.sections.map(s=>s.title+'\n'+s.body),copy.rightsQualifier,copy.serviceContact,copy.acceptance].join('\n\n');
 return {...copy,version:TRIP390_PROGRAM_TERMS_VERSION,language:locale,text,textDigest:digests[locale]};
}
