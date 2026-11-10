import {z} from 'zod';
import {errorStatus,type ErrorCode} from '../../lib/errors.ts';
import {sessionInfo} from '../identity/client.ts';
import {billingId} from './contracts.ts';
import {formatFloridaLocalTime,resolveFloridaLocalTime} from './florida-local-time.ts';
import {PROGRAM_SOURCE_V3,programSourceCommandV3Schema,type ProgramSourceCommandV3,type ProgramSourceRecordV3} from './program-source-contract-v3.ts';
import {PROGRAM_SOURCE_OWNER_PATH,programSourceGroupDataV3Schema,programSourceRecordedDataV3Schema,
 type ProgramSourceGroupDataV3,type ProgramSourceRecordedDataV3} from './program-source-owner-contract-v3.ts';

// Complete bounded reads may contain up to 1000 lessons and 1000 participant plans.
const maxResponseBytes=4_194_304;
const envelope=z.discriminatedUnion('ok',[
 z.object({ok:z.literal(true),data:z.unknown(),requestId:z.uuid()}).strict(),
 z.object({ok:z.literal(false),error:z.object({code:z.enum(Object.keys(errorStatus) as [ErrorCode,...ErrorCode[]])}).strict(),requestId:z.uuid()}).strict(),
]);
type Failure={code:ErrorCode;requestId:string|null};
export type ProgramSourceReadResultV3={state:'ready';value:ProgramSourceGroupDataV3;requestId:string}|({state:'failed'}&Failure);
export type ProgramSourceSaveResultV3={state:'saved';value:ProgramSourceRecordedDataV3;requestId:string}|({state:'unknown'|'rejected'|'not_sent'}&Failure);
export type PreparedProgramSourceSaveV3=Readonly<{command:ProgramSourceCommandV3;serialized:string}>;
export type ProgramLessonInputsV3={sequence:string;startsAt:string;endsAt:string;state:'scheduled'|'cancelled'};
export class ProgramLessonInputErrorV3 extends Error{
 constructor(readonly reason:'invalid'|'ambiguous'|'nonexistent',readonly field:'startsAt'|'endsAt'){
  super('INVALID_FLORIDA_LESSON_TIME');
 }
}
export function programLessonInputsV3(record?:ProgramSourceRecordV3):ProgramLessonInputsV3{
 if(!record)return {sequence:'',startsAt:'',endsAt:'',state:'scheduled'};
 if(record.command.kind!=='lesson')throw new Error('NOT_A_LESSON');
 const fields=record.command.fields;
 return {sequence:String(fields.sequence),startsAt:formatFloridaLocalTime(fields.startsAt),endsAt:formatFloridaLocalTime(fields.endsAt),state:fields.state};
}
export function prepareProgramLessonSaveV3(groupId:string,id:string,operationId:string,inputs:ProgramLessonInputsV3,current?:ProgramSourceRecordV3):PreparedProgramSourceSaveV3|null{
 if(current&&(current.command.kind!=='lesson'||current.command.groupId!==groupId||current.command.id!==id))throw new Error('LESSON_SELECTION_MISMATCH');
 const before=current?.command.kind==='lesson'?current.command.fields:undefined;
 const instant=(field:'startsAt'|'endsAt')=>{
  const original=before?.[field];
  if(original&&inputs[field]===formatFloridaLocalTime(original))return original;
  const result=resolveFloridaLocalTime(inputs[field]);
  if(result.state!=='ready')throw new ProgramLessonInputErrorV3(result.state,field);
  return result.instant;
 };
 if(!/^\d+$/.test(inputs.sequence))throw new Error('INVALID_LESSON_SEQUENCE');
 const fields={state:inputs.state,sequence:Number(inputs.sequence),startsAt:instant('startsAt'),endsAt:instant('endsAt'),timeZone:'America/New_York' as const};
 if(before&&JSON.stringify(before)===JSON.stringify(fields))return null;
 return prepareProgramSourceSaveV3({version:current?.version??PROGRAM_SOURCE_V3,kind:'lesson',groupId,id,operationId,expectedRevision:current?.revision??0,fields});
}
type Dependencies={fetch:typeof fetch;session:typeof sessionInfo;timeoutMs:number};
type Wire={ok:true;data:unknown;requestId:string}|({ok:false;authoritative:boolean}&Failure);
function freeze<T>(value:T):T{
 if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;
}
export function prepareProgramSourceSaveV3(input:ProgramSourceCommandV3):PreparedProgramSourceSaveV3{
 const command=programSourceCommandV3Schema.parse(input),serialized=JSON.stringify(command);
 if(new TextEncoder().encode(serialized).length>32_768)throw new Error('INVALID_SOURCE');
 return Object.freeze({command:freeze(command),serialized});
}
/** A later head or similar fields cannot confirm an earlier uncertain operation. */
export function programSourceSaveMatchesV3(pending:PreparedProgramSourceSaveV3,record:ProgramSourceRecordV3):boolean{
 return record.revision===pending.command.expectedRevision+1&&JSON.stringify(record.command)===pending.serialized;
}
export function programSourceSavedHeadV3(pending:PreparedProgramSourceSaveV3,data:ProgramSourceGroupDataV3){
 if(data.group.record.command.groupId!==pending.command.groupId)return null;
 const records=pending.command.kind==='group'?[data.group]:pending.command.kind==='lesson'?data.lessons:data.progressions;
 return records.find(item=>programSourceSaveMatchesV3(pending,item.record))??null;
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

export function createProgramSourceClientV3(overrides:Partial<Dependencies>={}){
 const deps:Dependencies={fetch:(...args)=>fetch(...args),session:sessionInfo,timeoutMs:15_000,...overrides};
 if(!Number.isInteger(deps.timeoutMs)||deps.timeoutMs<1||deps.timeoutMs>60_000)throw new Error('INVALID_TIMEOUT');
 const bad=():Wire=>({ok:false,code:'UNAVAILABLE',requestId:null,authoritative:false});
 async function wire(path:string,init:RequestInit,signal:AbortSignal):Promise<Wire>{
  try{
   if(signal.aborted)return bad();
   const response=await deps.fetch(path,{...init,signal,credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',
    headers:{accept:'application/json',...init.headers}});
   if(signal.aborted){void response.body?.cancel().catch(()=>undefined);return bad();}
   const parsed=envelope.parse(await bodyJson(response,signal));
   if(parsed.ok)return response.status===200?{ok:true,data:parsed.data,requestId:parsed.requestId}:bad();
   return {ok:false,code:parsed.error.code,requestId:parsed.requestId,authoritative:response.status===errorStatus[parsed.error.code]};
  }catch{return bad();}
 }
 return {
  group(groupId:string,signal?:AbortSignal):Promise<ProgramSourceReadResultV3>{
   if(!billingId.safeParse(groupId).success||groupId!==groupId.toLowerCase())return Promise.resolve({state:'failed',code:'INVALID_REQUEST',requestId:null});
   return bounded<ProgramSourceReadResultV3>(async inner=>{
    const result=await wire(PROGRAM_SOURCE_OWNER_PATH+'?'+new URLSearchParams({groupId}),{method:'GET'},inner);
    if(!result.ok)return {state:'failed',code:result.authoritative?result.code:'UNAVAILABLE',requestId:result.requestId};
    try{
     const value=programSourceGroupDataV3Schema.parse(result.data);
     if(value.group.record.command.groupId!==groupId)throw new Error('SOURCE_GROUP_BINDING');
     return {state:'ready',value,requestId:result.requestId};
    }catch{return {state:'failed',code:'UNAVAILABLE',requestId:result.requestId};}
   },()=>({state:'failed',code:'UNAVAILABLE',requestId:null}),deps.timeoutMs,signal);
  },
  save(pending:PreparedProgramSourceSaveV3,signal?:AbortSignal):Promise<ProgramSourceSaveResultV3>{
   let started=false;
   const unavailable=():ProgramSourceSaveResultV3=>({state:started?'unknown':'not_sent',code:'UNAVAILABLE',requestId:null});
   return bounded<ProgramSourceSaveResultV3>(async inner=>{
    let session:Awaited<ReturnType<typeof sessionInfo>>;
    try{
     if(JSON.stringify(programSourceCommandV3Schema.parse(pending.command))!==pending.serialized)return {state:'not_sent',code:'INVALID_REQUEST',requestId:null};
     session=await deps.session();if(inner.aborted)return unavailable();
     if(session.role!=='practitioner')return {state:'not_sent',code:'FORBIDDEN',requestId:null};
     if(!z.uuid().safeParse(session.accountId).success||typeof session.csrfToken!=='string'||!session.csrfToken)return unavailable();
    }catch(error){
     const code=error&&typeof error==='object'&&'code'in error&&error.code==='UNAUTHENTICATED'?'UNAUTHENTICATED':'UNAVAILABLE';
     return {state:'not_sent',code,requestId:null};
    }
    if(inner.aborted)return unavailable();started=true;
    const result=await wire(PROGRAM_SOURCE_OWNER_PATH,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},body:pending.serialized},inner);
    if(!result.ok)return {state:result.authoritative&&!['UNAVAILABLE','INTERNAL'].includes(result.code)?'rejected':'unknown',code:result.authoritative?result.code:'UNAVAILABLE',requestId:result.requestId};
    try{
     const value=programSourceRecordedDataV3Schema.parse(result.data);
     if(!programSourceSaveMatchesV3(pending,value.record)||value.record.recordedBy!==session.accountId)throw new Error('SAVED_SOURCE_BINDING');
     return {state:'saved',value,requestId:result.requestId};
    }catch{return {state:'unknown',code:'UNAVAILABLE',requestId:result.requestId};}
   },unavailable,deps.timeoutMs,signal);
  },
 };
}
export type ProgramSourceClientV3=ReturnType<typeof createProgramSourceClientV3>;
