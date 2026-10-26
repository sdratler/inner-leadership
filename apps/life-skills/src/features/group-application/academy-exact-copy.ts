import website from './academy-exact-website-copy.json';
import states from './academy-exact-state-copy.json';
import curriculum from './academy-exact-curriculum.json';
import emails from './academy-exact-email-copy.json';

/** Derived public projections of one exact editorial packet. Prices and effects
 * retain their existing Product/runtime authority; this binding grants neither. */
export const academyExactContentBinding = {
  version: 'JLFA-EXACT-COPY-20261026-05',
  sourceSha256: '771152d0aef0550bd369ea132b472e5bfcc1d44514ebb7815c1e47a7abd41466',
  reviewState: 'NEW_EDITORIAL_COPY_NOT_LEGAL_OR_TRANSLATION_APPROVAL',
} as const;
export const academyExactCopy = website;
export const academyExactStates = states;
export const academyExactCurriculum = curriculum;
export const academyExactEmails = emails;
