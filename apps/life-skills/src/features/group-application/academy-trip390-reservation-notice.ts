import en from './academy-trip390-en.json' with {type:'json'};
import he from './academy-trip390-he.json' with {type:'json'};
import type {Locale} from '../../lib/locale.ts';

/** Prepared -07 reservation wording; activation requires owning-source adoption.
 * It accepts no financial agreement, participation waiver or child signature. */
export const TRIP390_RESERVATION_NOTICE_VERSION='JLFA-RESERVATION-PRIVACY-20261104-07-v1' as const;
const labels={"en":{"title":"Reservation & privacy","acknowledgment":"I understand that this is a nonbinding reservation request, not a confirmed place or a payment obligation, and acknowledge the Privacy Notice."},"he":{"title":"בקשת מקום ופרטיות","acknowledgment":"אני מבין/ה שזו בקשת מקום שאינה מחייבת, אינה אישור למקום ואינה יוצרת חובת תשלום, ומאשר/ת שקראתי את הודעת הפרטיות."}} as const;
const digests={"en": "3b43a7e5c9bc66e14c794819560595dcc61f49e786101d70680ae153838a5135", "he": "54fa757c3153e41115c504bb9914c27c868bf4cd0bae13282a71899ea440f581"} as const;
export function trip390ReservationNotice(locale:Locale){
 const c=locale==='he'?he:en,label=labels[locale];
 const paragraphs=[c.form.place_not_confirmed,c.programTerms.freeRegistration,c.form.privacy_short,c.form.service_contact];
 const text=[label.title,...paragraphs,label.acknowledgment].join('\n\n');
 return {...label,version:TRIP390_RESERVATION_NOTICE_VERSION,language:locale,paragraphs,text,textDigest:digests[locale]};
}
