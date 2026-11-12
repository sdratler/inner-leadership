import {z} from 'zod';
import {billingId} from '../features/fishing-billing/contracts.ts';
import {prepareCardCommandSchema} from '../features/fishing-billing/card-contracts.ts';
import {billingOwnerSnapshotV2Schema} from './fishing-billing-owner-contract-v2.ts';
import {FISHING_BILLING_CARD_OWNER_PATH,billingCardOwnerCommandSchema,billingCardOwnerReadSchema,type BillingCardOwnerCommand,type BillingCardOwnerRead} from './fishing-billing-card-owner-contract.ts';

type Snapshot=z.infer<typeof billingOwnerSnapshotV2Schema>;
export type BillingCardOwnerScope=Readonly<{quoteId:string;familyId:string;workspaceId:string}>;
type Prepared=Extract<BillingCardOwnerRead,{state:'prepared'}>;
type Attempt=Extract<BillingCardOwnerRead,{state:'attempt'}>;
export type BillingCardOwnerOutcome=
 | {kind:'prepared';data:Prepared}
 | {kind:'attempt';data:Attempt}
 | {kind:'conflict';current:Snapshot}
 | {kind:'rejected';code:'INVALID_REQUEST'|'FORBIDDEN'}
 | {kind:'unknown'};
type Options={
 origin:string;scope:BillingCardOwnerScope;csrf:()=>Promise<string>;
 /** Explicit adapters only: no default fetch, credential or storage lookup. */
 transport:(request:Request)=>Promise<Response>;
 readCurrent:(quoteId:string,signal:AbortSignal)=>Promise<Snapshot>;timeoutMs?:number;
};
const success=z.object({ok:z.literal(true),data:billingCardOwnerReadSchema,requestId:billingId}).strict();
const failure=z.object({ok:z.literal(false),error:z.object({code:z.string()}).strict(),requestId:billingId}).strict();
const unavailable=()=>new Error('BILLING_CARD_READBACK_UNAVAILABLE');

/** A known attempt is not a confirmed payment. Its own state can remain UNKNOWN.
 * This adapter never generates IDs, resends, replaces an absent operation or
 * follows a Checkout URL. The owner UI retains the original attempt reference. */
export function createFishingBillingCardOwnerClient(options:Options){
 const url=new URL(options.origin),origin=url.origin,scope=Object.freeze({...options.scope});
 if(url.protocol!=='https:'||origin!==options.origin||url.username||url.password)throw unavailable();
 Object.values(scope).forEach(id=>billingId.parse(id));
 if(typeof options.transport!=='function'||typeof options.csrf!=='function'||typeof options.readCurrent!=='function')throw unavailable();
 const milliseconds=options.timeoutMs??10000;
 if(!Number.isSafeInteger(milliseconds)||milliseconds<1||milliseconds>30000)throw unavailable();
 const transport=options.transport,csrf=options.csrf,readCurrent=options.readCurrent;
 function current(raw:Snapshot,minimumVersion=1){
  const data=billingOwnerSnapshotV2Schema.parse(raw),q=data.quote,b=data.balance;
  if(q.id!==scope.quoteId||q.familyId!==scope.familyId||q.workspaceId!==scope.workspaceId||b.quoteId!==q.id||b.familyId!==q.familyId||b.revision!==q.revision||q.revision<minimumVersion)throw unavailable();
  return data;
 }
 function projected<T extends Prepared|Attempt>(data:T,attemptId:string):T{
  const a=data.attempt;
  if(a.id!==attemptId||a.command.operationId!==attemptId||a.quoteId!==scope.quoteId||a.command.quoteId!==scope.quoteId||a.familyId!==scope.familyId||a.workspaceId!==scope.workspaceId||a.preparation.operationId!==attemptId||a.preparation.quoteId!==scope.quoteId||a.preparation.result.attemptId!==attemptId||a.preparation.entityVersion>a.balanceVersion||a.preparation.entityVersion!==a.command.expectedVersion+1||a.preparation.result.amountMinor!==a.command.selection.reduce((sum,line)=>sum+line.amountMinor,0)||JSON.stringify(a.preparation.result.allocations)!==JSON.stringify(a.command.selection))throw unavailable();
  const fresh=current(data.current,a.balanceVersion),q=fresh.quote,b=fresh.balance;
  if(new Set(a.command.selection.map(line=>line.lineId)).size!==a.command.selection.length||a.command.selection.some(line=>!q.lines.some(currentLine=>currentLine.id===line.lineId)))throw unavailable();
  if(data.state==='prepared'&&(data.receipt.operationId!==attemptId||data.receipt.quoteId!==scope.quoteId||data.receipt.result.attemptId!==attemptId||data.receipt.entityVersion!==a.preparation.entityVersion||data.receipt.result.amountMinor!==a.preparation.result.amountMinor||JSON.stringify(data.receipt.result.allocations)!==JSON.stringify(a.preparation.result.allocations)))throw unavailable();
  if(data.checkoutUrl){
   const target=new URL(data.checkoutUrl);
   if(target.origin!=='https://checkout.stripe.com'||target.username||target.password||a.state!=='open'||a.balanceVersion!==q.revision||q.state!=='accepted'||q.paused||b.cancelled||b.remainingMinor<=0||b.excessMinor||b.missingPolicy.length)throw unavailable();
  }
  return {...data,current:fresh};
 }
 async function bounded<T>(work:(controller:AbortController,setCancel:(cancel:()=>void)=>void)=>Promise<T>){
  const controller=new AbortController();let cancel:()=>void=()=>{};let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();cancel();reject(unavailable());},milliseconds);});
  try{return await Promise.race([work(controller,value=>{cancel=value;}),timeout]);}finally{clearTimeout(timer);}
 }
 async function exchange(kind:'attempt'|'operation'|null,id:string|null,command?:BillingCardOwnerCommand){
  return bounded(async(controller,setCancel)=>{
   const endpoint=new URL(FISHING_BILLING_CARD_OWNER_PATH,origin);
   if(kind&&id){endpoint.searchParams.set('kind',kind);endpoint.searchParams.set('quoteId',scope.quoteId);endpoint.searchParams.set('id',id);}
   const headers:Record<string,string>={accept:'application/json'};
   if(command){const token=await csrf();if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw unavailable();headers['content-type']='application/json';headers['x-csrf-token']=token;}
   if(controller.signal.aborted)throw unavailable();
   const response=await transport(new Request(endpoint,{method:command?'POST':'GET',headers,credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,...(command?{body:JSON.stringify(command)}:{})}));
   if(response.redirected||response.url&&response.url!==endpoint.href||response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json'||!response.body)throw unavailable();
   const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let text='',size=0,reads=0;
   const cancel=()=>{try{void reader.cancel().catch(()=>{});}catch{}};setCancel(cancel);
   try{
    for(;;){if(controller.signal.aborted||++reads>20000)throw unavailable();const part=await reader.read();if(part.done)break;size+=part.value.byteLength;if(size>2000000)throw unavailable();text+=decoder.decode(part.value,{stream:true});}
    text+=decoder.decode();return {status:response.status,body:JSON.parse(text) as unknown};
   }finally{cancel();try{reader.releaseLock();}catch{}}
  });
 }
 async function readAttempt(attemptId:string){
  const id=billingId.parse(attemptId),r=await exchange('attempt',id),ok=success.safeParse(r.body);
  if(r.status!==200||!ok.success||ok.data.data.state!=='attempt')throw unavailable();return projected(ok.data.data,id);
 }
 async function readOperation(operationId:string){
  const id=billingId.parse(operationId),r=await exchange('operation',id),ok=success.safeParse(r.body);
  if(r.status!==200||!ok.success)throw unavailable();const data=ok.data.data;
  if(data.state==='unresolved'){if(data.quoteId!==scope.quoteId||data.operationId!==id)throw unavailable();return null;}
  if(data.state!=='prepared')throw unavailable();return projected(data,id);
 }
 async function mutate(raw:unknown):Promise<BillingCardOwnerOutcome>{
  const parsed=billingCardOwnerCommandSchema.safeParse(raw);if(!parsed.success)return {kind:'rejected',code:'INVALID_REQUEST'};
  const command=parsed.data;if(command.command.quoteId!==scope.quoteId)return {kind:'rejected',code:'FORBIDDEN'};
  const id=command.action==='prepare'?command.command.operationId:command.command.attemptId;
  try{
   const r=await exchange(null,null,command),ok=success.safeParse(r.body);
   if(r.status===200&&ok.success){
    const data=ok.data.data;
    if(command.action==='prepare'&&data.state==='prepared'){
     const checked=projected(data,id);if(JSON.stringify(prepareCardCommandSchema.parse(checked.attempt.command))!==JSON.stringify(command.command))throw unavailable();return {kind:'prepared',data:checked};
    }
    if(command.action==='create_checkout'&&data.state==='attempt')return {kind:'attempt',data:projected(data,id)};
    throw unavailable();
   }
   const error=failure.safeParse(r.body);if(!error.success)return {kind:'unknown'};
   if(r.status===400&&error.data.error.code==='INVALID_REQUEST')return {kind:'rejected',code:'INVALID_REQUEST'};
   if(r.status===401&&error.data.error.code==='UNAUTHENTICATED'||r.status===403&&error.data.error.code==='FORBIDDEN')return {kind:'rejected',code:'FORBIDDEN'};
   if(r.status===409&&error.data.error.code==='CONFLICT')return {kind:'conflict',current:current(await bounded(controller=>readCurrent(scope.quoteId,controller.signal)),command.action==='prepare'?command.command.expectedVersion:1)};
   return {kind:'unknown'};
  }catch{return {kind:'unknown'};}
 }
 return Object.freeze({readAttempt,readOperation,prepare:(command:unknown)=>mutate({action:'prepare',command}),createCheckout:(attemptId:string)=>mutate({action:'create_checkout',command:{quoteId:scope.quoteId,attemptId}})});
}
