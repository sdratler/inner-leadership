import type {Locale} from '../../lib/locale.ts';
import {academyRegistrationNotice,academyRegistrationNoticeHashes} from './academy-registration-notice.ts';

/** Only this released notice is accepted by the free-registration command.
 * Participation bundles have their own admission and per-child signatures. */
export function AcademyProgramTerms({locale}:{locale:Locale}){
 const t=(en:string,he:string)=>locale==='he'?he:en;
 return <details data-academy-program-terms id="academy-program-terms">
  <summary>{t('Program terms & safety','תנאי התוכנית ובטיחות')}</summary>
  <section aria-labelledby="academy-registration-terms-title" data-document-id={academyRegistrationNotice.id} data-document-version={academyRegistrationNotice.version} data-document-language={locale} data-document-sha256={academyRegistrationNoticeHashes[locale]} data-document-status="released_registration_only">
   <h3 id="academy-registration-terms-title">{t('Registration terms and privacy notice','תנאי ההרשמה והודעת הפרטיות')}</h3>
   <p>{academyRegistrationNotice[locale]}</p>
   <p><small>{t('Version','גרסה')}: <bdi>{academyRegistrationNotice.version}</bdi></small></p>
  </section>
 </details>;
}
