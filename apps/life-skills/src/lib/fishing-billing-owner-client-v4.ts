import {z} from 'zod';
import {billingId} from '../features/fishing-billing/contracts.ts';
import {BILLING_SERVICE_V4} from '../features/fishing-billing/guest-service-contract-v4.ts';
import {FISHING_BILLING_OWNER_V4_PATH,OWNER_SERVICE_RESPONSE_MAX_BYTES,ownerServiceOperationV4Schema,ownerServiceReadV4Schema,
 ownerServiceCurrentV4Schema,sameOwnerServiceValueV4,type OwnerServiceOperationV4,type OwnerServiceReadV4} from './fishing-billing-owner-contract-v4.ts';

const scopeSchema=z.object({workspaceId:billingId,actorId:billingId,quoteId:billingId,familyId:billingId,offerSha256:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
export type ServiceOwnerClientScopeV4=z.infer<typeof scopeSchema>;
export type PreparedServiceOwnerOperationV4=Readonly<{version:typeof BILLING_SERVICE_V4;operation:OwnerServiceOperationV4;serializedOperation:string}>;
export type ServiceOwnerOperationResultV4=
 | {kind:'confirmed';data:Extract<OwnerServiceReadV4,{state:'confirmed'}>}
 | {kind:'rejected_current_attempt';data:Extract<OwnerServiceReadV4,{state:'rejected_current_attempt'}>}
 | {kind:'unresolved';data:Extract<OwnerServiceReadV4,{state:'unresolved'}>}
 | {kind:'not_sent';code:'INVALID_REQUEST'|'FORBIDDEN'|'UNAVAILABLE'}
 | {kind:'unknown'};
export type ServiceOwnerClientOptionsV4={
 origin:string;scope:ServiceOwnerClientScopeV4;csrf:()=>Promise<string>;
 /** Mandatory inert composition port, not a default fetch or mounted route. */
 transport:(request:Request)=>Promise<Response>;timeoutMs?:number;
};
const success=z.object({ok:z.literal(true),data:ownerServiceReadV4Schema,requestId:billingId}).strict();
const preparedSchema=z.object({version:z.literal(BILLING_SERVICE_V4),operation:ownerServiceOperationV4Schema,serializedOperation:z.string().max(16_384)}).strict();
export function freezeServiceOwnerV4<T>(value:T):T{
 if(value&&typeof value==='object'){Object.values(value).forEach(freezeServiceOwnerV4);Object.freeze(value);}return value;
}
export function prepareServiceOwnerOperationV4(raw:unknown):PreparedServiceOwnerOperationV4{
 const operation=ownerServiceOperationV4Schema.parse(raw),serializedOperation=JSON.stringify(operation);
 if(new TextEncoder().encode(JSON.stringify({version:BILLING_SERVICE_V4,intent:'execute',operation})).byteLength>16_384)throw Error('SERVICE_COMMAND_TOO_LARGE');
 return freezeServiceOwnerV4({version:BILLING_SERVICE_V4,operation,serializedOperation});
}
export function preservedServiceOwnerOperationV4(raw:unknown):PreparedServiceOwnerOperationV4{
 const value=preparedSchema.parse(raw),prepared=prepareServiceOwnerOperationV4(value.operation);
 if(prepared.serializedOperation!==value.serializedOperation)throw Error('ORIGINAL_SERVICE_COMMAND_CHANGED');return prepared;
}
/** Browser correlation only; these fields do not authenticate or grant authority. */
export function serviceOwnerClientScopeV4(raw:unknown):Readonly<ServiceOwnerClientScopeV4>{return freezeServiceOwnerV4(scopeSchema.parse(raw));}
export function scopedServiceOwnerReadV4(raw:unknown,scope:ServiceOwnerClientScopeV4,pending?:PreparedServiceOwnerOperationV4):OwnerServiceReadV4{
 const data=ownerServiceReadV4Schema.parse(raw);
 if(data.state==='ready'){if(pending)throw Error('ORIGINAL_OPERATION_REQUIRED');}
 else{
  if(!pending||!sameOwnerServiceValueV4(data.operation,preservedServiceOwnerOperationV4(pending).operation))throw Error('ORIGINAL_OPERATION_MISMATCH');
  if(data.state==='confirmed'&&(data.receipt.actorId!==scope.actorId||data.receipt.workspaceId!==scope.workspaceId||data.receipt.familyId!==scope.familyId||data.receipt.offerSha256!==scope.offerSha256))throw Error('SERVICE_RECEIPT_SCOPE');
 }
 if('current' in data){const q=data.current.quote;
  if(q.id!==scope.quoteId||q.familyId!==scope.familyId||q.workspaceId!==scope.workspaceId||q.offer.sha256!==scope.offerSha256)throw Error('SERVICE_CURRENT_SCOPE');
 }
 if('operation' in data&&data.operation.command.quoteId!==scope.quoteId)throw Error('SERVICE_OPERATION_SCOPE');
 return freezeServiceOwnerV4(data);
}

/** Unmounted V4 only. Never creates IDs, retries, reads a journal by ID alone,
 * or treats an HTTP error as proof that a native mutation rolled back. */
export function createFishingBillingOwnerClientV4(options:ServiceOwnerClientOptionsV4){
 const url=new URL(options.origin),scope=serviceOwnerClientScopeV4(options.scope),milliseconds=options.timeoutMs??10_000;
 if(url.protocol!=='https:'||url.origin!==options.origin||url.username||url.password||typeof options.transport!=='function'||typeof options.csrf!=='function'||
  !Number.isSafeInteger(milliseconds)||milliseconds<1||milliseconds>30_000)throw Error('INVALID_SERVICE_CLIENT');
 const transport=options.transport,csrf=options.csrf,origin=url.origin;
 async function exchange(pending:PreparedServiceOwnerOperationV4|null,intent:'execute'|'recover'|null,external?:AbortSignal){
  const controller=new AbortController();let started=false,cancelBody:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined,stop=()=>{};
  const ended=new Promise<never>((_resolve,reject)=>{
   stop=()=>{controller.abort();cancelBody?.();reject(Error('SERVICE_READBACK_UNAVAILABLE'));};
   timer=setTimeout(stop,milliseconds);external?.addEventListener('abort',stop,{once:true});if(external?.aborted)stop();
  });
  const work=(async()=>{
   const endpoint=new URL(FISHING_BILLING_OWNER_V4_PATH,origin),headers:Record<string,string>={accept:'application/json'};
   if(pending){const token=await csrf();if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw Error('CSRF_UNAVAILABLE');headers['content-type']='application/json';headers['x-csrf-token']=token;}
   else{endpoint.searchParams.set('kind','balance');endpoint.searchParams.set('id',scope.quoteId);}
   if(controller.signal.aborted)throw Error('ABORTED');started=true;
   const response=await transport(new Request(endpoint,{method:pending?'POST':'GET',headers,signal:controller.signal,credentials:'same-origin',mode:'same-origin',
    redirect:'error',cache:'no-store',referrerPolicy:'no-referrer',...(pending?{body:`{"version":${JSON.stringify(BILLING_SERVICE_V4)},"intent":${JSON.stringify(intent)},"operation":${pending.serializedOperation}}`}:{}),
   }));
   if(controller.signal.aborted){void response.body?.cancel().catch(()=>{});throw Error('ABORTED');}
   if(response.redirected||response.url&&response.url!==endpoint.href||response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json'||!response.body){
    void response.body?.cancel().catch(()=>{});throw Error('INVALID_SERVICE_RESPONSE');
   }
   const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});let size=0,reads=0,text='';
   cancelBody=()=>{try{void reader.cancel().catch(()=>{});}catch{/* Private transport details are not UI data. */}};
   try{
    for(;;){if(controller.signal.aborted||++reads>20_000)throw Error('ABORTED');const chunk=await reader.read();if(chunk.done)break;
     size+=chunk.value.byteLength;if(size>OWNER_SERVICE_RESPONSE_MAX_BYTES+256)throw Error('SERVICE_RESPONSE_TOO_LARGE');text+=decoder.decode(chunk.value,{stream:true});}
    text+=decoder.decode();return {status:response.status,body:JSON.parse(text) as unknown};
   }finally{cancelBody();try{reader.releaseLock();}catch{/* An aborted stream may still be settling. */}}
  })();
  try{return {ok:true as const,value:await Promise.race([work,ended])};}
  catch{return {ok:false as const,started};}
  finally{clearTimeout(timer);external?.removeEventListener('abort',stop);}
 }
 async function operation(raw:PreparedServiceOwnerOperationV4,intent:'execute'|'recover',signal?:AbortSignal):Promise<ServiceOwnerOperationResultV4>{
  let pending:PreparedServiceOwnerOperationV4;
  try{pending=preservedServiceOwnerOperationV4(raw);}catch{return {kind:'not_sent',code:'INVALID_REQUEST'};}
  if(pending.operation.command.quoteId!==scope.quoteId)return {kind:'not_sent',code:'FORBIDDEN'};
  const response=await exchange(pending,intent,signal);
  if(!response.ok)return response.started?{kind:'unknown'}:{kind:'not_sent',code:'UNAVAILABLE'};
  try{
   if(response.value.status!==200)throw Error('UNKNOWN_HTTP_OUTCOME');
   const data=scopedServiceOwnerReadV4(success.parse(response.value.body).data,scope,pending);
   if(data.state==='confirmed')return {kind:'confirmed',data};
   if(data.state==='rejected_current_attempt')return {kind:'rejected_current_attempt',data};
   if(intent==='recover'&&data.state==='unresolved')return {kind:'unresolved',data};
  }catch{/* Any uncorrelated, malformed or HTTP failure remains unknown. */}
  return {kind:'unknown'};
 }
 return Object.freeze({version:BILLING_SERVICE_V4,scope,
  async readCurrent(signal?:AbortSignal){
   const response=await exchange(null,null,signal);if(!response.ok||response.value.status!==200)throw Error('SERVICE_CURRENT_UNAVAILABLE');
   const data=scopedServiceOwnerReadV4(success.parse(response.value.body).data,scope);
   if(data.state!=='ready')throw Error('SERVICE_CURRENT_UNAVAILABLE');return freezeServiceOwnerV4(ownerServiceCurrentV4Schema.parse(data.current));
  },
  execute:(pending:PreparedServiceOwnerOperationV4,signal?:AbortSignal)=>operation(pending,'execute',signal),
  recover:(pending:PreparedServiceOwnerOperationV4,signal?:AbortSignal)=>operation(pending,'recover',signal),
 });
}
export type FishingBillingOwnerClientV4=ReturnType<typeof createFishingBillingOwnerClientV4>;
