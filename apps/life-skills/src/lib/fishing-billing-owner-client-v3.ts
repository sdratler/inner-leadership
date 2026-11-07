import {z} from 'zod';
import {billingId} from '../features/fishing-billing/contracts.ts';
import {FISHING_BILLING_OWNER_V3_PATH,OWNER_RESPONSE_MAX_BYTES,ownerCurrentV3Schema,billingOwnerCommandV3Schema,billingOwnerReadV3Schema,type BillingOwnerCommandV3,type OwnerMoneyReceiptV3} from './fishing-billing-owner-contract-v3.ts';

type Snapshot=z.infer<typeof ownerCurrentV3Schema>;
export type BillingOwnerMutationOutcomeV3=
 | {kind:'confirmed';receipt:OwnerMoneyReceiptV3;current:Snapshot}
 | {kind:'conflict';current:Snapshot}
 | {kind:'rejected';code:'INVALID_REQUEST'|'FORBIDDEN'}
 | {kind:'unknown'};
export type BillingOwnerClientScopeV3=Readonly<{quoteId:string;familyId:string;workspaceId:string}>;
type Options={
 origin:string;scope:BillingOwnerClientScopeV3;csrf:()=>Promise<string>;
 /** Explicit composition only; no default fetch, storage, session or provider. */
 transport:(request:Request)=>Promise<Response>;timeoutMs?:number;
};
const success=z.object({ok:z.literal(true),data:billingOwnerReadV3Schema,requestId:billingId}).strict();
const failure=z.object({ok:z.literal(false),error:z.object({code:z.string()}).strict(),requestId:billingId}).strict();
const unavailable=()=>new Error('BILLING_READBACK_UNAVAILABLE');

/** Inert same-origin client adapter. It never creates operation IDs or retries.
 * HTTP503, network failures, malformed replies and timeouts are UNKNOWN, even
 * when the originating server might have rejected before attempting a save. */
export function createFishingBillingOwnerClientV3(options:Options){
 const url=new URL(options.origin),origin=url.origin,scope=Object.freeze({...options.scope});
 if(url.protocol!=='https:'||url.origin!==options.origin||url.username||url.password)throw unavailable();
 Object.values(scope).forEach(id=>billingId.parse(id));
 if(typeof options.transport!=='function'||typeof options.csrf!=='function')throw unavailable();
 const milliseconds=options.timeoutMs??10_000;
 if(!Number.isSafeInteger(milliseconds)||milliseconds<1||milliseconds>30_000)throw unavailable();
 const transport=options.transport,csrf=options.csrf;
 function scoped(raw:Snapshot,minimumVersion=1){
  const data=ownerCurrentV3Schema.parse(raw),q=data.quote,b=data.balance;
  if(q.id!==scope.quoteId||q.familyId!==scope.familyId||q.workspaceId!==scope.workspaceId||
   b.quoteId!==q.id||b.familyId!==q.familyId||b.revision!==q.revision||q.revision<minimumVersion)throw unavailable();
  return data;
 }
 function confirmed(data:Extract<z.infer<typeof billingOwnerReadV3Schema>,{state:'confirmed'}>,operationId:string,action?:BillingOwnerCommandV3['action']){
  const receipt=data.receipt,q=receipt.result.quote,b=receipt.result.balance;
  if(receipt.operationId!==operationId||action!==undefined&&receipt.action!==action||receipt.entityId!==scope.quoteId||q.id!==scope.quoteId||
   q.familyId!==scope.familyId||q.workspaceId!==scope.workspaceId||receipt.entityVersion!==q.revision||
   b.quoteId!==q.id||b.familyId!==q.familyId||b.revision!==q.revision)throw unavailable();
  return {receipt,current:scoped(data.current,receipt.entityVersion)};
 }
 async function exchange(kind:'balance'|'operation'|null,id:string|null,command?:BillingOwnerCommandV3){
  const controller=new AbortController();let cancelBody:(()=>void)|undefined;
  let timer:ReturnType<typeof setTimeout>|undefined;
  const timeout=new Promise<never>((_resolve,reject)=>{timer=setTimeout(()=>{controller.abort();cancelBody?.();reject(unavailable());},milliseconds);});
  const work=(async()=>{
   const endpoint=new URL(FISHING_BILLING_OWNER_V3_PATH,origin);
   if(kind&&id){endpoint.searchParams.set('kind',kind);endpoint.searchParams.set('id',id);}
   const headers:Record<string,string>={accept:'application/json'};
   if(command){
    const token=await csrf();if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw unavailable();
    headers['content-type']='application/json';headers['x-csrf-token']=token;
   }
   if(controller.signal.aborted)throw unavailable();
   const response=await transport(new Request(endpoint,{method:command?'POST':'GET',headers,
    credentials:'same-origin',mode:'same-origin',redirect:'error',cache:'no-store',signal:controller.signal,
    ...(command?{body:JSON.stringify(command)}:{}),
   }));
   if(response.redirected||response.url&&response.url!==endpoint.href||
    response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json'||!response.body)throw unavailable();
   const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,reads=0,text='';
   cancelBody=()=>{try{void reader.cancel().catch(()=>{});}catch{/* Keep private transport errors out of replies. */}};
   try{
    for(;;){
     if(controller.signal.aborted||++reads>20_000)throw unavailable();
     const part=await reader.read();if(part.done)break;
     size+=part.value.byteLength;if(size>OWNER_RESPONSE_MAX_BYTES)throw unavailable();
     text+=decoder.decode(part.value,{stream:true});
    }
    text+=decoder.decode();return {status:response.status,body:JSON.parse(text) as unknown};
   }finally{cancelBody();try{reader.releaseLock();}catch{/* Timed-out read may still be settling. */}}
  })();
  try{return await Promise.race([work,timeout]);}finally{clearTimeout(timer);}
 }
 async function readBalance(quoteId:string){
  if(quoteId!==scope.quoteId)throw unavailable();
  const r=await exchange('balance',billingId.parse(quoteId)),parsed=success.safeParse(r.body);
  if(r.status!==200||!parsed.success||parsed.data.data.state!=='ready')throw unavailable();
  return scoped(parsed.data.data.current);
 }
 async function readOperation(operationId:string){
  const id=billingId.parse(operationId),r=await exchange('operation',id),parsed=success.safeParse(r.body);
  if(r.status!==200||!parsed.success)throw unavailable();
  const data=parsed.data.data;
  if(data.state==='unresolved'){if(data.operationId!==id)throw unavailable();return null;}
  if(data.state!=='confirmed')throw unavailable();return confirmed(data,id);
 }
 async function mutate(raw:unknown):Promise<BillingOwnerMutationOutcomeV3>{
  const parsed=billingOwnerCommandV3Schema.safeParse(raw);
  if(!parsed.success)return {kind:'rejected',code:'INVALID_REQUEST'};
  const command=parsed.data;
  if(command.command.quoteId!==scope.quoteId)return {kind:'rejected',code:'FORBIDDEN'};
  try{
   const r=await exchange(null,null,command),ok=success.safeParse(r.body);
   if(r.status===200&&ok.success&&ok.data.data.state==='confirmed')return {kind:'confirmed',...confirmed(ok.data.data,command.command.operationId,command.action)};
   const error=failure.safeParse(r.body);
   if(!error.success)return {kind:'unknown'};
   if(r.status===400&&error.data.error.code==='INVALID_REQUEST')return {kind:'rejected',code:'INVALID_REQUEST'};
   if((r.status===401&&error.data.error.code==='UNAUTHENTICATED')||(r.status===403&&error.data.error.code==='FORBIDDEN'))return {kind:'rejected',code:'FORBIDDEN'};
   if(r.status===409&&error.data.error.code==='CONFLICT')return {kind:'conflict',current:await readBalance(scope.quoteId)};
   return {kind:'unknown'};
  }catch{return {kind:'unknown'};}
 }
 return Object.freeze({
  readBalance,readOperation,
  recordCashDate:(command:unknown)=>mutate({action:'cash_date',command}),
  reverseCash:(command:unknown)=>mutate({action:'reverse_cash',command}),
  setState:(command:unknown)=>mutate({action:'state',command}),
 });
}
