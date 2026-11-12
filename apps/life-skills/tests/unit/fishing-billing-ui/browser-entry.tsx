/** Isolated synthetic component harness. Never imported by an application route. */
import {createRoot} from 'react-dom/client';
import {OwnerBillingPanel} from '../../../src/features/fishing-billing-ui/owner-billing-panel.tsx';
import {BillingWorkflow} from '../../../src/features/fishing-billing-ui/workflow.ts';
import {type BillingData,type BillingUiPorts,type BillingView,type BillingOperationReceipt} from '../../../src/features/fishing-billing-ui/model.ts';
import {serializedBillingViewFixtures} from '../../../src/features/fishing-billing/view-fixtures.ts';
import {syntheticId,syntheticReceipt} from '../../../src/features/fishing-billing/fixtures.ts';
import {projectBalanceV2,dateCashReceiptSchema,BILLING_DTO_V2} from '../../../src/features/fishing-billing/contracts-v2.ts';
import {syntheticDateCashFixtures} from '../../../src/features/fishing-billing/fixtures-v2.ts';

const params=new URLSearchParams(location.search),locale=params.get('locale')==='he'?'he':'en';
const views=(JSON.parse(serializedBillingViewFixtures()) as {views:Record<string,BillingView>}).views;
for(const v of Object.values(views)){if(v.state==='ready')v.data.balance.version=BILLING_DTO_V2;else if(v.state==='conflict')v.current.balance.version=BILLING_DTO_V2;}
const mixed=syntheticDateCashFixtures();views.twoChildPartial={state:'ready',data:{quote:mixed.quote,balance:mixed.balance}};
const view=views[params.get('state')??'twoChildPartial']??views.twoChildPartial!;
const mode=params.get('mode')??'confirmed';
const observedAt='2035-01-06T15:00:00Z';
const qa={commands:[] as string[],lookups:[] as string[],generated:0};
(window as Window&{billingUiQa?:typeof qa}).billingUiQa=qa;
let current:BillingData=view.state==='ready'?view.data:view.state==='conflict'?view.current:(views.twoChildPartial! as Extract<BillingView,{state:'ready'}>).data;
let known:BillingOperationReceipt|null=null;
const ports:BillingUiPorts={
 nextOperationId:()=>{qa.generated++;return syntheticId(800+qa.generated);},
 async recordCashDate(command){
  qa.commands.push(command.operationId);
  if(mode==='conflict'){
   current={...current,quote:{...current.quote,revision:current.quote.revision+1}};
   current.balance=projectBalanceV2(current.quote,current.balance.receipts);
   return {kind:'conflict',current};
  }
  const quote={...current.quote,revision:current.quote.revision+1};
  const raw:Record<string,unknown>={...syntheticReceipt('cash',10,command.amountMinor,850),operationId:command.operationId,recordedAt:observedAt,allocations:command.allocations};delete raw.receivedAt;
  const saved=dateCashReceiptSchema.parse({...raw,receivedPrecision:command.receivedPrecision,receivedDate:command.receivedDate,timeZone:command.timeZone});
  current={quote,balance:projectBalanceV2(quote,[...current.balance.receipts,saved])};
  known={version:BILLING_DTO_V2,sourceVersion:BILLING_DTO_V2,operationId:command.operationId,entityId:quote.id,entityVersion:quote.revision,replayed:false,result:{...current,receiptId:saved.id}};
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
createRoot(document.getElementById('root')!).render(<OwnerBillingPanel locale={locale} view={view} subject={subject} workflow={new BillingWorkflow(enabled?ports:null)} observedAt={observedAt} cashAllowed={enabled} reversalAllowed={enabled}/>);
