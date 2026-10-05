import type {ContentVoiceSnapshot} from './source.ts';
import styles from '../../app/[locale]/app/settings/content-voice/source-viewer.module.css';

/** Presentation of one consistent canonical read; never a local guide or writer. */
export function ContentVoiceView({locale,source}:{locale:'en'|'he';source:ContentVoiceSnapshot|null}){
 const he=locale==='he';
 return !source?<section className="lsw-card" role="alert"><h2>{he?'המקור אינו זמין כרגע':'Source unavailable right now'}</h2><p>{he?'אין להניח שכללים שמורים או עדכניים. אפשר לנסות שוב בלי לשנות את המקור.':'Do not assume the writing rules are saved or current. Retry without changing the source.'}</p><a className="lsw-button" href={`/${locale}/app/marketing?section=community&communityView=writing_rules`}>{he?'קריאה חוזרת מהמקור':'Reload canonical source'}</a></section>:<>
  <section className="lsw-card lsw-stack" aria-labelledby="voice-source-title">
   <h2 id="voice-source-title"><a href={source.sourceUrl} target="_blank" rel="noopener noreferrer">{source.title}</a></h2>
   <dl className={styles.metadata}>
    <div><dt>{he?'גרסה מוצהרת':'Declared version'}</dt><dd>{source.declaredVersion??(he?'לא צוינה':'Not stated')}</dd></div>
    <div><dt>{he?'גרסת Drive':'Drive revision'}</dt><dd>{source.driveRevision}</dd></div>
    <div><dt>{he?'עדכון אחרון ב־Drive':'Drive last modified'}</dt><dd><time dateTime={source.modifiedAt}>{source.modifiedAt}</time></dd></div>
    <div><dt>{he?'בדיקה אחרונה מהמקור':'Last checked from source'}</dt><dd><time dateTime={source.checkedAt}>{source.checkedAt}</time></dd></div>
    <div><dt>SHA-256</dt><dd className={styles.hash}>{source.sha256}</dd></div>
   </dl>
   <p role="status">{he?'קריאה עדכנית אומתה; זה אינו אישור לשמירת שינוי או לשימוש במחולל תשובות. זמן העדכון של Drive עשוי להשתנות גם בעקבות שינוי הרשאות.':"Fresh source read verified; this does not confirm a correction was saved or used by a reply generator. Drive's modified time can also change after permission updates."}</p>
   <p>{he?'תיקונים נעשים בהזדמנויות הקהילה: בודקים את ההעדפה שהמערכת הבינה, ואז בוחרים תיקון חד־פעמי, תגובות קהילה עתידיות או סגנון כתיבה כללי. שמירה מאומתת רק לאחר קריאה חוזרת של אותו מקור; עריכה מקבילה אינה נדרסת.':'Make corrections in Community opportunities: review the understood preference, then choose This reply only, Future Community replies or Global writing voice. A save is verified only after the same source is read back; concurrent edits are not overwritten.'}</p>
   <p>{he?'כללי פרסום, פרטיות וערוץ נשארים במדריך תגובות הקהילה הנפרד.':'Posting, privacy and channel rules remain governed by the separate Community Response Playbook.'}</p>
   <a className="lsw-button" href={`/${locale}/app/marketing?section=community&communityView=opportunities`}>{he?'פתיחת תגובות הקהילה והתיקונים':'Open Community replies and corrections'}</a>
  </section>
  <section className="lsw-card lsw-stack" aria-labelledby="voice-text-title"><h2 id="voice-text-title">{he?'תוכן המקור הנוכחי':'Current source text'}</h2><pre className={styles.sourceText}>{source.text}</pre></section>
 </>;
}
