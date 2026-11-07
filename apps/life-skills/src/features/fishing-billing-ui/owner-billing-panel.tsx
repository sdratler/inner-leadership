'use client';
import {useEffect,useId,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import type {FormEvent} from 'react';
import {Button,Input,Textarea} from '../../ui/workspace/controls.tsx';
import {ledgerReceiptSchema,type LedgerReceipt,type BillingBalance} from '../fishing-billing/contracts.ts';
import {BillingWorkflow,type BillingWorkflowState} from './workflow.ts';
import {commandFor,decodeData,floridaDate,inputUsd,money,parseUsd,resolvedReceivedDate,sameScope,dataScope,validateSubject,preparationTicket,samePreparation,unallocatedAmount,type PreparationTicket,type BillingCommand,type BillingData,type BillingSubject,type BillingView,type CommandKind} from './model.ts';
import styles from './panel.module.css';

type Modal={ticket:PreparationTicket;kind:CommandKind;lineIds:string[];receipt:LedgerReceipt|null;amount:string;allocations:Record<string,string>;date:string;reason:string;error:string;review:BillingCommand|null;preparing:boolean};
export type OwnerBillingPanelProps={locale:'en'|'he';view:BillingView;subject:BillingSubject;workflow:BillingWorkflow;observedAt?:string;cashAllowed?:boolean;reversalAllowed?:boolean};
const status:Record<BillingBalance['state'],readonly[string,string]>={no_debt:['No payment obligation','אין חובת תשלום'],unpaid:['Unpaid','טרם שולם'],partial:['Partially paid','שולם חלקית'],paid:['Paid','שולם'],overpaid:['Excess payment · review required','תשלום עודף · נדרשת בדיקה'],review_required:['Review required','נדרשת בדיקה']};
const policy:Record<string,readonly[string,string]>={service_period:['Service period','תקופת השירות'],proration:['Partial-period policy','מדיניות לתקופה חלקית'],renewal:['Renewal policy','מדיניות חידוש'],cancellation:['Cancellation policy','מדיניות ביטול'],weather:['Weather policy','מדיניות מזג אוויר'],payment_due:['Approved payment date','מועד תשלום מאושר']};
const reminder:Record<string,readonly[string,string]>={queued:['Queued · not sent','בתור · לא נשלחה'],unknown:['Delivery unknown · reconcile','מצב מסירה לא ידוע · נדרשת בדיקה'],provider_accepted:['Accepted by provider · delivery unverified','התקבלה אצל הספק · המסירה טרם אומתה'],delivered:['Delivered','נמסרה'],suppressed:['Suppressed','השליחה נחסמה'],failed:['Failed','נכשלה']};
function historyFor(data:BillingData):readonly LedgerReceipt[]|null{
 try{return data.balance.receipts.map(raw=>{
  const r=ledgerReceiptSchema.parse(raw);
  if(r.quoteId!==data.quote.id||r.familyId!==data.quote.familyId||r.allocations.some(a=>!data.quote.lines.some(l=>l.id===a.lineId)))throw Error('HISTORY_SCOPE');
  return r;
 });}catch{return null;}
}
function dateText(value:string,locale:'en'|'he',withTime=false){
 return new Intl.DateTimeFormat(locale==='he'?'he-IL':'en-US',{timeZone:'America/New_York',dateStyle:'medium',...(withTime?{timeStyle:'short' as const}:{})}).format(new Date(value));
}
const zero=(v:string)=>/^0(?:\.0{1,2})?$/.test(v.trim());

/** Unmounted owner presentation. Parent supplies authorized data, labels and a
 * retained workflow instance; absent ports/capabilities keep money actions off. */
export function OwnerBillingPanel({locale,view,subject,workflow,observedAt,cashAllowed=false,reversalAllowed=false}:OwnerBillingPanelProps){
 const t=(en:string,he:string)=>locale==='he'?he:en;
 const id=useId(),flow=useSyncExternalStore(workflow.subscribe,workflow.getSnapshot,workflow.getServerSnapshot);
 const [modal,setModal]=useState<Modal|null>(null);
 let data:BillingData|null=null,invalid=false;
 try{if(view.state==='ready'||view.state==='conflict'){
  data=workflow.currentFor(decodeData(view.state==='ready'?view.data:view.current));
  if(!validateSubject(subject,data)){data=null;invalid=true;}
 }}catch{invalid=true;}
 const active=data,scopeMatches=active&&('scope' in flow)?sameScope(dataScope(active),flow.scope):false;
 const contextKey=active?`${active.quote.workspaceId}|${active.quote.familyId}|${active.quote.id}|${active.balance.revision}`:'unavailable';
 const preparationContext=useMemo(()=>({key:contextKey}),[contextKey]);
 const uncertain=workflow.unresolved();
 const hiddenAmounts=Boolean(scopeMatches&&uncertain);
 const historyEntries=active&&!hiddenAmounts?historyFor(active):null;
 const canCash=Boolean(active&&cashAllowed&&workflow.ports&&!uncertain&&active.quote.state==='accepted'&&!active.balance.cancelled&&active.balance.remainingMinor>0&&!active.balance.excessMinor&&!active.balance.missingPolicy.length);
 const childName=(childId:string)=>subject.children.find(c=>c.id===childId)?.name??t('Child details unavailable','פרטי הילד אינם זמינים');
 const cashAvailable=(receipt:LedgerReceipt)=>Math.max(0,receipt.amountMinor-(historyEntries??[]).filter(r=>r.originalReceiptId===receipt.id).reduce((s,r)=>s+r.amountMinor,0));
 const start=(kind:CommandKind,lineIds:string[],receipt:LedgerReceipt|null=null)=>{
  if(!active||uncertain)return;
  if(flow.phase!=='idle')workflow.clear();
  const allocations:Record<string,string>={};
  for(const lineId of lineIds){
   const original=receipt?.allocations.find(a=>a.lineId===lineId)?.amountMinor;
   const reversed=(historyEntries??[]).filter(r=>r.originalReceiptId===receipt?.id).reduce((s,r)=>s+(r.allocations.find(a=>a.lineId===lineId)?.amountMinor??0),0);
   allocations[lineId]=inputUsd(receipt?Math.max(0,(original??0)-reversed):active.balance.lines.find(l=>l.lineId===lineId)!.remainingMinor);
  }
  const amount=receipt?cashAvailable(receipt):Object.values(allocations).reduce((s,v)=>s+(parseUsd(v)??0),0);
  let date='';try{if(observedAt)date=floridaDate(observedAt);}catch{/* No workstation-clock fallback. */}
  setModal({ticket:preparationTicket(dataScope(active),active.balance.revision,preparationContext),kind,lineIds,receipt,allocations,amount:inputUsd(amount),date,reason:'',error:'',review:null,preparing:false});
 };
 const update=(patch:Partial<Modal>)=>setModal(m=>m?{...m,...patch,error:''}:null);
 async function review(event:FormEvent){
  event.preventDefault();if(!modal||!active||!workflow.ports||modal.preparing||modal.ticket.context!==preparationContext||modal.ticket.revision!==active.balance.revision||!sameScope(modal.ticket.scope,dataScope(active)))return;
  const draft=modal,current=active,amount=parseUsd(draft.amount);
  const allocations=draft.lineIds.map(lineId=>({lineId,amountMinor:zero(draft.allocations[lineId]??'')?0:parseUsd(draft.allocations[lineId]??'')}));
  if(amount===null||allocations.some(a=>a.amountMinor===null)||allocations.reduce((s,a)=>s+(a.amountMinor??0),0)>amount||draft.kind==='cash'&&!allocations.some(a=>(a.amountMinor??0)>0)){update({error:t('Enter a positive USD amount. Allocations cannot exceed it; cash recording requires at least one allocation.','יש להזין סכום חיובי בדולר. סכום החלוקה אינו יכול לעלות עליו; רישום מזומן דורש הקצאה אחת לפחות.')});return;}
  if(draft.kind==='reversal'&&!draft.reason.trim()){update({error:t('Enter the reason for correcting this cash entry.','יש להזין סיבה לתיקון רישום המזומן.')});return;}
  update({preparing:true});
  try{
   const common={operationId:workflow.ports.nextOperationId(),expectedVersion:current.balance.revision,quoteId:current.quote.id,amountMinor:amount,allocations:allocations.filter(a=>a.amountMinor!>0).map(a=>({lineId:a.lineId,amountMinor:a.amountMinor!}))};
   let command:BillingCommand;
   if(draft.kind==='cash'){
    const received=await workflow.ports.resolveReceivedDate(draft.date);
    if(!received)throw Error('DATE_NOT_READY');
    command=commandFor('cash',{...common,currency:'USD',receivedAt:resolvedReceivedDate(draft.date,received)});
   }else command=commandFor('reversal',{...common,originalReceiptId:draft.receipt!.id,reason:draft.reason.trim()});
   if(workflow.currentFor(current).balance.revision!==draft.ticket.revision)throw Error('STALE_PREPARATION');
   setModal(m=>m&&samePreparation(m.ticket,draft.ticket)?{...m,review:command,preparing:false,error:''}:m);
  }catch{setModal(m=>m&&samePreparation(m.ticket,draft.ticket)?{...m,preparing:false,error:t('This entry could not be prepared. Check the amount, allocation and received-date capability; nothing has been submitted.','לא ניתן להכין את הרישום. יש לבדוק את הסכום, החלוקה ואפשרות תאריך הקבלה; דבר לא נשלח.')}:m);}
 }
 const visibleModal=modal&&active&&sameScope(modal.ticket.scope,dataScope(active))&&(modal.ticket.context===preparationContext||flow.phase==='confirmed'&&modal.review?.operationId===flow.command.operationId)?modal:null;
 const currentData=active;
 return <section className={styles.panel} lang={locale} dir={locale==='he'?'rtl':'ltr'} aria-labelledby={`${id}-title`} data-billing-owner-panel>
  <header className={styles.heading}><div><p className={styles.eyebrow}>{t('Fishing Academy','אקדמיית הדיג')}</p><h1 id={`${id}-title`}>{t('Family billing','תשלומי המשפחה')}</h1>{active&&<p className={styles.family}><bdi>{subject.label}</bdi></p>}</div><span className={styles.test}>{t('Test environment · no live collection','סביבת בדיקה · ללא גבייה בפועל')}</span></header>
  <WorkflowNotice flow={flow} workflow={workflow} locale={locale} showDetails={Boolean(scopeMatches)}/>
  {view.state==='conflict'&&flow.phase==='idle'&&<State title={t('Balance changed · review again','היתרה השתנתה · נדרשת בדיקה נוספת')} body={t('Review the refreshed amounts before making a new entry.','יש לבדוק את הסכומים המרועננים לפני רישום חדש.')}/>}
  {invalid?<State title={t('Billing data unavailable','נתוני התשלום אינם זמינים')} body={t('A complete authorized family snapshot is required. Amounts are not shown.','נדרשת תמונת מצב מלאה ומאושרת של המשפחה. הסכומים אינם מוצגים.')}/>:
   !active?<State title={view.state==='loading'?t('Loading billing details…','טוען את פרטי התשלום…'):view.state==='forbidden'?t('Access unavailable','אין גישה'):view.state==='unknown'?t('Operation status unresolved','מצב הפעולה טרם הובהר'):t('Billing unavailable','התשלומים אינם זמינים')}
    body={view.state==='loading'?t('Waiting for the authorized record.','ממתינים לרשומה המורשית.'):view.state==='unknown'?t('Check the same operation reference before trying again. No new payment operation is permitted from an unresolved result.','יש לבדוק את אותה הפעולה לפני ניסיון נוסף. תוצאה לא פתורה אינה מאפשרת פעולת תשלום חדשה.'):t('No balance or payment result is inferred from missing or inaccessible data.','לא מסיקים יתרה או תוצאת תשלום מנתונים חסרים או בלתי נגישים.')}/>:<>
    <div className={styles.summary} aria-label={t('Authoritative balance','יתרה מאומתת')}>
     <div className={styles.primaryStat}><span>{active.balance.state==='no_debt'?t('Payment obligation','חובת תשלום'):t('Remaining balance','יתרה לתשלום')}</span><strong className={styles.money}>{hiddenAmounts?t('Awaiting verification','ממתין לאימות'):money(active.balance.remainingMinor,locale)}</strong><span>{hiddenAmounts?t('Current amounts are not yet verified.','הסכומים העדכניים טרם אומתו.'):t(...status[active.balance.state])}</span></div>
     <div><span>{t('Settled allocation','סכום שהוקצה מתשלום')}</span><strong className={styles.money}>{hiddenAmounts?'—':money(active.balance.paidMinor,locale)}</strong></div>
     <div><span>{t('Quoted amount','סכום ההצעה')}</span><strong className={styles.money}>{money(active.balance.quotedMinor,locale)}</strong><span>{t('A quote alone creates no debt.','הצעה לבדה אינה יוצרת חוב.')}</span></div>
    </div>
    {active.balance.excessMinor>0&&<State title={t('Excess payment requires review','תשלום עודף דורש בדיקה')} body={`${money(active.balance.excessMinor,locale)} · ${t('No automatic transfer or refund.','ללא העברה או החזר אוטומטיים.')}`}/>}
    {active.balance.missingPolicy.length>0&&<aside className={styles.notice}><h2>{t('Offer not ready for acceptance or collection','ההצעה אינה מוכנה לאישור או לגבייה')}</h2><p>{t('Missing approved information:','חסר מידע מאושר:')}</p><ul>{active.balance.missingPolicy.map(k=><li key={k}>{t(...policy[k]!)}</li>)}</ul></aside>}
    {active.balance.paused&&<p className={styles.notice}>{t('Payment reminders are paused. Recorded balances remain visible.','תזכורות התשלום מושהות. היתרות הרשומות נשארות מוצגות.')}</p>}
    {active.balance.cancelled&&<p className={styles.notice}>{t('Offer cancelled. Reminders stop; no refund or debt write-off is inferred.','ההצעה בוטלה. התזכורות נעצרות; אין הסקה על החזר או מחיקת חוב.')}</p>}
    <section className={styles.card} aria-labelledby={`${id}-children`}><div className={styles.sectionHeading}><div><h2 id={`${id}-children`}>{t('Children & service periods','ילדים ותקופות שירות')}</h2><p>{t('Amounts come from the saved offer and ledger.','הסכומים מגיעים מההצעה ומהרישומים שנשמרו.')}</p></div><Button disabled={!canCash} onClick={()=>start('cash',active.balance.lines.filter(l=>l.remainingMinor>0).map(l=>l.lineId))}>{t('Cash received','התקבל מזומן')}</Button></div>
     <div className={styles.lines}>{active.balance.lines.map(line=><article className={styles.line} key={line.lineId}><div><h3><bdi>{childName(line.childId)}</bdi></h3><p><time dateTime={line.period.startsAt}>{dateText(line.period.startsAt,locale)}</time> – <time dateTime={line.period.endsAt}>{dateText(line.period.endsAt,locale)}</time></p><small>{t('Service period · Florida time','תקופת שירות · שעון פלורידה')}</small></div><dl><div><dt>{t('Due','חיוב')}</dt><dd className={styles.money}>{hiddenAmounts?'—':money(line.dueMinor,locale)}</dd></div><div><dt>{t('Settled','שולם והוקצה')}</dt><dd className={styles.money}>{hiddenAmounts?'—':money(line.paidMinor,locale)}</dd></div><div><dt>{t('Remaining','יתרה')}</dt><dd className={styles.money}>{hiddenAmounts?'—':money(line.remainingMinor,locale)}</dd></div></dl><div><p className={styles.due}>{line.dueAt?t('Due: ','לתשלום עד: ')+dateText(line.dueAt,locale):t('Payment date not approved','מועד תשלום לא אושר')}</p><Button variant="secondary" disabled={!canCash||line.remainingMinor===0} onClick={()=>start('cash',[line.lineId])}>{t('Record cash for this child','רישום מזומן לילד זה')}</Button></div></article>)}</div>
     {!workflow.ports&&<p className={styles.help}>{t('Payment actions are unavailable until the authenticated integration is connected.','פעולות התשלום אינן זמינות עד לחיבור הממשק המורשה.')}</p>}
    </section>
    <div className={styles.lower}>
     <section className={styles.card}><h2>{t('Card & reminder status','מצב כרטיס ותזכורות')}</h2><p>{view.state==='ready'&&view.cardState==='failed'?t('Card attempt failed · no payment confirmed.','ניסיון התשלום בכרטיס נכשל · לא אושר תשלום.'):active.balance.pendingAttemptIds.length||view.state==='ready'&&view.cardState==='pending'?t('Card payment pending · balance is not marked paid.','תשלום בכרטיס ממתין · היתרה אינה מסומנת כשולמה.'):t('No card outcome is inferred.','אין הסקה על תוצאת תשלום בכרטיס.')}</p>
      {active.balance.reminders.length?<ul className={styles.statusList}>{active.balance.reminders.map(r=><li key={r.id}><span>{t(...reminder[r.state]!)}</span><small><bdi>{r.id}</bdi></small></li>)}</ul>:<p className={styles.help}>{t('No reminder records in this snapshot. This does not prove delivery is configured.','אין רשומות תזכורת בתמונת מצב זו. אין בכך הוכחה שהמסירה מוגדרת.')}</p>}
     </section>
     <section className={styles.card}><h2>{t('Cash receipts & corrections','קבלות מזומן ותיקונים')}</h2>{historyEntries===null?<p className={styles.help}>{t('Authenticated receipt history is unavailable or needs refresh. Correction actions are unavailable.','היסטוריית הקבלות המורשית אינה זמינה או דורשת רענון. פעולות תיקון אינן זמינות.')}</p>:historyEntries.length===0?<p>{t('No receipts in the supplied history.','אין קבלות בהיסטוריה שסופקה.')}</p>:<ol className={styles.history}>{historyEntries.map(r=><li key={r.id}><div className={styles.receiptHeading}><strong>{r.kind==='cash'?t('Cash received','התקבל מזומן'):r.kind==='cash_reversal'?t('Cash correction','תיקון מזומן'):r.kind==='card'?t('Card receipt','קבלת כרטיס'):t('Financial adjustment','התאמה כספית')}</strong><bdi className={styles.money}>{money(r.amountMinor,locale)}</bdi></div><p><time dateTime={r.receivedAt}>{dateText(r.receivedAt,locale,true)}</time></p><small>{t('Receipt','קבלה')}: <bdi>{r.id}</bdi></small>{r.originalReceiptId&&<small>{t('Original receipt','הקבלה המקורית')}: <bdi>{r.originalReceiptId}</bdi></small>}{r.reason&&<p><bdi>{r.reason}</bdi></p>}{r.kind==='cash'&&<Button variant="quiet" disabled={!reversalAllowed||!workflow.ports||uncertain||cashAvailable(r)===0} onClick={()=>start('reversal',r.allocations.map(a=>a.lineId),r)}>{t('Correct cash entry','תיקון רישום המזומן')}</Button>}</li>)}</ol>}</section>
    </div>
    <details className={styles.references}><summary>{t('Saved offer & acceptance references','מזהי ההצעה והאישור שנשמרו')}</summary><dl><dt>{t('Offer','הצעה')}</dt><dd><bdi>{active.quote.id}</bdi></dd><dt>{t('Version','גרסה')}</dt><dd>{active.quote.revision}</dd><dt>{t('Terms','תנאים')}</dt><dd><bdi>{active.quote.definition.terms.id}</bdi></dd><dt>{t('Acceptance','אישור')}</dt><dd>{active.quote.acceptance?dateText(active.quote.acceptance.acceptedAt,locale,true):t('Not accepted · no debt','טרם אושרה · אין חוב')}</dd></dl></details>
   </>}
  {visibleModal&&currentData&&<BillingDialog locale={locale} modal={visibleModal} update={update} close={()=>setModal(null)} review={review} flow={flow} workflow={workflow} data={currentData} childName={childName}/>}
 </section>;
}
function State({title,body}:{title:string;body:string}){return <div className={styles.notice} role="status"><h2>{title}</h2><p>{body}</p></div>;}
export function WorkflowNotice({flow,workflow,locale,showDetails}:{flow:BillingWorkflowState;workflow:BillingWorkflow;locale:'en'|'he';showDetails:boolean}){
 const t=(en:string,he:string)=>locale==='he'?he:en;
 if(flow.phase==='idle')return null;
 if(!showDetails)return workflow.unresolved()?<State title={t('Earlier operation needs verification','פעולה קודמת דורשת אימות')} body={t('Return to its original family context to check it. New billing entries remain unavailable until verification finishes.','יש לחזור למשפחה המקורית כדי לבדוק את הפעולה. רישומים חדשים אינם זמינים עד להשלמת האימות.')}/>:null;
 const title=flow.phase==='confirmed'?t('Recorded · balance refreshed','נרשם · היתרה רועננה'):flow.phase==='conflict'?t('Balance changed · review again','היתרה השתנתה · נדרשת בדיקה נוספת'):flow.phase==='rejected'?t('Entry not accepted','הרישום לא התקבל'):flow.phase==='refresh_required'?t('Receipt confirmed · current balance unavailable','הקבלה אושרה · היתרה העדכנית אינה זמינה'):flow.phase==='unknown'?t('Operation outcome unknown','תוצאת הפעולה אינה ידועה'):t('Verifying payment state…','בודק את מצב התשלום…');
 return <aside className={styles.operation} role="status" aria-live="polite"><h2>{title}</h2><p>{flow.phase==='unknown'?t('Do not record it again. Check the same operation reference; an absent result remains unresolved.','אין לרשום שוב. יש לבדוק את אותו מזהה פעולה; תוצאה חסרה נשארת לא פתורה.'):flow.phase==='refresh_required'?t('No additional entry is needed. Refresh the authoritative balance.','אין צורך ברישום נוסף. יש לרענן את היתרה המוסמכת.'):flow.phase==='confirmed'?t('The displayed balance comes from fresh authorized readback.','היתרה המוצגת מגיעה מקריאה מורשית ועדכנית.'):flow.phase==='conflict'?t('Nothing was confirmed from the stale form. Review the refreshed balance before a new entry.','לא אושר דבר מהטופס הישן. יש לבדוק את היתרה המרועננת לפני רישום חדש.'):t('No optimistic payment result is shown.','לא מוצגת תוצאת תשלום משוערת.')}</p>{showDetails&&<small>{t('Operation','פעולה')}: <bdi>{flow.command.operationId}</bdi></small>}{showDetails&&flow.phase==='unknown'&&<Button variant="secondary" onClick={()=>void workflow.recover()}>{t('Check operation status','בדיקת מצב הפעולה')}</Button>}{showDetails&&flow.phase==='refresh_required'&&<Button variant="secondary" onClick={()=>void workflow.refresh()}>{t('Refresh balance','רענון יתרה')}</Button>}{(flow.phase==='conflict'||flow.phase==='rejected')&&<Button variant="secondary" onClick={()=>workflow.clear()}>{t('Review details','בדיקת פרטים')}</Button>}</aside>;
}
function BillingDialog({locale,modal,update,close,review,flow,workflow,data,childName}:{locale:'en'|'he';modal:Modal;update:(p:Partial<Modal>)=>void;close:()=>void;review:(e:FormEvent)=>Promise<void>;flow:BillingWorkflowState;workflow:BillingWorkflow;data:BillingData;childName:(id:string)=>string}){
 const ref=useRef<HTMLDialogElement>(null),id=useId(),t=(en:string,he:string)=>locale==='he'?he:en;
 useEffect(()=>{const d=ref.current;if(!d)return;const focused=document.activeElement;d.showModal();return()=>{d.close();if(focused instanceof HTMLElement&&focused.isConnected)focused.focus();};},[]);
 const busy=workflow.unresolved(),done=flow.phase==='confirmed',reviewing=modal.review!==null;
 return <dialog ref={ref} className={styles.dialog} aria-labelledby={`${id}-title`} onCancel={e=>{e.preventDefault();close();}}><header className={styles.dialogHeader}><h2 id={`${id}-title`}>{modal.kind==='cash'?t('Record cash received','רישום מזומן שהתקבל'):t('Correct cash entry','תיקון רישום מזומן')}</h2><Button variant="quiet" aria-label={t('Close dialog','סגירת החלון')} onClick={close}>×</Button></header><div className={styles.dialogBody}>
  {done?<><p role="status">{t('Receipt confirmed and balance refreshed.','הקבלה אושרה והיתרה רועננה.')}</p><Button onClick={close}>{t('Done','סיום')}</Button></>:busy?<><WorkflowNotice flow={flow} workflow={workflow} locale={locale} showDetails/><p>{t('Closing this dialog does not cancel or resolve the operation.','סגירת החלון אינה מבטלת או פותרת את הפעולה.')}</p></>:reviewing?<>
   <p>{t('Confirm the real amount and allocation before recording.','יש לאמת את הסכום שהתקבל ואת החלוקה לפני הרישום.')}</p><strong className={`${styles.confirmAmount} ${styles.money}`}>{money(modal.review!.amountMinor,locale)}</strong>
   <dl className={styles.confirmFacts}>{modal.review!.allocations.map(a=>{const l=data.quote.lines.find(l=>l.id===a.lineId)!;return <div key={a.lineId}><dt><bdi>{childName(l.childId)}</bdi></dt><dd className={styles.money}>{money(a.amountMinor,locale)}</dd></div>;})}</dl>
   <p>{t('Unallocated amount','סכום שלא הוקצה')}: <bdi className={styles.money}>{money(unallocatedAmount(modal.review!.amountMinor,modal.review!.allocations),locale)}</bdi></p><p className={styles.help}>{modal.kind==='cash'?t('Any unallocated money remains separate; it does not reduce a child’s balance.','כסף שלא הוקצה נשאר בנפרד; הוא אינו מפחית את יתרת הילד.'):t('Only the stated allocations are reversed. Any unallocated reversal corrects the original unallocated money.','רק ההקצאות המוצגות מתוקנות. סכום תיקון שלא הוקצה מתקן כסף שלא הוקצה ברישום המקורי.')}</p>
   {'receivedAt' in modal.review!&&<p>{t('Received','התקבל')}: {dateText((modal.review! as {receivedAt:string}).receivedAt,locale,true)}</p>}
   {'reason' in modal.review!&&<><p>{t('Reason','סיבה')}: <bdi>{(modal.review! as {reason:string}).reason}</bdi></p><p>{t('This corrects the recorded cash entry; it does not send a refund. The original is retained.','פעולה זו מתקנת רישום מזומן; היא אינה מבצעת החזר. הרישום המקורי נשמר.')}</p></>}
   {data.balance.revision!==modal.review!.expectedVersion&&<p role="alert">{t('The balance changed. Return to the form and review again.','היתרה השתנתה. יש לחזור לטופס ולבדוק שוב.')}</p>}
   <div className={styles.actions}><Button disabled={data.balance.revision!==modal.review!.expectedVersion} onClick={()=>void workflow.submit(modal.kind,modal.review,data)}>{t('Confirm entry','אישור הרישום')}</Button><Button variant="secondary" onClick={()=>update({review:null})}>{t('Back to edit','חזרה לעריכה')}</Button></div>
  </>:<form onSubmit={e=>void review(e)}>
   {modal.error&&<p className={styles.error} role="alert">{modal.error}</p>}
   <Input id={`${id}-amount`} label={modal.kind==='cash'?t('Amount received (USD)','סכום שהתקבל (דולר)'):t('Amount to reverse (USD)','סכום לתיקון (דולר)')} value={modal.amount} inputMode="decimal" dir="ltr" required onChange={e=>update({amount:e.target.value,...(modal.kind==='cash'&&modal.lineIds.length===1?{allocations:{[modal.lineIds[0]!]:e.target.value}}:{})})}/>
   {modal.kind==='cash'&&<Input id={`${id}-date`} label={t('Actual received date · Florida','תאריך קבלה בפועל · פלורידה')} type="date" required value={modal.date} onChange={e=>update({date:e.target.value})} help={t('Date handling is supplied by the approved integration, never your workstation time zone.','התאריך מטופל באמצעות הממשק המאושר, ולא לפי אזור הזמן במחשב.')}/>}
   <fieldset className={styles.allocationFields}><legend>{t('Allocate to children and periods','חלוקה לילדים ולתקופות')}</legend>{modal.lineIds.map((lineId,i)=>{const l=data.quote.lines.find(l=>l.id===lineId)!;return <Input key={lineId} id={`${id}-line-${i}`} label={`${childName(l.childId)} · ${dateText(l.period.startsAt,locale)}`} value={modal.allocations[lineId]??''} inputMode="decimal" dir="ltr" required onChange={e=>update({allocations:{...modal.allocations,[lineId]:e.target.value}})}/>;})}<p className={styles.help}>{t('Allocations may be lower than the total. Review the unallocated amount separately before confirming.','סכום החלוקה יכול להיות נמוך מהסכום הכולל. יש לבדוק בנפרד את הסכום שלא הוקצה לפני האישור.')}</p></fieldset>
   {modal.kind==='reversal'&&<Textarea id={`${id}-reason`} label={t('Correction reason','סיבת התיקון')} required maxLength={500} rows={3} value={modal.reason} onChange={e=>update({reason:e.target.value})}/>}
   <div className={styles.actions}><Button type="submit" busy={modal.preparing}>{t('Review entry','בדיקת הרישום')}</Button><Button variant="secondary" onClick={close}>{t('Cancel','ביטול')}</Button></div>
  </form>}
 </div></dialog>;
}
