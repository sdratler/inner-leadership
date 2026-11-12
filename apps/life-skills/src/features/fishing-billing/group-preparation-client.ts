import {z} from 'zod';
import {errorStatus, type ErrorCode} from '../../lib/errors.ts';
import {sessionInfo} from '../identity/client.ts';
import {
 GROUP_PREPARATION_LIST_VERSION, GROUP_PREPARATION_VERSION,
 groupPreparationCommand, groupPreparationFields, groupPreparationId, groupPreparationListPage,
 groupPreparationListQuery, groupPreparationRecord, groupPreparationRevision,
 type GroupPreparationCommand, type GroupPreparationFields, type GroupPreparationListPage, type GroupPreparationRecord,
} from './group-preparation-contract.ts';

export const GROUP_PREPARATION_OWNER_PATH='/api/private/fishing-group-preparations';
export const GROUP_PREPARATION_PAGE_SIZE=25;
const maxResponseBytes=262_144;
const envelope=z.discriminatedUnion('ok',[
 z.object({ok:z.literal(true),data:z.unknown(),requestId:z.uuid()}).strict(),
 z.object({ok:z.literal(false),error:z.object({code:z.enum(Object.keys(errorStatus) as [ErrorCode,...ErrorCode[]])}).strict(),requestId:z.uuid()}).strict(),
]);
type Failure={code:ErrorCode;requestId:string|null};
export type GroupReadResult<T>={state:'ready';value:T;requestId:string}|({state:'failed'}&Failure);
export type GroupSaveResult=
 |{state:'saved';record:GroupPreparationRecord;replayed:boolean;requestId:string}
 |({state:'unknown'|'rejected'|'not_sent'}&Failure);
export type PreparedGroupSave=Readonly<{command:GroupPreparationCommand;serialized:string}>;
export type GroupDraftInputs={label:string;firstClassLocalDate:string;proposedCapacity:string};
type Dependencies={fetch:typeof fetch;session:typeof sessionInfo;timeoutMs:number};
type Wire={ok:true;data:unknown;requestId:string}|({ok:false;authoritative:boolean}&Failure);

function freeze<T>(value:T):T{
 if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}
 return value;
}
export function prepareGroupSave(input:GroupPreparationCommand):PreparedGroupSave{
 const command=groupPreparationCommand.parse(input),serialized=JSON.stringify(command);
 if(new TextEncoder().encode(serialized).length>16_384)throw new Error('INVALID_DRAFT');
 return Object.freeze({command:freeze(command),serialized});
}
export function groupDraftInputs(record?:GroupPreparationRecord):GroupDraftInputs{
 return {label:record?.fields.label??'',firstClassLocalDate:record?.fields.firstClassLocalDate??'',
  proposedCapacity:record?.fields.proposedCapacity?.toString()??''};
}
function editable(inputs:GroupDraftInputs){
 const raw=inputs.proposedCapacity.trim();
 if(raw!==''&&(!/^\d+$/.test(raw)||!Number.isSafeInteger(Number(raw))))throw new Error('INVALID_DRAFT');
 return {label:inputs.label.trim(),firstClassLocalDate:inputs.firstClassLocalDate||null,proposedCapacity:raw===''?null:Number(raw)};
}
export function createGroupDraft(groupId:string,operationId:string,inputs:GroupDraftInputs):PreparedGroupSave{
 return prepareGroupSave(groupPreparationCommand.parse({version:GROUP_PREPARATION_VERSION,action:'create',groupId,operationId,
  expectedRevision:0,fields:{...editable(inputs),timeZone:'America/New_York'}}));
}
export function editGroupDraft(record:GroupPreparationRecord,operationId:string,inputs:GroupDraftInputs):PreparedGroupSave|null{
 if(record.state!=='draft')throw new Error('CANCELLED_DRAFT');
 const next=editable(inputs);
 groupPreparationFields.parse({...record.fields,...next});
 const fields:Partial<GroupPreparationFields>={};
 if(next.label!==record.fields.label)fields.label=next.label;
 if(next.firstClassLocalDate!==record.fields.firstClassLocalDate)fields.firstClassLocalDate=next.firstClassLocalDate;
 if(next.proposedCapacity!==record.fields.proposedCapacity)fields.proposedCapacity=next.proposedCapacity;
 if(Object.keys(fields).length===0)return null;
 return prepareGroupSave(groupPreparationCommand.parse({version:GROUP_PREPARATION_VERSION,action:'edit',groupId:record.groupId,
  operationId,expectedRevision:record.revision,fields}));
}
function sameValue(a:unknown,b:unknown):boolean{
 if(a===b)return true;
 if(!a||!b||typeof a!=='object'||typeof b!=='object')return false;
 const left=Object.entries(a),right=Object.entries(b);
 return left.length===right.length&&left.every(([key,value])=>Object.hasOwn(b,key)&&sameValue(value,(b as Record<string,unknown>)[key]));
}
/** A historical operation receipt is distinct from the latest editable record. */
export function groupSaveMatches(pending:PreparedGroupSave,record:GroupPreparationRecord):boolean{
 const c=pending.command;
 if(record.groupId!==c.groupId||record.operationId!==c.operationId||record.revision!==c.expectedRevision+1||record.action!==c.action)return false;
 return c.action==='cancel'||Object.entries(c.fields).every(([key,value])=>sameValue(value,record.fields[key as keyof GroupPreparationFields]));
}
export function groupPreparationHref(locale:'en'|'he',groupId?:string,revision?:number):string{
 const url='/'+locale+'/app/fishing-groups';
 if(groupId===undefined){if(revision!==undefined)throw new Error('INVALID_SELECTION');return url;}
 const id=groupPreparationId.parse(groupId),params=new URLSearchParams({groupId:id});
 if(revision!==undefined)params.set('revision',String(groupPreparationRevision.parse(revision)));
 return url+'?'+params.toString();
}

async function bodyJson(response:Response,signal:AbortSignal):Promise<unknown>{
 if(response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase()!=='application/json'||!response.body)throw new Error('INVALID_RESPONSE');
 const reader=response.body.getReader(),decoder=new TextDecoder('utf-8',{fatal:true});
 const cancel=()=>{void reader.cancel().catch(()=>undefined);};
 signal.addEventListener('abort',cancel,{once:true});
 let size=0,text='';
 try{
  if(signal.aborted)throw new Error('ABORTED');
  while(true){
   const chunk=await reader.read();
   if(signal.aborted)throw new Error('ABORTED');
   if(chunk.done)break;
   size+=chunk.value.byteLength;
   if(size>maxResponseBytes)throw new Error('OVERSIZED_RESPONSE');
   text+=decoder.decode(chunk.value,{stream:true});
  }
  return JSON.parse(text+decoder.decode());
 }catch(error){cancel();throw error;}
 finally{signal.removeEventListener('abort',cancel);reader.releaseLock();}
}
function bounded<T>(work:(signal:AbortSignal)=>Promise<T>,fallback:()=>T,timeoutMs:number,external?:AbortSignal):Promise<T>{
 if(external?.aborted)return Promise.resolve(fallback());
 const controller=new AbortController();
 let timer:ReturnType<typeof setTimeout>|undefined,abort:()=>void=()=>undefined;
 const ended=new Promise<T>(resolve=>{
  abort=()=>{controller.abort();resolve(fallback());};
  timer=setTimeout(abort,timeoutMs);external?.addEventListener('abort',abort,{once:true});
 });
 return Promise.race([Promise.resolve().then(()=>work(controller.signal)),ended])
  .finally(()=>{clearTimeout(timer);external?.removeEventListener('abort',abort);});
}

export function createGroupPreparationClient(overrides:Partial<Dependencies>={}){
 const deps:Dependencies={fetch:(...args)=>fetch(...args),session:sessionInfo,timeoutMs:15_000,...overrides};
 if(!Number.isInteger(deps.timeoutMs)||deps.timeoutMs<1||deps.timeoutMs>60_000)throw new Error('INVALID_TIMEOUT');
 const bad=():Wire=>({ok:false,code:'UNAVAILABLE',requestId:null,authoritative:false});
 async function wire(path:string,init:RequestInit,signal:AbortSignal):Promise<Wire>{
  try{
   if(signal.aborted)return bad();
   const response=await deps.fetch(path,{...init,signal,credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',
    headers:{accept:'application/json',...init.headers}});
   if(signal.aborted){void response.body?.cancel().catch(()=>undefined);return bad();}
   const result=envelope.safeParse(await bodyJson(response,signal));
   if(!result.success)return bad();
   const parsed=result.data;
   if(parsed.ok)return response.status===200?{ok:true,data:parsed.data,requestId:parsed.requestId}:bad();
   return {ok:false,code:parsed.error.code,requestId:parsed.requestId,authoritative:response.status===errorStatus[parsed.error.code]};
  }catch{return bad();}
 }
 function read<T>(path:string,parse:(value:unknown)=>T,signal?:AbortSignal):Promise<GroupReadResult<T>>{
  return bounded<GroupReadResult<T>>(async inner=>{
   const result=await wire(path,{method:'GET'},inner);
   if(!result.ok)return {state:'failed',code:result.authoritative?result.code:'UNAVAILABLE',requestId:result.requestId};
   try{return {state:'ready',value:parse(result.data),requestId:result.requestId};}
   catch{return {state:'failed',code:'UNAVAILABLE',requestId:result.requestId};}
  },()=>({state:'failed',code:'UNAVAILABLE',requestId:null}),deps.timeoutMs,signal);
 }
 return {
  list(cursor:string|null=null,signal?:AbortSignal):Promise<GroupReadResult<GroupPreparationListPage>>{
   const parsed=groupPreparationListQuery.safeParse({version:GROUP_PREPARATION_LIST_VERSION,limit:GROUP_PREPARATION_PAGE_SIZE,cursor});
   if(!parsed.success)return Promise.resolve({state:'failed',code:'INVALID_REQUEST',requestId:null});
   const params=new URLSearchParams({kind:'list',version:parsed.data.version,limit:String(parsed.data.limit)});
   if(parsed.data.cursor!==null)params.set('cursor',parsed.data.cursor);
   return read(GROUP_PREPARATION_OWNER_PATH+'?'+params.toString(),value=>{
    const page=z.object({kind:z.literal('list'),page:groupPreparationListPage}).strict().parse(value).page;
    if(page.items.length>GROUP_PREPARATION_PAGE_SIZE||(page.nextCursor!==null&&page.items.length!==GROUP_PREPARATION_PAGE_SIZE)||
     page.items.some((item,index)=>item.workspaceId!==page.items[0]?.workspaceId||(index>0&&item.groupId<=page.items[index-1]!.groupId)))throw new Error('INVALID_PAGE');
    return page;
   },signal);
  },
  record(groupId:string,revision?:number,signal?:AbortSignal):Promise<GroupReadResult<GroupPreparationRecord>>{
   if(!groupPreparationId.safeParse(groupId).success||(revision!==undefined&&!groupPreparationRevision.safeParse(revision).success))
    return Promise.resolve({state:'failed',code:'INVALID_REQUEST',requestId:null});
   const params=new URLSearchParams({kind:'record',groupId});
   if(revision!==undefined)params.set('revision',String(revision));
   return read(GROUP_PREPARATION_OWNER_PATH+'?'+params.toString(),value=>{
    const record=z.object({kind:z.literal('record'),record:groupPreparationRecord}).strict().parse(value).record;
    if(record.groupId!==groupId||(revision!==undefined&&record.revision!==revision))throw new Error('INVALID_RECORD_BINDING');
    return record;
   },signal);
  },
  save(pending:PreparedGroupSave,signal?:AbortSignal):Promise<GroupSaveResult>{
   let started=false;
   const unavailable=():GroupSaveResult=>({state:started?'unknown':'not_sent',code:'UNAVAILABLE',requestId:null});
   return bounded<GroupSaveResult>(async inner=>{
    let session:Awaited<ReturnType<typeof sessionInfo>>;
    try{
     const parsed=groupPreparationCommand.parse(pending.command);
     if(JSON.stringify(parsed)!==pending.serialized)return {state:'not_sent',code:'INVALID_REQUEST',requestId:null};
     session=await deps.session();
     if(inner.aborted)return unavailable();
     if(session.role!=='practitioner')return {state:'not_sent',code:'FORBIDDEN',requestId:null};
     if(!z.uuid().safeParse(session.accountId).success||typeof session.csrfToken!=='string'||!session.csrfToken)return unavailable();
    }catch(error){
     const code=error&&typeof error==='object'&&'code'in error&&error.code==='UNAUTHENTICATED'?'UNAUTHENTICATED':'UNAVAILABLE';
     return {state:'not_sent',code,requestId:null};
    }
    if(inner.aborted)return unavailable();
    started=true;
    const result=await wire(GROUP_PREPARATION_OWNER_PATH,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},body:pending.serialized},inner);
    if(!result.ok)return {state:result.authoritative&&!['UNAVAILABLE','INTERNAL'].includes(result.code)?'rejected':'unknown',code:result.authoritative?result.code:'UNAVAILABLE',requestId:result.requestId};
    try{
     const saved=z.object({kind:z.literal('saved'),record:groupPreparationRecord,replayed:z.boolean()}).strict().parse(result.data);
     if(!groupSaveMatches(pending,saved.record)||saved.record.recordedBy!==session.accountId)throw new Error('INVALID_SAVED_BINDING');
     return {state:'saved',record:saved.record,replayed:saved.replayed,requestId:result.requestId};
    }catch{return {state:'unknown',code:'UNAVAILABLE',requestId:result.requestId};}
   },unavailable,deps.timeoutMs,signal);
  },
 };
}
export type GroupPreparationClient=ReturnType<typeof createGroupPreparationClient>;
