import website from './academy-exact-website-copy.json';
import states from './academy-exact-state-copy.json';
import curriculum from './academy-exact-curriculum.json';
import emails from './academy-exact-email-copy.json';
import {academyCoastalCopy} from './academy-coastal-copy.ts';

/** Derived public projections of one exact editorial packet. Prices and effects
 * retain their existing Product/runtime authority; this binding grants neither. */
export const academyExactContentBinding = {
  version: 'JLFA-EXACT-COPY-20261026-05',
  sourceSha256: '771152d0aef0550bd369ea132b472e5bfcc1d44514ebb7815c1e47a7abd41466',
  reviewState: 'NEW_EDITORIAL_COPY_NOT_LEGAL_OR_TRANSLATION_APPROVAL',
} as const;
export const academyExactCopy = {
 en:{...website.en,home:{...website.en.home,...academyCoastalCopy.en},pricing:{...website.en.pricing,monthlyTemplate:'Four-session block — {price} for 4 sessions'},form:{...website.en.form,intro:academyCoastalCopy.en.formIntro,offerA:{...website.en.form.offerA,monthly:'Four-session block: {price} for 4 sessions.'},offerB:{...website.en.form.offerB,monthly:'Four-session block: {price} for 4 sessions.'}}},
 he:{...website.he,home:{...website.he.home,...academyCoastalCopy.he},pricing:{...website.he.pricing,monthlyTemplate:'מקבץ של ארבעה מפגשים — {price} עבור 4 מפגשים'},form:{...website.he.form,intro:academyCoastalCopy.he.formIntro,offerA:{...website.he.form.offerA,monthly:'מקבץ של ארבעה מפגשים: {price} עבור 4 מפגשים.'},offerB:{...website.he.form.offerB,monthly:'מקבץ של ארבעה מפגשים: {price} עבור 4 מפגשים.'}}},
};
export const academyExactStates = states;
export const academyExactCurriculum = curriculum;
export const academyExactEmails = emails;
