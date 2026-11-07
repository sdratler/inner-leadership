/** Isolated synthetic component harness. Never imported by an application route. */
import {createRoot} from 'react-dom/client';
import {OwnerBillingPanel} from '../../../src/features/fishing-billing-ui/owner-billing-panel.tsx';
import {BillingWorkflow} from '../../../src/features/fishing-billing-ui/workflow.ts';
import {floridaDate,type BillingData,type BillingUiPorts,type BillingView} from '../../../src/features/fishing-billing-ui/model.ts';
import {serializedBillingViewFixtures} from '../../../src/features/fishing-billing/view-fixtures.ts';
import {syntheticId,syntheticNow,syntheticReceipt} from '../../../src/features/fishing-billing/fixtures.ts';
import {projectBalance} from '../../../src/features/fishing-billing/domain.ts';
import {BILLING_DTO_VERSION,type BillingOperationReceipt} from '../../../src/features/fishing-billing/contracts.ts';

const params=new URLSearchParams(location.search),locale=params.get('locale')==='he'?'he':'en';
const views=(JSON.parse(serializedBillingViewFixtures()) as {views:Record<string,BillingView>}).views;
const view=views[params.get('state')??'twoChildPartial']??views.twoChildPartial!;
const mode=params.get('mode')??'confirmed';
const qa={commands:[] as string[],lookups:[] as string[],generated:0};
(window as Window&{billingUiQa?:typeof qa}).billingUiQa=qa;
let current:BillingData=view.state==='ready'?view.data:view.state==='conflict'?view.current:(views.twoChildPartial! as Extract<BillingView,{state:'ready'}>).data;
let known:BillingOperationReceipt|null=null;
const ports:BillingUiPorts={
 nextOperationId:()=>{qa.generated++;return syntheticId(800+qa.generated);},
 resolveReceivedDate:async date=>{
  if(mode==='deferred')return new Promise(resolve=>{(window as Window&{releaseBillingDate?:()=>void}).releaseBillingDate=()=>resolve({receivedAt:syntheticNow,observedAt:syntheticNow});});
  return mode!=='date-unavailable'&&date===floridaDate(syntheticNow)?{receivedAt:syntheticNow,observedAt:syntheticNow}:null;
 },
 async recordCash(command){
  qa.commands.push(command.operationId);
  if(mode==='conflict'){
   current={...current,quote:{...current.quote,revision:current.quote.revision+1}};
   current.balance=projectBalance(current.quote,current.balance.receipts);
   return {kind:'conflict',current};
  }
  const quote={...current.quote,revision:current.quote.revision+1};
  const saved={...syntheticReceipt('cash',10,command.amountMinor,850),operationId:command.operationId,receivedAt:command.receivedAt,allocations:command.allocations};
  current={quote,balance:projectBalance(quote,[...current.balance.receipts,saved])};
  known={version:BILLING_DTO_VERSION,operationId:command.operationId,entityId:quote.id,entityVersion:quote.revision,replayed:false,result:{...current,receiptId:saved.id}};
  return mode==='unknown'||mode==='unresolved'?{kind:'unknown'}:{kind:'confirmed',receipt:known,current};
 },
 async reverseCash(command){qa.commands.push(command.operationId);return {kind:'unknown'};},
 async readOperation(operationId){qa.lookups.push(operationId);return mode==='unresolved'||!known?null:{receipt:known,current};},
 async readBalance(){return current;},
};
const long=params.get('long')==='1';
const subject={familyId:syntheticId(4),label:locale==='he'?'משפחה סינתטית לבדיקת רכיב בלבד':'SYNTHETIC component-test family',children:[
 {id:syntheticId(20),name:locale==='he'?(long?'אריאל בן משפחה ארוכה לבדיקת גלישה וקריאות':'אריאל סינתטי'):'SYNTHETIC Ari'},
 {id:syntheticId(21),name:locale==='he'?(long?'נועם בעל שם ארוך לבדיקת חלוקה בין שני ילדים':'נועם סינתטי'):'SYNTHETIC Noam'},
]};
const enabled=mode!=='disabled';
createRoot(document.getElementById('root')!).render(<OwnerBillingPanel locale={locale} view={view} subject={subject} workflow={new BillingWorkflow(enabled?ports:null)} observedAt={syntheticNow} cashAllowed={enabled} reversalAllowed={enabled}/>);
