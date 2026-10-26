import type {Locale} from '../../lib/locale.ts';
import {academyRegistrationNotice,academyRegistrationNoticeHashes} from './academy-registration-notice.ts';
import {academyProgramDraftDocuments} from './academy-program-draft-documents.ts';
import {academyTripCopy} from './academy-trip-copy.ts';

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
  <section aria-labelledby="academy-program-policies-title" data-academy-program-policies>
   <h3 id="academy-program-policies-title">{t('Program policies','מדיניות התוכנית')}</h3>
   <p>{academyTripCopy.schoolResponsibility[locale]}</p>
  </section>
  <details data-academy-draft-review aria-labelledby="academy-draft-review-title">
   <summary id="academy-draft-review-title">{t('Draft participation documents — not accepted','טיוטות מסמכי השתתפות — אינן מאושרות בהרשמה')}</summary>
   <p>{t('These drafts are available for review only. Your registration checkbox accepts only the released registration terms and privacy notice above. Reading these drafts does not record agreement, child acknowledgment or payment permission.','טיוטות אלה מוצגות לעיון בלבד. תיבת האישור בהרשמה מתייחסת רק לתנאי ההרשמה ולהודעת הפרטיות שפורסמו לאישור ומופיעים למעלה. קריאת הטיוטות אינה מתעדת הסכמה, אישור של ילד או הרשאה לתשלום.')}</p>
   {academyProgramDraftDocuments.map(document=><details key={document.id} data-document-id={document.id} data-document-version={document.version} data-document-language={locale} data-document-sha256={document.languages[locale].contentSha256} data-document-status={document.status} data-acceptance-eligible="false" lang={locale} dir={locale==='he'?'rtl':'ltr'}>
    <summary>{document.title[locale]}</summary>
    <p><strong>{t('Draft — not released for acceptance','טיוטה — לא פורסמה לאישור')}</strong></p>
    {locale==='he'&&<p data-translation-status="review_not_approved">תרגום לעיון בלבד — לא אושר.</p>}
    <div data-academy-draft-body style={{whiteSpace:'pre-wrap'}}>{document.languages[locale].text}</div>
    <p><small>{t('Document','מסמך')}: <bdi dir="ltr">{document.id}</bdi><br/>{t('Version','גרסה')}: <bdi dir="ltr">{document.version}</bdi><br/>SHA-256: <bdi dir="ltr" style={{overflowWrap:'anywhere'}}>{document.languages[locale].contentSha256}</bdi></small></p>
   </details>)}
  </details>
 </details>;
}
