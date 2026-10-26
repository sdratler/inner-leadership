import {academyExactCopy} from './academy-exact-copy.ts';
const faq=(id:string)=>({en:academyExactCopy.en.home.faq.find(item=>item.id===id)!.answer,he:academyExactCopy.he.home.faq.find(item=>item.id===id)!.answer});
/** Contextual summaries and full FAQ conditions are distinct exact-packet
 * projections. Neither grants a booked outing or participation clearance. */
export const academyTripCopy={
 keysSummary:{en:academyExactCopy.en.pricing.outings.keysBody,he:academyExactCopy.he.pricing.outings.keysBody},
 keysDetails:faq('keys-trip-faq'),
 offshoreSummary:{en:academyExactCopy.en.pricing.outings.offshoreBody,he:academyExactCopy.he.pricing.outings.offshoreBody},
 offshoreConditions:faq('offshore-trip-faq'),
 firstMeeting:{en:academyExactCopy.en.form.equipmentLine,he:academyExactCopy.he.form.equipmentLine},
 schoolResponsibility:{en:academyExactCopy.en.terms.sections.find(item=>item.id==='policies')!.paragraphs[0]!,he:academyExactCopy.he.terms.sections.find(item=>item.id==='policies')!.paragraphs[0]!},
} as const;
