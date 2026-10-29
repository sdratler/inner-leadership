import type {Locale} from '../../lib/locale.ts';
import Link from 'next/link';
import {Section,word} from '../../ui/revamp/primitives.tsx';
import {bnaSocialCandidates,previewBnaSocialCandidate} from './social-candidates.ts';
import {bnaEmailCandidates} from './email-candidates.ts';

/** Owner route content only. Native disclosures do not queue, approve or send. */
export function BnaContentReviewLibrary({locale}:{locale:Locale}){
 const t=(en:string,he:string)=>word(locale,en,he);
 return <Section title={t('BNA and Fishing copy for review','נוסחי בני נביאים ואקדמיית הדיג לבדיקה')} privateOnly description={t('Draft content from your consolidated package. Nothing here is approved, scheduled or sent.','נוסחים לבדיקה מהחבילה המאוחדת שלכם. דבר כאן אינו מאושר, מתוזמן או נשלח.')}>
  <p><Link href="/en/app/marketing?section=creatives">English</Link> · <Link href="/he/app/marketing?section=creatives">עברית</Link></p>
  <details className="lsw-details"><summary>{t(`${bnaSocialCandidates.posts.length} social drafts`,`${bnaSocialCandidates.posts.length} נוסחי פוסטים`)}</summary>
   <p>{t('Review the destination, current group rules and actual permitted image before publication. Educational wording may still count as a promotion.','לפני פרסום יש לבדוק את היעד, כללי הקבוצה העדכניים והרשאת השימוש בתמונה. גם תוכן חינוכי עשוי להיחשב פרסומי.')}</p>
   {bnaSocialCandidates.posts.map(post=>{const preview=previewBnaSocialCandidate(post.id,locale);return <details className="lsw-details" key={post.id}><summary>{post.id} · {post.title}</summary>
    <p>{t('Business','תחום')}: {post.business==='placement_required'?t('Choose the appropriate business before use','יש לבחור תחום מתאים לפני השימוש'):post.business} · {t('Draft — not queued','טיוטה — אינה בתור')}</p>
    <p lang={locale} dir={locale==='he'?'rtl':'ltr'} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{preview.body}</p>
    <p>{t('Asset direction, pending permission and review','הנחיית תמונה, בכפוף להרשאה ולבדיקה')}: {post.assetInstruction}</p>
   </details>;})}
  </details>
  <details className="lsw-details"><summary>{t(`${bnaEmailCandidates.messages.length} email drafts`,`${bnaEmailCandidates.messages.length} נוסחי דוא״ל`)}</summary>
   <p>{t('Placeholders below are intentionally unresolved. Recipient, purpose, permission, sender, footer and working preference links must be verified before any delivery. Donor messages require a verified gift.','השדות המשתנים עדיין אינם ממולאים. לפני שליחה יש לאמת נמען, מטרה, הרשאה, שולח, פרטי תחתית וקישורי העדפות פעילים. הודעות לתורמים דורשות תרומה מאומתת.')}</p>
   {bnaEmailCandidates.messages.map(message=><details className="lsw-details" key={message.id}><summary>{message.id} · {message.content[locale].subject}</summary>
    <p>{t('Trigger proposal','הצעת תנאי הפעלה')}: {message.trigger}</p>
    <p lang={locale} dir={locale==='he'?'rtl':'ltr'} style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere'}}>{message.content[locale].body}</p>
   </details>)}
  </details>
 </Section>;
}
