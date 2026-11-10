'use client';
import {useEffect,useId,useRef,useSyncExternalStore} from 'react';
import {Button,Input,Textarea} from '../../ui/workspace/controls.tsx';
import {money,unallocatedAmount} from './model.ts';
import {ServiceOwnerPanelStateV4,type ServiceOwnerPanelSnapshotV4} from './service-owner-panel-state-v4.ts';
import styles from './panel.module.css';
type Locale='en'|'he';
const text=(locale:Locale,en:string,he:string)=>locale==='he'?he:en;
const when=(at:string,locale:Locale)=>new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{timeZone:'America/New_York',dateStyle:'medium',timeStyle:'short'}).format(new Date(at));
const balanceLabels={no_debt:['No payment obligation','אין חובת תשלום'],unpaid:['Unpaid','טרם שולם'],partial:['Partially paid','שולם חלקית'],paid:['Paid','שולם'],overpaid:['Excess payment · review required','תשלום עודף · נדרשת בדיקה'],review_required:['Review required','נדרשת בדיקה']} as const;
const receiptLabels={cash:['Cash received','מזומן שהתקבל'],cash_reversal:['Cash correction','תיקון מזומן'],card:['Card receipt','קבלה לתשלום בכרטיס'],refund:['Refund','החזר'],dispute:['Dispute','מחלוקת על תשלום']} as const;
const reminderLabels={queued:['Queued · not sent','בתור · לא נשלחה'],unknown:['Delivery unknown · reconcile','מצב מסירה לא ידוע · נדרשת בדיקה'],provider_accepted:['Accepted by provider · delivery unverified','התקבלה אצל הספק · המסירה טרם אומתה'],delivered:['Delivered','נמסרה'],suppressed:['Suppressed','השליחה נחסמה'],failed:['Failed','נכשלה']} as const;
const label=(pair:readonly[string,string],locale:Locale)=>pair[locale==='he'?1:0];

/** Explicit V4 presentation only. Root supplies the retained state and genuine
 * owner source/capabilities. No transport, IDs, provider or runtime is created. */
export function ServiceOwnerBillingPanelV4({locale,store}:{locale:Locale;store:ServiceOwnerPanelStateV4}){
 const snapshot=useSyncExternalStore(store.subscribe,store.getSnapshot,store.getServerSnapshot),id=useId(),t=(en:string,he:string)=>text(locale,en,he);
 const data=snapshot.data,subject=snapshot.subject;
 const cashAvailable=Boolean(data&&snapshot.capabilities.cash&&data.quote.state==='accepted'&&!data.balance.cancelled&&!data.balance.pendingAttemptIds.length);
 return <section className={styles.panel} lang={locale} dir={locale==='he'?'rtl':'ltr'} aria-labelledby={`${id}-title`} data-fishing-service-billing-v4="true">
  <header className={styles.heading}><div><p className={styles.eyebrow}>{t('Fishing Academy','אקדמיית הדיג')}</p><h1 id={`${id}-title`}>{t('Family billing','תשלומי המשפחה')}</h1>
   {subject&&<p className={styles.family}><bdi>{subject.label}</bdi></p>}</div></header>
  <OperationStatus locale={locale} store={store} snapshot={snapshot}/>
  {snapshot.state==='unavailable'||snapshot.state==='inactive'?<p role="status" className={styles.notice}>{t('Billing details are unavailable. Reload current account details before continuing.','פרטי התשלום אינם זמינים. יש לטעון מחדש את פרטי החשבון העדכניים לפני ההמשך.')}</p>:null}
  {snapshot.canReload&&<Button variant="secondary" onClick={()=>void store.reload()}>{t('Reload current details','טעינה מחדש של הפרטים העדכניים')}</Button>}
  {data&&subject&&<>
   <p role="status">{label(balanceLabels[data.balance.state],locale)}{data.quote.paused?` · ${t('Billing paused','החיוב מושהה')}`:''}{data.quote.state==='cancelled'?` · ${t('Cancelled','בוטל')}`:''}</p>
   <div className={styles.summary}>{[['Remaining balance','יתרה לתשלום',data.balance.remainingMinor],['Paid','שולם',data.balance.paidMinor],['Payment obligation','חובת תשלום',data.balance.dueMinor]].map(([en,he,value],i)=><div className={i===0?styles.primaryStat:undefined} key={en}><span>{t(String(en),String(he))}</span><strong className={styles.money}>{money(Number(value),locale)}</strong></div>)}</div>
   <section className={styles.card}><div className={styles.sectionHeading}><div><h2>{t('Children and their periods','הילדים ותקופות השירות שלהם')}</h2><p>{t('Each period is shown as stored. Payment does not change its start date.','כל תקופה מוצגת כפי שנשמרה. תשלום אינו משנה את תאריך תחילתה.')}</p></div>
    {cashAvailable&&<Button onClick={()=>store.openCash()}>{t('Record cash received','רישום מזומן שהתקבל')}</Button>}</div>
    <div className={styles.lines}>{data.balance.lines.map(line=><article key={line.lineId} className={styles.line}>
     <div><h3><bdi>{subject.children.find(c=>c.id===line.childId)!.name}</bdi></h3><p><time dateTime={line.period.startsAt}>{when(line.period.startsAt,locale)}</time> – <time dateTime={line.period.endsAt}>{when(line.period.endsAt,locale)}</time></p><small>{t('Florida time','שעון פלורידה')}</small>
      <details className={styles.references}><summary>{t('Period reference','מזהה התקופה')}</summary><bdi>{line.period.id}</bdi></details></div>
     <dl>{[[t('Due','לתשלום'),line.dueMinor],[t('Paid','שולם'),line.paidMinor],[t('Remaining','נותר'),line.remainingMinor]].map(([name,value])=><div key={name}><dt>{name}</dt><dd className={styles.money}>{money(Number(value),locale)}</dd></div>)}</dl>
     <div>{line.dueAt?<p className={styles.due}>{t('Payment date','מועד תשלום')}: <time dateTime={line.dueAt}>{when(line.dueAt,locale)}</time></p>:<p>{t('Payment date not provided','לא נמסר מועד תשלום')}</p>}</div>
    </article>)}</div>
    {data.balance.unallocatedMinor>0&&<p>{t('Unallocated money','כסף שלא הוקצה')}: <bdi className={styles.money}>{money(data.balance.unallocatedMinor,locale)}</bdi></p>}
   </section>
   <div className={styles.lower}><section className={styles.card}><h2>{t('Available actions','פעולות זמינות')}</h2>
    {!cashAvailable&&<p>{t('Cash recording is unavailable for this offer.','רישום מזומן אינו זמין להצעה הזאת.')}</p>}
    {!snapshot.capabilities.reversal&&<p>{t('Cash correction is unavailable.','תיקון רישום מזומן אינו זמין.')}</p>}
    {snapshot.capabilities.state&&data.quote.state!=='cancelled'?<div className={styles.actions}><Button variant="secondary" onClick={()=>store.openState(data.quote.paused?'resume':'pause')}>{data.quote.paused?t('Resume billing','חידוש החיוב'):t('Pause billing','השהיית החיוב')}</Button><Button variant="secondary" onClick={()=>store.openState('cancel')}>{t('Cancel future billing','ביטול חיובים עתידיים')}</Button></div>:<p>{t('Billing-state changes are unavailable.','שינוי מצב החיוב אינו זמין.')}</p>}
    <p>{t('Card payments, provider refunds and sending messages are not available here.','תשלומים בכרטיס, החזרים באמצעות ספק ושליחת הודעות אינם זמינים כאן.')}</p>
    {data.balance.pendingAttemptIds.length>0&&<p role="status">{t('A payment attempt still needs reconciliation. Do not start another payment.','ניסיון תשלום עדיין מחייב בדיקת מצב. אין להתחיל תשלום נוסף.')}</p>}
    <ul className={styles.statusList}>{data.balance.reminders.map(r=><li key={r.id}>{label(reminderLabels[r.state],locale)}<small><bdi>{r.id}</bdi></small></li>)}</ul>
   </section><section className={styles.card}><h2>{t('Recorded history','היסטוריית רישומים')}</h2>
    {!data.balance.receipts.length?<p>{t('No receipts recorded.','לא נרשמו קבלות.')}</p>:<ol className={styles.history}>{data.balance.receipts.map(receipt=>{
     const remaining=receipt.amountMinor-data.balance.receipts.filter(r=>r.originalReceiptId===receipt.id).reduce((sum,r)=>sum+r.amountMinor,0);
     const unallocated=unallocatedAmount(receipt.amountMinor,receipt.allocations);
     return <li key={receipt.id}><div className={styles.receiptHeading}><strong>{label(receiptLabels[receipt.kind],locale)}</strong><bdi className={styles.money}>{money(receipt.amountMinor,locale)}</bdi></div>
      {'receivedDate' in receipt?<p><time dateTime={receipt.receivedDate}>{receipt.receivedDate}</time> · {t('Florida date · receipt time not recorded','תאריך בפלורידה · שעת הקבלה לא נרשמה')}</p>:<p><time dateTime={receipt.receivedAt}>{when(receipt.receivedAt,locale)}</time></p>}
      <small>{t('Recorded','נרשם')}: <time dateTime={receipt.recordedAt}>{when(receipt.recordedAt,locale)}</time></small>
      {receipt.allocations.map(a=><p key={a.lineId}><bdi>{subject.children.find(c=>c.id===data.quote.lines.find(l=>l.id===a.lineId)!.childId)!.name}</bdi> · <bdi className={styles.money}>{money(a.amountMinor,locale)}</bdi></p>)}
      {unallocated>0&&<p>{t('Unallocated amount','סכום שלא הוקצה')}: <bdi className={styles.money}>{money(unallocated,locale)}</bdi></p>}
      <small>{t('Receipt','קבלה')}: <bdi>{receipt.id}</bdi></small>{receipt.originalReceiptId&&<small>{t('Original receipt','הקבלה המקורית')}: <bdi>{receipt.originalReceiptId}</bdi></small>}{receipt.reason&&<p><bdi>{receipt.reason}</bdi></p>}
      {receipt.kind==='cash'&&remaining>0&&snapshot.capabilities.reversal&&<Button variant="quiet" onClick={()=>store.openReversal(receipt.id)}>{t('Correct cash entry','תיקון רישום מזומן')}</Button>}
     </li>;
    })}</ol>}
   </section></div>
   <AcceptanceProvenance locale={locale} snapshot={snapshot}/>
  </>}
  {snapshot.formOpen&&snapshot.draft&&snapshot.data&&<EntryDialog locale={locale} store={store} snapshot={snapshot}/>}
 </section>;
}
function OperationStatus({locale,store,snapshot}:{locale:Locale;store:ServiceOwnerPanelStateV4;snapshot:ServiceOwnerPanelSnapshotV4}){
 const flow=snapshot.flow,t=(en:string,he:string)=>text(locale,en,he);if(flow.phase==='idle'||flow.phase==='inactive')return null;
 return <aside className={styles.operation} role="status" aria-live="polite"><h2>{flow.phase==='confirmed'?t('Original operation confirmed','הפעולה המקורית אושרה'):flow.phase==='unknown'?t('Operation result unknown','תוצאת הפעולה אינה ידועה'):flow.phase==='recovering'?t('Checking the same operation','בדיקת אותה פעולה'):flow.phase==='submitting'?t('Recording…','הרישום מתבצע…'):flow.phase==='not_sent'?t('This attempt was not sent','הניסיון הזה לא נשלח'):t('This attempt was rejected','הניסיון הזה נדחה')}</h2>
  <p>{flow.phase==='unknown'||flow.phase==='recovering'?t('Do not record it again. Only confirmation of the original operation resolves this result.','אין לרשום שוב. רק אישור של הפעולה המקורית פותר את התוצאה הזאת.'):flow.phase==='confirmed'?t('The original receipt is separate from the current balance.','הקבלה המקורית נפרדת מהיתרה העדכנית.'):flow.phase==='submitting'?t('No payment result is assumed.','לא נקבעת תוצאת תשלום משוערת.'):t('Reload current details before reviewing a new entry. This result describes this attempt only.','יש לטעון מחדש פרטים עדכניים לפני בדיקת רישום חדש. התוצאה הזאת מתארת את הניסיון הזה בלבד.')}</p>
  {'pending' in flow&&<small>{t('Operation','פעולה')}: <bdi>{flow.pending.operation.command.operationId}</bdi></small>}
  {flow.phase==='unknown'&&flow.lastRecovery==='rejected_current_attempt'&&<p>{t('The status check was rejected. The original operation remains unresolved.','בדיקת המצב נדחתה. הפעולה המקורית עדיין לא הוכרעה.')}</p>}
  {flow.phase==='unknown'&&flow.lastRecovery==='unresolved'&&<p>{t('No original result was found. This does not prove that nothing happened.','לא נמצאה תוצאה מקורית. אין בכך הוכחה שלא בוצעה פעולה.')}</p>}
  {flow.phase==='unknown'&&(snapshot.canRecover?<Button variant="secondary" onClick={()=>void store.recover()}>{t('Check operation status','בדיקת מצב הפעולה')}</Button>:<p>{t('Status checking is unavailable.','בדיקת מצב הפעולה אינה זמינה.')}</p>)}
  {flow.phase==='confirmed'&&<details className={styles.references}><summary>{t('Original operation references','מזהי הפעולה המקורית')}</summary><dl>
   <div><dt>{t('Recorded','נרשם')}</dt><dd><time dateTime={flow.data.receipt.recordedAt}>{when(flow.data.receipt.recordedAt,locale)}</time></dd></div>
   <div><dt>{t('Original record revision','גרסת הרישום המקורית')}</dt><dd>{'entityVersion' in flow.data.receipt?flow.data.receipt.entityVersion:flow.data.receipt.after.revision}</dd></div>
   {snapshot.data&&<div><dt>{t('Current record revision','גרסת הרישום העדכנית')}</dt><dd>{snapshot.data.quote.revision}</dd></div>}
  </dl></details>}
 </aside>;
}
function AcceptanceProvenance({locale,snapshot}:{locale:Locale;snapshot:ServiceOwnerPanelSnapshotV4}){
 const data=snapshot.data;if(!data)return null;const a=data.quote.acceptance,t=(en:string,he:string)=>text(locale,en,he);
 return <section className={styles.card}><h2>{t('Original acceptance','האישור המקורי')}</h2>{!a?<p>{t('No financial acceptance recorded.','לא נרשם אישור פיננסי.')}</p>:<>
  <p>{t('Name as submitted','השם כפי שנמסר')}: <bdi>{a.parent.submittedName}</bdi></p><p><time dateTime={a.acceptedAt}>{when(a.acceptedAt,locale)}</time></p>
  <p>{t('Accepted documents language','שפת המסמכים שאושרו')}: {a.displayed.locale==='he'?'עברית':'English'}</p>
  <p>{t('Communication language at issue','שפת ההודעות בעת ההנפקה')}: {data.quote.messageLocaleAtIssue==='he'?'עברית':'English'}</p>
  <p>{t('Recorded payment choice','בחירת התשלום שנרשמה')}: {a.recurring.kind==='one_time_only'?t('One-time only','חד־פעמי בלבד'):t('Separate recurring authorization recorded','נרשמה הרשאה נפרדת לחיוב מתמשך')}</p>
  <p>{t('This historical record does not enable new payment or sending actions.','הרישום ההיסטורי הזה אינו מאפשר פעולות תשלום או שליחה חדשות.')}</p>
  <details className={styles.references}><summary>{t('Original document and operation references','מזהי המסמכים והפעולה המקוריים')}</summary><dl>
   {[[t('Acceptance','אישור'),a.id],[t('Acceptance version','גרסת האישור'),a.version],[t('Acceptance operation','פעולת האישור'),a.operationId],[t('Accepted action','הפעולה שאושרה'),a.action],
    [t('Original guest grant','מזהה הקישור הפרטי המקורי'),a.grantId],[t('Recorded assurance reference','מזהה בדיקת הסמכות שנרשמה'),a.assuranceEvidenceId],
    [t('Accepted offer','ההצעה שאושרה'),a.offer.sha256],[t('Issued offer revision','גרסת ההצעה שהונפקה'),String(a.offer.material.financial.issuedRevision)],
    [t('Current record revision','גרסת הרישום העדכנית'),String(data.quote.revision)],[t('Document bundle','חבילת המסמכים'),a.displayed.id],[t('Bundle fingerprint','טביעת חבילת המסמכים'),a.displayed.sha256],
    [t('Terms reference','מזהה התנאים'),a.displayed.financialTerms.source.id],[t('Terms source fingerprint','טביעת מקור התנאים'),a.displayed.financialTerms.source.sha256],
    [t('Terms release reference','מזהה גרסת התנאים המאושרת'),a.displayed.financialTerms.releaseEvidenceId],[t('Displayed terms fingerprint','טביעת התנאים שהוצגו'),a.displayed.financialTerms.displayedTextSha256],
    [t('Service schedule fingerprint','טביעת תכנית השירות'),a.displayed.serviceSnapshotSha256],[t('Evidence reference','מזהה הראיה'),a.parent.privateEvidenceId]].map(([name,value])=><div key={name}><dt>{name}</dt><dd><bdi>{value}</bdi></dd></div>)}
  </dl>{a.recurring.kind==='separate_affirmative_card_authorization'&&<><p>{t('Original recurring statement fingerprint','טביעת הצהרת ההרשאה המקורית לחיוב מתמשך')}: <bdi>{a.recurring.statementSha256}</bdi></p>
   <p>{t('Recurring evidence reference','מזהה הראיה להרשאת החיוב המתמשך')}: <bdi>{a.recurringPrivateEvidenceId}</bdi></p>
   <ul className={styles.statusList}>{a.recurring.lines.map(line=><li key={line.lineId}><bdi>{line.childId}</bdi><bdi className={styles.money}>{money(line.amountMinor,locale)}</bdi><time dateTime={line.firstPeriodStartsAt}>{when(line.firstPeriodStartsAt,locale)}</time><time dateTime={line.nextRenewalAt}>{when(line.nextRenewalAt,locale)}</time></li>)}</ul></>}
  </details>
 </>}</section>;
}
function EntryDialog({locale,store,snapshot}:{locale:Locale;store:ServiceOwnerPanelStateV4;snapshot:ServiceOwnerPanelSnapshotV4}){
 const ref=useRef<HTMLDialogElement>(null),id=useId(),draft=snapshot.draft!,data=snapshot.data!,t=(en:string,he:string)=>text(locale,en,he);
 useEffect(()=>{const node=ref.current;if(node&&!node.open)node.showModal();return()=>{if(node?.open)node.close();};},[]);
 const review=draft.review,op=review?.operation,done=snapshot.flow.phase==='confirmed';
 return <dialog ref={ref} className={styles.dialog} aria-labelledby={`${id}-title`} onCancel={event=>{event.preventDefault();store.closeForm();}}>
  <header className={styles.dialogHeader}><h2 id={`${id}-title`}>{draft.kind==='cash'?t('Record cash received','רישום מזומן שהתקבל'):draft.kind==='reversal'?t('Correct cash entry','תיקון רישום מזומן'):t('Review billing state','בדיקת מצב החיוב')}</h2><Button variant="quiet" onClick={()=>store.closeForm()} aria-label={t('Close dialog','סגירת החלון')}>×</Button></header>
  <div className={styles.dialogBody}>{done?<><p role="status">{t('Original operation confirmed; current details refreshed.','הפעולה המקורית אושרה; הפרטים העדכניים רועננו.')}</p><Button onClick={()=>store.closeForm()}>{t('Done','סיום')}</Button></>:review&&op?<>
   {op.action==='state'?<><p>{op.command.cancel?t('Cancel future billing. Existing entries and original acceptance remain.','ביטול חיובים עתידיים. הרישומים הקיימים והאישור המקורי נשמרים.'):op.command.paused?t('Pause billing. Existing entries remain.','השהיית החיוב. הרישומים הקיימים נשמרים.'):t('Resume billing under the existing recorded terms.','חידוש החיוב לפי התנאים שנרשמו.')}</p><p>{t('This changes the recorded billing state. External subscription updates are unavailable here.','פעולה זו משנה את מצב החיוב הרשום. עדכון מנויים אצל ספק חיצוני אינו זמין כאן.')}</p></>:<>
    <strong className={`${styles.confirmAmount} ${styles.money}`}>{money(op.command.amountMinor,locale)}</strong>
    <dl className={styles.confirmFacts}>{op.command.allocations.map(a=><div key={a.lineId}><dt><bdi>{snapshot.subject!.children.find(c=>c.id===data.quote.lines.find(l=>l.id===a.lineId)!.childId)!.name}</bdi></dt><dd className={styles.money}>{money(a.amountMinor,locale)}</dd></div>)}</dl>
    <p>{t('Unallocated amount','סכום שלא הוקצה')}: <bdi className={styles.money}>{money(unallocatedAmount(op.command.amountMinor,op.command.allocations),locale)}</bdi></p>
    {op.action==='cash_date'?<p>{t('Actual received date · Florida · no time inferred','תאריך קבלה בפועל · פלורידה · ללא קביעת שעה משוערת')}: <time dateTime={op.command.receivedDate}>{op.command.receivedDate}</time></p>:<><p><bdi>{op.command.reason}</bdi></p><p>{t('This corrects the cash record; it does not send a refund. The original is retained.','פעולה זו מתקנת את רישום המזומן; היא אינה מבצעת החזר. הרישום המקורי נשמר.')}</p></>}
   </>}
   <div className={styles.actions}><Button onClick={()=>void store.confirm()}>{t('Confirm entry','אישור הרישום')}</Button><Button variant="secondary" onClick={()=>store.backToEdit()}>{t('Back to edit','חזרה לעריכה')}</Button></div>
  </>:<form onSubmit={event=>{event.preventDefault();if(event.currentTarget.reportValidity())store.review();}}>
   {draft.error&&<p role="alert" className={styles.error}>{draft.error==='changed'?t('The current details changed. Review the entry again.','הפרטים העדכניים השתנו. יש לבדוק את הרישום שוב.'):t('Check the entered details before continuing.','יש לבדוק את הפרטים שהוזנו לפני ההמשך.')}</p>}
   {draft.kind==='state'?<p>{draft.action==='cancel'?t('Review cancellation of future billing.','בדיקת ביטול חיובים עתידיים.'):draft.action==='pause'?t('Review pausing billing.','בדיקת השהיית החיוב.'):t('Review resuming billing.','בדיקת חידוש החיוב.')}</p>:<>
    <Input id={`${id}-amount`} label={draft.kind==='cash'?t('Amount received (USD)','סכום שהתקבל (דולר)'):t('Amount to correct (USD)','סכום לתיקון (דולר)')} inputMode="decimal" dir="ltr" required value={draft.amount} onChange={event=>store.updateDraft({amount:event.target.value})}/>
    {draft.kind==='cash'&&<Input id={`${id}-date`} label={t('Actual received date · Florida','תאריך קבלה בפועל · פלורידה')} type="date" required value={draft.date} onChange={event=>store.updateDraft({date:event.target.value})}/>}
    <fieldset className={styles.allocationFields}><legend>{t('Allocate to children and periods','חלוקה לילדים ולתקופות')}</legend>{Object.keys(draft.allocations).map((lineId,i)=>{const line=data.quote.lines.find(l=>l.id===lineId)!;return <Input key={lineId} id={`${id}-allocation-${i}`} label={`${snapshot.subject!.children.find(c=>c.id===line.childId)!.name} · ${when(line.period.startsAt,locale)}`} inputMode="decimal" dir="ltr" value={draft.allocations[lineId]??''} onChange={event=>store.updateDraft({allocations:{...draft.allocations,[lineId]:event.target.value}})}/>;})}<p className={styles.help}>{t('Any unallocated money stays separate from each child’s balance.','כסף שלא הוקצה נשאר בנפרד מיתרתו של כל ילד.')}</p></fieldset>
    {draft.kind==='reversal'&&<Textarea id={`${id}-reason`} label={t('Correction reason','סיבת התיקון')} required rows={3} maxLength={500} value={draft.reason} onChange={event=>store.updateDraft({reason:event.target.value})}/>}
   </>}
   <div className={styles.actions}><Button type="submit">{t('Review entry','בדיקת הרישום')}</Button><Button variant="secondary" onClick={()=>store.closeForm()}>{t('Close','סגירה')}</Button></div>
  </form>}</div>
 </dialog>;
}
