'use client';
import {useEffect,useId,useMemo,useRef,useState,useSyncExternalStore} from 'react';
import type {FormEvent} from 'react';
import {Button,Input,Textarea} from '../../ui/workspace/controls.tsx';
import {ledgerReceiptV2Schema} from '../fishing-billing/contracts-v2.ts';
import {BillingWorkflow,type BillingWorkflowState} from './workflow.ts';
import {commandFor,prepareStateCommand,moneyVersion,isLegacyData,isGuestData,decodeData,floridaDate,inputUsd,money,parseUsd,receivedDate,sameScope,dataScope,validateSubject,preparationTicket,editedPreparation,samePreparation,unallocatedAmount,type BillingReceipt,type PreparationTicket,type MoneyCommand,type StateCommand,type StateAction,type BillingData,type BillingSubject,type BillingView,type MoneyKind} from './owner-model.ts';
import styles from './panel.module.css';
import {cardCommand,cardUnresolved,type CardCommand,type CardContext} from './card-model.ts';
import {guestCardCommand,guestCardUnresolved,type GuestCardContext} from './owner-card-model-v3.ts';
const ownerCardUnresolved=(card:CardContext|GuestCardContext)=>'version' in card?guestCardUnresolved(card):cardUnresolved(card);

type MoneyModal={mode:'money';ticket:PreparationTicket;kind:MoneyKind;lineIds:string[];receipt:BillingReceipt|null;amount:string;allocations:Record<string,string>;date:string;reason:string;error:string;review:MoneyCommand|null;preparing:boolean};
type StateModal={mode:'state';ticket:PreparationTicket;action:StateAction;command:StateCommand};
type CardPrepareModal={mode:'card_prepare';ticket:PreparationTicket;amounts:Record<string,string>;review:CardCommand|null;error:string};
type CardCheckoutModal={mode:'card_checkout';ticket:PreparationTicket;attemptId:string};
type Modal=MoneyModal|StateModal|CardPrepareModal|CardCheckoutModal;
export type OwnerBillingPanelProps={locale:'en'|'he';view:BillingView;subject:BillingSubject;workflow:BillingWorkflow;observedAt?:string;cashAllowed?:boolean;reversalAllowed?:boolean;stateAllowed?:boolean;cardAllowed?:boolean};
const status:Record<BillingData['balance']['state'],readonly[string,string]>={no_debt:['No payment obligation','אין חובת תשלום'],unpaid:['Unpaid','טרם שולם'],partial:['Partially paid','שולם חלקית'],paid:['Paid','שולם'],overpaid:['Excess payment · review required','תשלום עודף · נדרשת בדיקה'],review_required:['Review required','נדרשת בדיקה']};
const policy:Record<string,readonly[string,string]>={service_period:['Service period','תקופת השירות'],proration:['Partial-period policy','מדיניות לתקופה חלקית'],renewal:['Renewal policy','מדיניות חידוש'],cancellation:['Cancellation policy','מדיניות ביטול'],weather:['Weather policy','מדיניות מזג אוויר'],payment_due:['Approved payment date','מועד תשלום מאושר']};
const reminder:Record<string,readonly[string,string]>={queued:['Queued · not sent','בתור · לא נשלחה'],unknown:['Delivery unknown · reconcile','מצב מסירה לא ידוע · נדרשת בדיקה'],provider_accepted:['Accepted by provider · delivery unverified','התקבלה אצל הספק · המסירה טרם אומתה'],delivered:['Delivered','נמסרה'],suppressed:['Suppressed','השליחה נחסמה'],failed:['Failed','נכשלה']};
function historyFor(data:BillingData):readonly BillingReceipt[]|null{
 try{return data.balance.receipts.map(raw=>{
  const r=ledgerReceiptV2Schema.parse(raw);
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
export function OwnerBillingPanel({locale,view,subject,workflow,observedAt,cashAllowed=false,reversalAllowed=false,stateAllowed=false,cardAllowed=false}:OwnerBillingPanelProps){
 const t=(en:string,he:string)=>locale==='he'?he:en;
 const id=useId(),flow=useSyncExternalStore(workflow.subscribe,workflow.getSnapshot,workflow.getServerSnapshot);
 const [modal,setModal]=useState<Modal|null>(null);
 let data:BillingData|null=null,invalid=false;
 try{if(view.state==='ready'||view.state==='conflict'){
  data=workflow.currentFor(decodeData(view.state==='ready'?view.data:view.current));
  if(!validateSubject(subject,data)){data=null;invalid=true;}
 }}catch{invalid=true;}
 const active=data,scopeMatches=active&&('scope' in flow? sameScope(dataScope(active),flow.scope):flow.guestCard? sameScope(dataScope(active),flow.guestCard.scope):false);
 const contextKey=active?`${active.quote.workspaceId}|${active.quote.familyId}|${active.quote.id}|${active.balance.revision}`:'unavailable';
 const preparationContext=useMemo(()=>({key:contextKey}),[contextKey]);
 const uncertain=workflow.unresolved();
 const hiddenAmounts=Boolean(scopeMatches&&uncertain);
 const historyEntries=active&&!hiddenAmounts?historyFor(active):null;
 const canCash=Boolean(active&&cashAllowed&&workflow.ports&&!uncertain&&active.quote.state==='accepted'&&!active.balance.cancelled&&active.balance.remainingMinor>0&&!active.balance.excessMinor&&!active.balance.missingPolicy.length);
 const canState=Boolean(active&&stateAllowed&&workflow.ports?.setState&&!uncertain&&!active.balance.cancelled);
 const childName=(childId:string)=>subject.children.find(c=>c.id===childId)?.name??t('Child details unavailable','פרטי הילד אינם זמינים');
 const cashAvailable=(receipt:BillingReceipt)=>Math.max(0,receipt.amountMinor-(historyEntries??[]).filter(r=>r.originalReceiptId===receipt.id).reduce((s,r)=>s+r.amountMinor,0));
 const start=(kind:MoneyKind,lineIds:string[],receipt:BillingReceipt|null=null)=>{
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
  setModal({mode:'money',ticket:preparationTicket(dataScope(active),active.balance.revision,preparationContext),kind,lineIds,receipt,allocations,amount:inputUsd(amount),date,reason:'',error:'',review:null,preparing:false});
 };
 const update=(patch:Partial<MoneyModal>)=>setModal(m=>m?.mode==='money'?{...m,...patch,error:''}:m);
 const edit=(patch:Partial<MoneyModal>)=>setModal(m=>m?.mode==='money'?{...m,...patch,ticket:editedPreparation(m.ticket),error:'',preparing:false,review:null}:m);
 const startState=(action:StateAction)=>{
  if(!active||!canState||!workflow.ports?.setState)return;
  if(flow.phase!=='idle'&&!workflow.clear())return;
  const command=prepareStateCommand(action,active,workflow.ports.nextOperationId());
  setModal({mode:'state',ticket:preparationTicket(dataScope(active),active.balance.revision,preparationContext),action,command});
 };
 const startCard=()=>{
  if(!active||!cardAllowed||!workflow.canPrepareCard(active))return;
  if(flow.phase!=='idle'&&!workflow.clear())return;
  setModal({mode:'card_prepare',ticket:preparationTicket(dataScope(active),active.balance.revision,preparationContext),amounts:Object.fromEntries(active.balance.lines.filter(l=>l.remainingMinor>0).map(l=>[l.lineId,inputUsd(l.remainingMinor)])),review:null,error:''});
 };
 const startCheckout=()=>{
  if(!active||!cardAllowed||!workflow.canCreateCheckout(active)||!workflow.cardFor(active))return;
  if(flow.phase!=='idle'&&!workflow.clear())return;
  setModal({mode:'card_checkout',ticket:preparationTicket(dataScope(active),active.balance.revision,preparationContext),attemptId:workflow.cardFor(active)!.attemptId});
 };
 const editCard=(lineId:string,value:string)=>setModal(m=>m?.mode==='card_prepare'?{...m,amounts:{...m.amounts,[lineId]:value},ticket:editedPreparation(m.ticket),review:null,error:''}:m);
 const reviewCard=()=>{
  if(modal?.mode!=='card_prepare'||!active||!cardAllowed||!workflow.ports||!workflow.canPrepareCard(active)||modal.ticket.context!==preparationContext)return;
  const ticket=modal.ticket;
  try{
   const selection=Object.entries(modal.amounts).map(([lineId,value])=>{const amountMinor=zero(value)?0:parseUsd(value);if(amountMinor===null)throw Error('INVALID_AMOUNT');return {lineId,amountMinor};}).filter(a=>a.amountMinor>0);
   const raw={operationId:workflow.ports.nextOperationId(),quoteId:active.quote.id,expectedVersion:active.balance.revision,selection};
   const command=isGuestData(active)?guestCardCommand(raw,active):cardCommand(raw,active);
   setModal(m=>m?.mode==='card_prepare'&&samePreparation(m.ticket,ticket)?{...m,review:command,error:''}:m);
  }catch{setModal(m=>m?.mode==='card_prepare'&&samePreparation(m.ticket,ticket)?{...m,error:t('Check the selected amounts against the current outstanding lines. Nothing was submitted.','יש לבדוק את הסכומים שנבחרו מול יתרות השורות העדכניות. דבר לא נשלח.')}:m);}
 };
 async function review(event:FormEvent){
  event.preventDefault();if(!modal||modal.mode!=='money'||!active||!workflow.ports||modal.preparing||modal.ticket.context!==preparationContext||modal.ticket.revision!==active.balance.revision||!sameScope(modal.ticket.scope,dataScope(active)))return;
  const draft=modal,current=active,amount=parseUsd(draft.amount);
  const allocations=draft.lineIds.map(lineId=>({lineId,amountMinor:zero(draft.allocations[lineId]??'')?0:parseUsd(draft.allocations[lineId]??'')}));
  if(amount===null||allocations.some(a=>a.amountMinor===null)||allocations.reduce((s,a)=>s+(a.amountMinor??0),0)>amount||draft.kind==='cash'&&!allocations.some(a=>(a.amountMinor??0)>0)){update({error:t('Enter a positive USD amount. Allocations cannot exceed it; cash recording requires at least one allocation.','יש להזין סכום חיובי בדולר. סכום החלוקה אינו יכול לעלות עליו; רישום מזומן דורש הקצאה אחת לפחות.')});return;}
  if(draft.kind==='reversal'&&!draft.reason.trim()){update({error:t('Enter the reason for correcting this cash entry.','יש להזין סיבה לתיקון רישום המזומן.')});return;}
  update({preparing:true});
  try{
   const common={version:moneyVersion(active),operationId:workflow.ports.nextOperationId(),expectedVersion:current.balance.revision,quoteId:current.quote.id,amountMinor:amount,allocations:allocations.filter(a=>a.amountMinor!>0).map(a=>({lineId:a.lineId,amountMinor:a.amountMinor!}))};
   let command:MoneyCommand;
   if(draft.kind==='cash'){
    command=commandFor('cash',{...common,currency:'USD',receivedPrecision:'date',receivedDate:receivedDate(draft.date),timeZone:'America/New_York'});
   }else command=commandFor('reversal',{...common,originalReceiptId:draft.receipt!.id,reason:draft.reason.trim()});
   if(workflow.currentFor(current).balance.revision!==draft.ticket.revision)throw Error('STALE_PREPARATION');
   setModal(m=>m?.mode==='money'&&samePreparation(m.ticket,draft.ticket)?{...m,review:command,preparing:false,error:''}:m);
  }catch{setModal(m=>m?.mode==='money'&&samePreparation(m.ticket,draft.ticket)?{...m,preparing:false,error:t('This entry could not be prepared. Check the amount, allocation and received-date capability; nothing has been submitted.','לא ניתן להכין את הרישום. יש לבדוק את הסכום, החלוקה ואפשרות תאריך הקבלה; דבר לא נשלח.')}:m);}
 }
 const visibleModal=modal&&active&&sameScope(modal.ticket.scope,dataScope(active))&&(modal.ticket.context===preparationContext||flow.phase==='confirmed'&&(modal.mode==='money'?modal.review?.operationId:modal.mode==='state'?modal.command.operationId:null)===flow.command.operationId)?modal:null;
 const currentData=active;
 return <section className={styles.panel} lang={locale} dir={locale==='he'?'rtl':'ltr'} aria-labelledby={`${id}-title`} data-billing-owner-panel>
  <header className={styles.heading}><div><p className={styles.eyebrow}>{t('Fishing Academy','אקדמיית הדיג')}</p><h1 id={`${id}-title`} tabIndex={-1}>{t('Family billing','תשלומי המשפחה')}</h1>{active&&<p className={styles.family}><bdi>{subject.label}</bdi></p>}</div><span className={styles.test}>{t('Test environment · no live collection','סביבת בדיקה · ללא גבייה בפועל')}</span></header>
  <WorkflowNotice flow={flow} workflow={workflow} locale={locale} showDetails={Boolean(scopeMatches)}/>
  {flow.card&&cardUnresolved(flow.card)&&(!active||!sameScope(flow.card.scope,dataScope(active)))&&<State title={t('Earlier card operation needs verification','פעולת כרטיס קודמת דורשת אימות')} body={t('Return to its original family context. New billing commands remain unavailable until the original attempt is resolved.','יש לחזור למשפחה המקורית. פעולות חיוב חדשות אינן זמינות עד לבירור הניסיון המקורי.')}/>}
  {flow.guestCard&&guestCardUnresolved(flow.guestCard)&&(!active||!isGuestData(active)||!sameScope(flow.guestCard.scope,dataScope(active)))&&<State title={t('Earlier card operation needs verification','פעולת כרטיס קודמת דורשת אימות')} body={t('Return to its original family context. New billing commands remain unavailable until the original attempt is resolved.','יש לחזור למשפחה המקורית. פעולות חיוב חדשות אינן זמינות עד לבירור הניסיון המקורי.')}/>}
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
    <section className={styles.card} aria-labelledby={`${id}-offer-controls`}>
     <h2 id={`${id}-offer-controls`}>{t('Offer follow-up controls','ניהול מעקב ההצעה')}</h2>
     <p>{hiddenAmounts?t('Awaiting authoritative status.','ממתינים למצב מאומת.'):active.balance.cancelled?t('Offer cancelled · follow-up suppressed.','ההצעה בוטלה · המעקב חסום.'):active.balance.paused?t('Payment follow-up paused.','מעקב התשלום מושהה.'):t('Payment follow-up is not paused.','מעקב התשלום אינו מושהה.')}</p>
     <div className={styles.actions}>
      <Button variant="secondary" disabled={!canState} onClick={()=>startState(active.balance.paused?'resume':'pause')}>{active.balance.paused?t('Resume follow-up','חידוש המעקב'):t('Pause follow-up','השהיית המעקב')}</Button>
      <Button variant="secondary" disabled={!canState} onClick={()=>startState('cancel')}>{t('Cancel offer','ביטול ההצעה')}</Button>
     </div>
     {(!stateAllowed||!workflow.ports?.setState)&&<p className={styles.help}>{t('Offer controls are unavailable until explicitly enabled with the authorized state integration.','ניהול ההצעה אינו זמין עד להפעלה מפורשת ולחיבור הממשק המורשה.')}</p>}
    </section>
    <section className={styles.card} aria-labelledby={`${id}-children`}><div className={styles.sectionHeading}><div><h2 id={`${id}-children`}>{t('Children & service periods','ילדים ותקופות שירות')}</h2><p>{t('Amounts come from the saved offer and ledger.','הסכומים מגיעים מההצעה ומהרישומים שנשמרו.')}</p></div><Button disabled={!canCash} onClick={()=>start('cash',active.balance.lines.filter(l=>l.remainingMinor>0).map(l=>l.lineId))}>{t('Cash received','התקבל מזומן')}</Button></div>
     <div className={styles.lines}>{active.balance.lines.map(line=><article className={styles.line} key={line.lineId}><div><h3><bdi>{childName(line.childId)}</bdi></h3><p><time dateTime={line.period.startsAt}>{dateText(line.period.startsAt,locale)}</time> – <time dateTime={line.period.endsAt}>{dateText(line.period.endsAt,locale)}</time></p><small>{t('Service period · Florida time','תקופת שירות · שעון פלורידה')}</small></div><dl><div><dt>{t('Due','חיוב')}</dt><dd className={styles.money}>{hiddenAmounts?'—':money(line.dueMinor,locale)}</dd></div><div><dt>{t('Settled','שולם והוקצה')}</dt><dd className={styles.money}>{hiddenAmounts?'—':money(line.paidMinor,locale)}</dd></div><div><dt>{t('Remaining','יתרה')}</dt><dd className={styles.money}>{hiddenAmounts?'—':money(line.remainingMinor,locale)}</dd></div></dl><div><p className={styles.due}>{line.dueAt?t('Due: ','לתשלום עד: ')+dateText(line.dueAt,locale):t('Payment date not approved','מועד תשלום לא אושר')}</p><Button variant="secondary" disabled={!canCash||line.remainingMinor===0} onClick={()=>start('cash',[line.lineId])}>{t('Record cash for this child','רישום מזומן לילד זה')}</Button></div></article>)}</div>
     {!workflow.ports&&<p className={styles.help}>{t('Payment actions are unavailable until the authenticated integration is connected.','פעולות התשלום אינן זמינות עד לחיבור הממשק המורשה.')}</p>}
    </section>
    {isLegacyData(active)||workflow.hasCardClient(active)?<CardControls locale={locale} data={active} workflow={workflow} allowed={cardAllowed} onPrepare={startCard} onCheckout={startCheckout}/>:<section className={styles.card}><h2>{t('Card payment unavailable','תשלום בכרטיס אינו זמין')}</h2><p>{t('Card payment is unavailable for this offer.','תשלום בכרטיס אינו זמין עבור הצעה זו.')}</p></section>}
    <div className={styles.lower}>
     <section className={styles.card}><h2>{t('Card & reminder status','מצב כרטיס ותזכורות')}</h2><p>{view.state==='ready'&&view.cardState==='failed'?t('Card attempt failed · no payment confirmed.','ניסיון התשלום בכרטיס נכשל · לא אושר תשלום.'):active.balance.pendingAttemptIds.length||view.state==='ready'&&view.cardState==='pending'?t('Card payment pending · balance is not marked paid.','תשלום בכרטיס ממתין · היתרה אינה מסומנת כשולמה.'):t('No card outcome is inferred.','אין הסקה על תוצאת תשלום בכרטיס.')}</p>
      {active.balance.reminders.length?<ul className={styles.statusList}>{active.balance.reminders.map(r=><li key={r.id}><span>{t(...reminder[r.state]!)}</span><small><bdi>{r.id}</bdi></small></li>)}</ul>:<p className={styles.help}>{t('No reminder records in this snapshot. This does not prove delivery is configured.','אין רשומות תזכורת בתמונת מצב זו. אין בכך הוכחה שהמסירה מוגדרת.')}</p>}
     </section>
     <section className={styles.card}><h2>{t('Cash receipts & corrections','קבלות מזומן ותיקונים')}</h2>{historyEntries===null?<p className={styles.help}>{t('Authenticated receipt history is unavailable or needs refresh. Correction actions are unavailable.','היסטוריית הקבלות המורשית אינה זמינה או דורשת רענון. פעולות תיקון אינן זמינות.')}</p>:historyEntries.length===0?<p>{t('No receipts in the supplied history.','אין קבלות בהיסטוריה שסופקה.')}</p>:<ol className={styles.history}>{historyEntries.map(r=><li key={r.id}><div className={styles.receiptHeading}><strong>{r.kind==='cash'?t('Cash received','התקבל מזומן'):r.kind==='cash_reversal'?t('Cash correction','תיקון מזומן'):r.kind==='card'?t('Card receipt','קבלת כרטיס'):t('Financial adjustment','התאמה כספית')}</strong><bdi className={styles.money}>{money(r.amountMinor,locale)}</bdi></div><p>{'receivedAt' in r?<time dateTime={r.receivedAt}>{dateText(r.receivedAt,locale,true)}</time>:<><bdi><time dateTime={r.receivedDate}>{r.receivedDate}</time></bdi> · {t('Florida date · receipt time not recorded','תאריך בפלורידה · שעת הקבלה לא נרשמה')}</>}</p><p className={styles.help}>{t('Recorded','נרשם')}: <time dateTime={r.recordedAt}>{dateText(r.recordedAt,locale,true)}</time></p><small>{t('Receipt','קבלה')}: <bdi>{r.id}</bdi></small>{r.originalReceiptId&&<small>{t('Original receipt','הקבלה המקורית')}: <bdi>{r.originalReceiptId}</bdi></small>}{r.reason&&<p><bdi>{r.reason}</bdi></p>}{r.kind==='cash'&&<Button variant="quiet" disabled={!reversalAllowed||!workflow.ports||uncertain||cashAvailable(r)===0} onClick={()=>start('reversal',r.allocations.map(a=>a.lineId),r)}>{t('Correct cash entry','תיקון רישום המזומן')}</Button>}</li>)}</ol>}</section>
    </div>
    <details className={styles.references}><summary>{t('Saved offer & acceptance references','מזהי ההצעה והאישור שנשמרו')}</summary><dl><dt>{t('Offer','הצעה')}</dt><dd><bdi>{active.quote.id}</bdi></dd><dt>{t('Version','גרסה')}</dt><dd>{active.quote.revision}</dd><dt>{t('Terms','תנאים')}</dt><dd><bdi>{active.quote.definition.terms.id}</bdi></dd><dt>{t('Acceptance','אישור')}</dt><dd>{active.quote.acceptance?dateText(active.quote.acceptance.acceptedAt,locale,true):t('Not accepted · no debt','טרם אושרה · אין חוב')}</dd>{isGuestData(active)&&active.quote.acceptance&&<><dt>{t('Acceptance basis','בסיס האישור')}</dt><dd>{t('Private guest grant evidence','ראיות למענק גישה פרטי לאורח')} · <bdi>{active.quote.acceptance.grantId}</bdi></dd></>}</dl></details>
   </>}
  {visibleModal&&currentData&&visibleModal.mode==='money'&&<BillingDialog locale={locale} modal={visibleModal} update={update} edit={edit} close={()=>setModal(null)} review={review} flow={flow} workflow={workflow} data={currentData} childName={childName}/>}
  {visibleModal&&currentData&&visibleModal.mode==='state'&&<StateDialog locale={locale} modal={visibleModal} close={()=>setModal(null)} flow={flow} workflow={workflow} data={currentData} allowed={canState} familyLabel={subject.label}/>}
  {visibleModal&&currentData&&(visibleModal.mode==='card_prepare'||visibleModal.mode==='card_checkout')&&<CardDialog locale={locale} modal={visibleModal} close={()=>setModal(null)} data={currentData} workflow={workflow} allowed={cardAllowed} familyLabel={subject.label} childName={childName} edit={editCard} review={reviewCard} back={()=>setModal(m=>m?.mode==='card_prepare'?{...m,review:null}:m)}/>}
 </section>;
}
function State({title,body}:{title:string;body:string}){return <div className={styles.notice} role="status"><h2>{title}</h2><p>{body}</p></div>;}
const stateTitles:Record<StateAction,readonly[string,string]>={pause:['Pause payment follow-up','השהיית מעקב התשלום'],resume:['Resume payment follow-up','חידוש מעקב התשלום'],cancel:['Cancel this offer','ביטול הצעה זו']};
const cardTitles:Record<string,readonly[string,string]>={prepared:['Card attempt prepared','ניסיון הכרטיס הוכן'],unknown:['Card attempt outcome unknown','תוצאת ניסיון הכרטיס אינה ידועה'],open:['TEST Checkout open · no payment confirmed','TEST Checkout פתוח · לא אושר תשלום'],pending:['Card payment pending · no payment confirmed','תשלום הכרטיס ממתין · לא אושר תשלום'],paid:['Card attempt settled · check the family balance','ניסיון הכרטיס הוסדר · יש לבדוק את יתרת המשפחה'],failed:['Card attempt failed','ניסיון הכרטיס נכשל'],expired:['Card attempt expired','תוקף ניסיון הכרטיס פג'],stale:['Card attempt needs current review','ניסיון הכרטיס דורש בדיקה עדכנית'],review_required:['Card attempt requires review','ניסיון הכרטיס דורש בדיקה']};
function CardReadback({locale,data,workflow,allowed,card}:{locale:'en'|'he';data:BillingData;workflow:BillingWorkflow;allowed:boolean;card:CardContext|GuestCardContext}){
 const t=(en:string,he:string)=>locale==='he'?he:en;
 const title=card.phase==='preparing'?t('Saving card preparation…','שמירת הכנת ניסיון הכרטיס…'):card.phase==='dispatching'?t('Creating TEST Checkout…','יצירת TEST Checkout…'):card.phase==='reading'?t('Checking the original card reference…','בדיקת מזהה הכרטיס המקורי…'):card.phase==='unknown'?t('Card operation unresolved','פעולת הכרטיס טרם הובהרה'):card.phase==='conflict'?t('Card request conflict · review current amounts','התנגשות בבקשת הכרטיס · יש לבדוק סכומים עדכניים'):card.phase==='rejected'?t('Card request not accepted','בקשת הכרטיס לא התקבלה'):t(...cardTitles[card.projection?.attempt.state??'review_required']!);
 const href=allowed?workflow.checkoutUrl(data):null;
 const canRead=allowed&&workflow.canReadCard(data);
 return <div role="status" className={styles.notice}>
  <h3>{title}</h3><p>{ownerCardUnresolved(card)?t('Check this same operation or attempt. Do not prepare a replacement, record cash or change the offer while its outcome is unresolved.','יש לבדוק את אותה הפעולה או את אותו הניסיון. אין להכין ניסיון חלופי, לרשום מזומן או לשנות את ההצעה כל עוד התוצאה לא הובהרה.'):t('A preparation or Checkout link does not mark the family paid. Use the current recorded balance.','הכנה או קישור Checkout אינם מסמנים את המשפחה כמי ששילמה. יש להסתמך על היתרה הרשומה העדכנית.')}</p>
  {card.projection&&<p>{t('Saved attempt amount','סכום הניסיון שנשמר')}: <bdi className={styles.money}>{money(card.projection.attempt.preparation.result.amountMinor,locale)}</bdi></p>}
  <small>{t('Original operation / attempt','הפעולה / הניסיון המקוריים')}: <bdi>{card.operationId}</bdi></small>
  <div className={styles.actions}><Button variant="secondary" disabled={!canRead} onClick={()=>void workflow.readCard(data)}>{card.lookup==='operation'?t('Check original preparation','בדיקת ההכנה המקורית'):t('Check original attempt','בדיקת הניסיון המקורי')}</Button>
   {href&&<a href={href} target="_blank" rel="noopener noreferrer" onClick={event=>{if(!allowed||workflow.checkoutUrl(data)!==href)event.preventDefault();}}>{t('Open TEST Checkout','פתיחת TEST Checkout')}</a>}
  </div>
  {!href&&<p className={styles.help}>{t('No currently eligible Checkout link is exposed.','לא מוצג קישור Checkout שכשיר לשימוש כעת.')}</p>}
 </div>;
}
/** Read-only rendering: all card effects are deliberate injected callbacks. */
export function CardControls({locale,data,workflow,allowed,onPrepare,onCheckout}:{locale:'en'|'he';data:BillingData;workflow:BillingWorkflow;allowed:boolean;onPrepare:()=>void;onCheckout:()=>void}){
 const t=(en:string,he:string)=>locale==='he'?he:en,card=workflow.cardFor(data);
 const scoped=card&&sameScope(card.scope,dataScope(data));
 const pending=data.balance.pendingAttemptIds.filter(id=>!scoped||card.attemptId!==id);
 return <section className={styles.card}><h2>{t('TEST card collection','גביית כרטיס בסביבת TEST')}</h2><p>{t('Preparing a card attempt and creating Checkout are separate owner actions. No family terms or waivers are accepted here.','הכנת ניסיון כרטיס ויצירת Checkout הן פעולות נפרדות של בעל החשבון. אין כאן אישור תנאים או כתבי ויתור בשם המשפחה.')}</p>
  <div className={styles.actions}><Button variant="secondary" disabled={!allowed||!workflow.canPrepareCard(data)} onClick={()=>{if(allowed&&workflow.canPrepareCard(data))onPrepare();}}>{t('Prepare TEST card attempt','הכנת ניסיון כרטיס TEST')}</Button><Button variant="secondary" disabled={!allowed||!workflow.canCreateCheckout(data)} onClick={()=>{if(allowed&&workflow.canCreateCheckout(data))onCheckout();}}>{t('Create TEST Checkout','יצירת TEST Checkout')}</Button></div>
  {(!allowed||!workflow.hasCardClient(data))&&<p className={styles.help}>{t('Card actions remain unavailable until explicitly enabled with the authorized injected client.','פעולות הכרטיס אינן זמינות עד להפעלה מפורשת ולחיבור הלקוח המורשה.')}</p>}
  {scoped&&<CardReadback locale={locale} data={data} workflow={workflow} allowed={allowed} card={card}/>}
  {pending.length>0&&<div><p>{t('Check an existing pending attempt before preparing another.','יש לבדוק ניסיון ממתין קיים לפני הכנת ניסיון נוסף.')}</p>{pending.map(id=><p key={id}><bdi>{id}</bdi> <Button variant="secondary" disabled={!allowed||!workflow.canReadCard(data,id)} onClick={()=>{if(allowed&&workflow.canReadCard(data,id))void workflow.readCard(data,id);}}>{t('Check existing attempt','בדיקת ניסיון קיים')}</Button></p>)}</div>}
 </section>;
}
function CardDialog({locale,modal,close,data,workflow,allowed,familyLabel,childName,edit,review,back}:{locale:'en'|'he';modal:CardPrepareModal|CardCheckoutModal;close:()=>void;data:BillingData;workflow:BillingWorkflow;allowed:boolean;familyLabel:string;childName:(id:string)=>string;edit:(lineId:string,value:string)=>void;review:()=>void;back:()=>void}){
 const ref=useOwnerDialog(),id=useId(),t=(en:string,he:string)=>locale==='he'?he:en;
 const card=workflow.cardFor(data),preparing=modal.mode==='card_prepare';
 const matching=card&&(preparing?modal.review?.operationId===card.operationId:modal.attemptId===card.attemptId);
 const started=Boolean(matching&&(preparing||card.checkoutInvoked));
 const fresh=sameScope(modal.ticket.scope,dataScope(data))&&modal.ticket.revision===data.balance.revision;
 return <dialog ref={ref} className={styles.dialog} aria-labelledby={`${id}-title`} onCancel={e=>{e.preventDefault();close();}}><header className={styles.dialogHeader}><h2 id={`${id}-title`}>{preparing?t('Prepare TEST card attempt','הכנת ניסיון כרטיס TEST'):t('Create TEST Checkout','יצירת TEST Checkout')}</h2><Button variant="quiet" aria-label={t('Close dialog','סגירת החלון')} onClick={close}>×</Button></header><div className={styles.dialogBody}>
  <p><bdi>{familyLabel}</bdi></p>
  {started&&card?<><CardReadback locale={locale} data={data} workflow={workflow} allowed={allowed} card={card}/><p>{t('Closing does not cancel or resolve the original card operation.','סגירת החלון אינה מבטלת או פותרת את פעולת הכרטיס המקורית.')}</p><Button onClick={close}>{t('Close','סגירה')}</Button></>:preparing?(modal.review?<>
   <p>{t('This prepares only the selected TEST card attempt. It does not create Checkout or confirm payment.','פעולה זו מכינה רק את ניסיון הכרטיס TEST שנבחר. היא אינה יוצרת Checkout ואינה מאשרת תשלום.')}</p>
   <dl className={styles.confirmFacts}>{modal.review.selection.map(a=>{const line=data.quote.lines.find(l=>l.id===a.lineId)!;return <div key={a.lineId}><dt><bdi>{childName(line.childId)}</bdi></dt><dd className={styles.money}>{money(a.amountMinor,locale)}</dd></div>;})}</dl>
   <p>{t('Total','סך הכול')}: <bdi className={styles.money}>{money(modal.review.selection.reduce((s,a)=>s+a.amountMinor,0),locale)}</bdi></p>
   <div className={styles.actions}><Button disabled={!allowed||!fresh||!workflow.canPrepareCard(data)} onClick={()=>{if(allowed&&fresh&&workflow.canPrepareCard(data))void workflow.prepareCard(modal.review,data);}}>{t('Confirm TEST preparation','אישור הכנת TEST')}</Button><Button variant="secondary" onClick={back}>{t('Back to edit','חזרה לעריכה')}</Button></div>
  </>:<form onSubmit={event=>{event.preventDefault();review();}}>
   <p>{t('Select amounts from the current outstanding lines. Enter 0 to leave a line out.','יש לבחור סכומים מתוך היתרות העדכניות. יש להזין 0 כדי להשאיר שורה מחוץ לניסיון.')}</p>{modal.error&&<p role="alert" className={styles.error}>{modal.error}</p>}
   {Object.entries(modal.amounts).map(([lineId,value],i)=>{const line=data.quote.lines.find(l=>l.id===lineId)!;return <Input key={lineId} id={`${id}-card-${i}`} label={`${childName(line.childId)} · ${dateText(line.period.startsAt,locale)}`} value={value} inputMode="decimal" dir="ltr" required onChange={event=>edit(lineId,event.target.value)} help={`${t('Outstanding','יתרה')}: ${money(data.balance.lines.find(l=>l.lineId===lineId)!.remainingMinor,locale)}`}/>;})}
   <div className={styles.actions}><Button type="submit" disabled={!allowed||!fresh||!workflow.canPrepareCard(data)}>{t('Review TEST preparation','בדיקת הכנת TEST')}</Button><Button variant="secondary" onClick={close}>{t('Keep current state','השארת המצב הנוכחי')}</Button></div>
  </form>):<>
   <p>{t('Create a TEST Checkout link for the saved attempt. This does not confirm payment or accept terms or waivers for the family. The link will not open automatically.','יצירת קישור TEST Checkout לניסיון השמור. פעולה זו אינה מאשרת תשלום ואינה מאשרת תנאים או כתבי ויתור בשם המשפחה. הקישור לא ייפתח אוטומטית.')}</p>
   <p>{t('Attempt','ניסיון')}: <bdi>{modal.attemptId}</bdi></p>
   <div className={styles.actions}><Button disabled={!allowed||!fresh||card?.attemptId!==modal.attemptId||!workflow.canCreateCheckout(data)} onClick={()=>{if(allowed&&fresh)void workflow.createCardCheckout(modal.attemptId,data);}}>{t('Confirm TEST Checkout creation','אישור יצירת TEST Checkout')}</Button><Button variant="secondary" onClick={close}>{t('Keep current state','השארת המצב הנוכחי')}</Button></div>
  </>}
 </div></dialog>;
}
/** Confirmation content only; rendering never submits a state command. */
export function StateActionConfirmation({locale,action,data,command,allowed,familyLabel,onConfirm,onBack}:{locale:'en'|'he';action:StateAction;data:BillingData;command:StateCommand;allowed:boolean;familyLabel:string;onConfirm:()=>void;onBack:()=>void}){
 const t=(en:string,he:string)=>locale==='he'?he:en;
 const matches=action==='cancel'?command.cancel===true&&command.paused===undefined:command.cancel===undefined&&command.paused===(action==='pause')&&data.balance.paused===(action==='resume');
 const valid=allowed&&matches&&command.quoteId===data.quote.id&&data.balance.revision===command.expectedVersion&&!data.balance.cancelled;
 return <>
  <p><bdi>{familyLabel}</bdi></p>
  <p>{action==='resume'?t('Resume eligibility for payment follow-up. This action sends or queues no messages.','חידוש הזכאות למעקב תשלום. פעולה זו אינה שולחת הודעות ואינה מוסיפה הודעות לתור.'):action==='cancel'?t('Cancel the saved offer and suppress further payment follow-up.','ביטול ההצעה השמורה וחסימת מעקב תשלום נוסף.'):t('Pause payment follow-up for this offer.','השהיית מעקב התשלום עבור הצעה זו.')}</p>
  <p>{t('Recorded payments and the outstanding balance stay unchanged. This action issues no refund or balance write-off.','התשלומים הרשומים והיתרה לתשלום נשארים ללא שינוי. פעולה זו אינה מבצעת החזר ואינה מוחקת יתרה.')}</p>
  <dl className={styles.confirmFacts}><div><dt>{t('Recorded allocation','הקצאת תשלום רשומה')}</dt><dd className={styles.money}>{money(data.balance.paidMinor,locale)}</dd></div><div><dt>{t('Outstanding balance','יתרה לתשלום')}</dt><dd className={styles.money}>{money(data.balance.remainingMinor,locale)}</dd></div></dl>
  {!valid&&<p role="alert">{t('This confirmation is no longer current or authorized. Close it and review the refreshed offer.','אישור זה אינו עדכני או מורשה. יש לסגור אותו ולבדוק את ההצעה המרועננת.')}</p>}
  <div className={styles.actions}><Button disabled={!valid} onClick={()=>{if(valid)onConfirm();}}>{action==='pause'?t('Confirm pause','אישור ההשהיה'):action==='resume'?t('Confirm resume','אישור החידוש'):t('Confirm offer cancellation','אישור ביטול ההצעה')}</Button><Button variant="secondary" onClick={onBack}>{t('Keep current state','השארת המצב הנוכחי')}</Button></div>
 </>;
}
function useOwnerDialog(){
 const ref=useRef<HTMLDialogElement>(null);
 useEffect(()=>{
  const d=ref.current;if(!d)return;const focused=document.activeElement;
  const heading=d.closest('[data-billing-owner-panel]')?.querySelector<HTMLElement>('h1');
  d.showModal();
  return()=>{d.close();if(focused instanceof HTMLElement&&focused.isConnected&&!focused.hasAttribute('disabled'))focused.focus();else if(heading?.isConnected)heading.focus();};
 },[]);
 return ref;
}
function StateDialog({locale,modal,close,flow,workflow,data,allowed,familyLabel}:{locale:'en'|'he';modal:StateModal;close:()=>void;flow:BillingWorkflowState;workflow:BillingWorkflow;data:BillingData;allowed:boolean;familyLabel:string}){
 const ref=useOwnerDialog(),id=useId(),t=(en:string,he:string)=>locale==='he'?he:en;
 const related=flow.phase!=='idle'&&flow.command.operationId===modal.command.operationId&&sameScope(flow.scope,modal.ticket.scope);
 const terminal=related&&['confirmed','conflict','rejected'].includes(flow.phase),busy=workflow.unresolved();
 const valid=allowed&&sameScope(modal.ticket.scope,dataScope(data))&&modal.ticket.revision===data.balance.revision;
 return <dialog ref={ref} className={styles.dialog} aria-labelledby={`${id}-title`} onCancel={e=>{e.preventDefault();close();}}><header className={styles.dialogHeader}><h2 id={`${id}-title`}>{t(...stateTitles[modal.action])}</h2><Button variant="quiet" aria-label={t('Close dialog','סגירת החלון')} onClick={close}>×</Button></header><div className={styles.dialogBody}>
  {busy||terminal?<><WorkflowNotice locale={locale} flow={flow} workflow={workflow} showDetails={related}/><p>{busy?t('Closing does not cancel or resolve the original operation.','סגירת החלון אינה מבטלת או פותרת את הפעולה המקורית.'):t('Review the current authorized offer status before another action.','יש לבדוק את מצב ההצעה המורשה והעדכני לפני פעולה נוספת.')}</p>{terminal&&<Button onClick={close}>{t('Close','סגירה')}</Button>}</>:<StateActionConfirmation locale={locale} action={modal.action} data={data} command={modal.command} allowed={valid} familyLabel={familyLabel} onBack={close} onConfirm={()=>{if(valid&&!workflow.unresolved()&&workflow.ports?.setState)void workflow.submit('state',modal.command,data);}}/>}
 </div></dialog>;
}
export function WorkflowNotice({flow,workflow,locale,showDetails}:{flow:BillingWorkflowState;workflow:BillingWorkflow;locale:'en'|'he';showDetails:boolean}){
 const t=(en:string,he:string)=>locale==='he'?he:en;
 if(flow.phase==='idle')return null;
 if(!showDetails)return workflow.unresolved()?<State title={t('Earlier operation needs verification','פעולה קודמת דורשת אימות')} body={t('Return to its original family context to check it. New billing entries remain unavailable until verification finishes.','יש לחזור למשפחה המקורית כדי לבדוק את הפעולה. רישומים חדשים אינם זמינים עד להשלמת האימות.')}/>:null;
 if(flow.kind==='state')return <aside className={styles.operation} role="status" aria-live="polite"><h2>{flow.phase==='confirmed'?t('State change recorded · current status refreshed','שינוי המצב נרשם · המצב העדכני רוענן'):flow.phase==='conflict'?t('Offer changed · review again','ההצעה השתנתה · נדרשת בדיקה נוספת'):flow.phase==='rejected'?t('State change not accepted','שינוי המצב לא התקבל'):flow.phase==='refresh_required'?t('State operation confirmed · current status unavailable','פעולת המצב אושרה · המצב העדכני אינו זמין'):flow.phase==='unknown'?t('State operation outcome unknown','תוצאת פעולת המצב אינה ידועה'):t('Verifying offer status…','בדיקת מצב ההצעה…')}</h2><p>{flow.phase==='confirmed'?t('The displayed state and balances come from fresh authorized readback.','המצב והיתרות המוצגים מגיעים מקריאה מורשית ועדכנית.'):flow.phase==='conflict'?t('This action was not confirmed. Review the refreshed offer before another confirmation.','פעולה זו לא אושרה. יש לבדוק את ההצעה המרועננת לפני אישור נוסף.'):flow.phase==='unknown'?t('Do not submit a replacement or cash entry. Check the original operation; an absent result stays unresolved.','אין לשלוח פעולה חלופית או רישום מזומן. יש לבדוק את הפעולה המקורית; תוצאה חסרה נשארת לא פתורה.'):flow.phase==='refresh_required'?t('Do not repeat the change. Refresh the authorized offer status.','אין לחזור על השינוי. יש לרענן את מצב ההצעה המורשה.'):t('No state change is inferred from an unconfirmed result.','אין הסקה על שינוי מצב מתוצאה שלא אושרה.')}</p><small>{t('Operation','פעולה')}: <bdi>{flow.command.operationId}</bdi></small>{flow.phase==='unknown'&&<Button variant="secondary" onClick={()=>void workflow.recover()}>{t('Check operation status','בדיקת מצב הפעולה')}</Button>}{flow.phase==='refresh_required'&&<Button variant="secondary" onClick={()=>void workflow.refresh()}>{t('Refresh status','רענון המצב')}</Button>}{(flow.phase==='conflict'||flow.phase==='rejected')&&<Button variant="secondary" onClick={()=>workflow.clear()}>{t('Review offer','בדיקת ההצעה')}</Button>}</aside>;
 const title=flow.phase==='confirmed'?t('Recorded · balance refreshed','נרשם · היתרה רועננה'):flow.phase==='conflict'?t('Balance changed · review again','היתרה השתנתה · נדרשת בדיקה נוספת'):flow.phase==='rejected'?t('Entry not accepted','הרישום לא התקבל'):flow.phase==='refresh_required'?t('Receipt confirmed · current balance unavailable','הקבלה אושרה · היתרה העדכנית אינה זמינה'):flow.phase==='unknown'?t('Operation outcome unknown','תוצאת הפעולה אינה ידועה'):t('Verifying payment state…','בודק את מצב התשלום…');
 return <aside className={styles.operation} role="status" aria-live="polite"><h2>{title}</h2><p>{flow.phase==='unknown'?t('Do not record it again. Check the same operation reference; an absent result remains unresolved.','אין לרשום שוב. יש לבדוק את אותו מזהה פעולה; תוצאה חסרה נשארת לא פתורה.'):flow.phase==='refresh_required'?t('No additional entry is needed. Refresh the authoritative balance.','אין צורך ברישום נוסף. יש לרענן את היתרה המוסמכת.'):flow.phase==='confirmed'?t('The displayed balance comes from fresh authorized readback.','היתרה המוצגת מגיעה מקריאה מורשית ועדכנית.'):flow.phase==='conflict'?t('Nothing was confirmed from the stale form. Review the refreshed balance before a new entry.','לא אושר דבר מהטופס הישן. יש לבדוק את היתרה המרועננת לפני רישום חדש.'):t('No optimistic payment result is shown.','לא מוצגת תוצאת תשלום משוערת.')}</p>{showDetails&&<small>{t('Operation','פעולה')}: <bdi>{flow.command.operationId}</bdi></small>}{showDetails&&flow.phase==='unknown'&&<Button variant="secondary" onClick={()=>void workflow.recover()}>{t('Check operation status','בדיקת מצב הפעולה')}</Button>}{showDetails&&flow.phase==='refresh_required'&&<Button variant="secondary" onClick={()=>void workflow.refresh()}>{t('Refresh balance','רענון יתרה')}</Button>}{(flow.phase==='conflict'||flow.phase==='rejected')&&<Button variant="secondary" onClick={()=>workflow.clear()}>{t('Review details','בדיקת פרטים')}</Button>}</aside>;
}
function BillingDialog({locale,modal,update,edit,close,review,flow,workflow,data,childName}:{locale:'en'|'he';modal:MoneyModal;update:(p:Partial<MoneyModal>)=>void;edit:(p:Partial<MoneyModal>)=>void;close:()=>void;review:(e:FormEvent)=>Promise<void>;flow:BillingWorkflowState;workflow:BillingWorkflow;data:BillingData;childName:(id:string)=>string}){
 const ref=useOwnerDialog(),id=useId(),t=(en:string,he:string)=>locale==='he'?he:en;
 const busy=workflow.unresolved(),done=flow.phase==='confirmed',reviewing=modal.review!==null;
 return <dialog ref={ref} className={styles.dialog} aria-labelledby={`${id}-title`} onCancel={e=>{e.preventDefault();close();}}><header className={styles.dialogHeader}><h2 id={`${id}-title`}>{modal.kind==='cash'?t('Record cash received','רישום מזומן שהתקבל'):t('Correct cash entry','תיקון רישום מזומן')}</h2><Button variant="quiet" aria-label={t('Close dialog','סגירת החלון')} onClick={close}>×</Button></header><div className={styles.dialogBody}>
  {done?<><p role="status">{t('Receipt confirmed and balance refreshed.','הקבלה אושרה והיתרה רועננה.')}</p><Button onClick={close}>{t('Done','סיום')}</Button></>:busy?<><WorkflowNotice flow={flow} workflow={workflow} locale={locale} showDetails/><p>{t('Closing this dialog does not cancel or resolve the operation.','סגירת החלון אינה מבטלת או פותרת את הפעולה.')}</p></>:reviewing?<>
   <p>{t('Confirm the real amount and allocation before recording.','יש לאמת את הסכום שהתקבל ואת החלוקה לפני הרישום.')}</p><strong className={`${styles.confirmAmount} ${styles.money}`}>{money(modal.review!.amountMinor,locale)}</strong>
   <dl className={styles.confirmFacts}>{modal.review!.allocations.map(a=>{const l=data.quote.lines.find(l=>l.id===a.lineId)!;return <div key={a.lineId}><dt><bdi>{childName(l.childId)}</bdi></dt><dd className={styles.money}>{money(a.amountMinor,locale)}</dd></div>;})}</dl>
   <p>{t('Unallocated amount','סכום שלא הוקצה')}: <bdi className={styles.money}>{money(unallocatedAmount(modal.review!.amountMinor,modal.review!.allocations),locale)}</bdi></p><p className={styles.help}>{modal.kind==='cash'?t('Any unallocated money remains separate; it does not reduce a child’s balance.','כסף שלא הוקצה נשאר בנפרד; הוא אינו מפחית את יתרת הילד.'):t('Only the stated allocations are reversed. Any unallocated reversal corrects the original unallocated money.','רק ההקצאות המוצגות מתוקנות. סכום תיקון שלא הוקצה מתקן כסף שלא הוקצה ברישום המקורי.')}</p>
   {'receivedDate' in modal.review!&&<p>{t('Received date · Florida','תאריך קבלה · פלורידה')}: <bdi><time dateTime={modal.review!.receivedDate}>{modal.review!.receivedDate}</time></bdi> · {t('Date only; no receipt time inferred.','תאריך בלבד; לא נקבעת שעת קבלה משוערת.')}</p>}
   {'reason' in modal.review!&&<><p>{t('Reason','סיבה')}: <bdi>{(modal.review! as {reason:string}).reason}</bdi></p><p>{t('This corrects the recorded cash entry; it does not send a refund. The original is retained.','פעולה זו מתקנת רישום מזומן; היא אינה מבצעת החזר. הרישום המקורי נשמר.')}</p></>}
   {data.balance.revision!==modal.review!.expectedVersion&&<p role="alert">{t('The balance changed. Return to the form and review again.','היתרה השתנתה. יש לחזור לטופס ולבדוק שוב.')}</p>}
   <div className={styles.actions}><Button disabled={data.balance.revision!==modal.review!.expectedVersion} onClick={()=>void workflow.submit(modal.kind,modal.review,data)}>{t('Confirm entry','אישור הרישום')}</Button><Button variant="secondary" onClick={()=>update({review:null})}>{t('Back to edit','חזרה לעריכה')}</Button></div>
  </>:<form onSubmit={e=>void review(e)}>
   {modal.error&&<p className={styles.error} role="alert">{modal.error}</p>}
   <Input id={`${id}-amount`} label={modal.kind==='cash'?t('Amount received (USD)','סכום שהתקבל (דולר)'):t('Amount to reverse (USD)','סכום לתיקון (דולר)')} value={modal.amount} inputMode="decimal" dir="ltr" required onChange={e=>edit({amount:e.target.value,...(modal.kind==='cash'&&modal.lineIds.length===1?{allocations:{[modal.lineIds[0]!]:e.target.value}}:{})})}/>
   {modal.kind==='cash'&&<Input id={`${id}-date`} label={t('Actual received date · Florida','תאריך קבלה בפועל · פלורידה')} type="date" required value={modal.date} onChange={e=>edit({date:e.target.value})} help={t('Saved as the Florida calendar date. No receipt time is inferred.','נשמר כתאריך בלוח השנה בפלורידה. לא נקבעת שעת קבלה משוערת.')}/>}
   <fieldset className={styles.allocationFields}><legend>{t('Allocate to children and periods','חלוקה לילדים ולתקופות')}</legend>{modal.lineIds.map((lineId,i)=>{const l=data.quote.lines.find(l=>l.id===lineId)!;return <Input key={lineId} id={`${id}-line-${i}`} label={`${childName(l.childId)} · ${dateText(l.period.startsAt,locale)}`} value={modal.allocations[lineId]??''} inputMode="decimal" dir="ltr" required onChange={e=>edit({allocations:{...modal.allocations,[lineId]:e.target.value}})}/>;})}<p className={styles.help}>{t('Allocations may be lower than the total. Review the unallocated amount separately before confirming.','סכום החלוקה יכול להיות נמוך מהסכום הכולל. יש לבדוק בנפרד את הסכום שלא הוקצה לפני האישור.')}</p></fieldset>
   {modal.kind==='reversal'&&<Textarea id={`${id}-reason`} label={t('Correction reason','סיבת התיקון')} required maxLength={500} rows={3} value={modal.reason} onChange={e=>edit({reason:e.target.value})}/>}
   <div className={styles.actions}><Button type="submit" busy={modal.preparing}>{t('Review entry','בדיקת הרישום')}</Button><Button variant="secondary" onClick={close}>{t('Cancel','ביטול')}</Button></div>
  </form>}
 </div></dialog>;
}
