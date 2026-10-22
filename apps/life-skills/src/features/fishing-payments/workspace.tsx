import type { FamilyPaymentView,FamilyHostedAction } from './domain.ts';
import type { paymentActuals } from './projections.ts';

const words={en:{title:'Fishing payments',empty:'No payment records available.',stage:'Twelve-session stage',total:'Agreed total',paid:'Paid',refund:'Refunded',one:'Stage payment',due:'Payment',of:'of',separate:'Enrollment and the session schedule are confirmed separately.',states:{unpaid:'Unpaid',pending:'Payment pending',action_required:'Payment needs your attention',failed:'Payment attempt failed',part_paid:'Part paid',paid:'Paid',refund_recorded:'Refund recorded',reconciliation_required:'Payment under review'}},he:{title:'תשלומי תוכנית הדיג',empty:'אין רשומות תשלום להצגה.',stage:'שלב של שנים עשר מפגשים',total:'סכום מוסכם',paid:'שולם',refund:'הוחזר',one:'תשלום עבור השלב',due:'תשלום',of:'מתוך',separate:'ההרשמה ולוח המפגשים מאושרים בנפרד.',states:{unpaid:'טרם שולם',pending:'התשלום בטיפול',action_required:'נדרשת פעולה להשלמת התשלום',failed:'ניסיון התשלום נכשל',part_paid:'שולם חלקית',paid:'שולם',refund_recorded:'נרשם החזר',reconciliation_required:'התשלום בבדיקה'}}};
/** MAIN mounts only already-authorized family DTOs. No provider IDs or merchant
 * secrets are accepted here; payment never claims enrollment or trip clearance. */
export function FishingFamilyPayments({payments,actions=[],locale='en'}:{payments:readonly FamilyPaymentView[];actions?:readonly FamilyHostedAction[];locale?:'en'|'he'}){
 const t=words[locale],language=locale==='he'?'he-IL':'en-US',money=(n:number)=>new Intl.NumberFormat(language,{style:'currency',currency:'USD'}).format(n/100);
 return <section aria-label={t.title} dir={locale==='he'?'rtl':'ltr'}><h2>{t.title}</h2>{payments.length===0?<p>{t.empty}</p>:payments.map(p=><article key={p.purchaseId} className="panel">
  <h3>{t.stage}</h3><p role="status">{t.states[p.state]}</p><dl><dt>{t.total}</dt><dd>{money(p.totalCents)}</dd><dt>{t.paid}</dt><dd>{money(p.paidCents)}</dd><dt>{t.refund}</dt><dd>{money(p.refundedCents)}</dd></dl>
  <ol>{p.dues.map(d=><li key={d.index}><strong>{p.dues.length===1?t.one:`${t.due} ${d.index} ${t.of} 3`}</strong>: {money(d.amountCents)} · <time dateTime={d.dueAt}>{new Intl.DateTimeFormat(language,{timeZone:'America/New_York',dateStyle:'medium'}).format(new Date(d.dueAt))}</time> · {t.states[d.state]}</li>)}</ol>
  {actions.filter(a=>a.purchaseId===p.purchaseId&&a.state==='ready'&&p.dues.some(d=>d.index===a.dueIndex&&d.paidCents<d.amountCents)).map(a=><p key={a.dueIndex}><a href={a.url} rel="noreferrer">{locale==='he'?`לתשלום ${a.dueIndex}`:`Pay payment ${a.dueIndex}`}</a></p>)}
  <p>{t.separate}</p>
 </article>)}</section>;
}

export function FishingPaymentActuals({actuals}:{actuals:Awaited<ReturnType<typeof paymentActuals>>}){
 const money=(n:number|null)=>n===null?'Unavailable':new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100);
 return <section aria-label="Fishing payment actuals"><h2>Fishing payment actuals</h2><p>As of <time dateTime={actuals.asOf}>{actuals.asOf}</time></p>
  <dl><dt>Families</dt><dd>{actuals.households}</dd><dt>Child purchases</dt><dd>{actuals.childPurchases}</dd><dt>Founder families claimed</dt><dd>{actuals.founderClaimed}</dd><dt>Founder families reserved</dt><dd>{actuals.founderReserved}</dd>
  <dt>Received payments</dt><dd>{money(actuals.cashReceivedCents)}</dd><dt>Recorded refunds</dt><dd>{money(actuals.refundsCents)}</dd><dt>Original unpaid dues</dt><dd>{money(actuals.originalContractUnpaidCents)}</dd><dt>Actual processor fees</dt><dd>{money(actuals.actualFeesCents)}</dd><dt>Provider operations under review</dt><dd>{actuals.unknownProviderOperations??'Unavailable'}</dd></dl>
  <p>Processor settlement, earned service, remaining sessions and forecasts require their own verified records.</p>
 </section>;
}
