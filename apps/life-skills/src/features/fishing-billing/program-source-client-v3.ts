import {z} from 'zod';
import {errorStatus,type ErrorCode} from '../../lib/errors.ts';
import {sessionInfo} from '../identity/client.ts';
import {billingId} from './contracts.ts';
import {formatFloridaLocalTime,resolveFloridaLocalTime} from './florida-local-time.ts';
import {decodeInquiryReview} from '../group-application/review-workspace.tsx';
import {nativeFamilyOwnerSourceSchema,type NativeFamilyOwnerSource} from './native-family-owner-source-contract.ts';
import {NATIVE_FAMILY_VERSION,nativeFamilyCreateCommandSchema,type NativeFamilyCreateCommand} from './native-family-contract-v1.ts';
import type {FishingInquiryFamilyProposal} from './inquiry-family-contract-v1.ts';
import {nativeFamilySaveDataSchema} from './native-family-outcome-contract-v1.ts';
import {OWNER_LOCATION_PLANNING_PREFIX,ownerLocationPlanningSource} from './owner-location-planning-source.ts';
import {PROGRAM_SOURCE_V3,programSourceCommandV3Schema,type ProgramSourceCommandV3,type ProgramSourceRecordV3} from './program-source-contract-v3.ts';
import {PROGRAM_SOURCE_OWNER_PATH,programSourceGroupDataV3Schema,programSourceSaveDataV3Schema,
 type ProgramSourceGroupDataV3,type ProgramSourceRecordedDataV3} from './program-source-owner-contract-v3.ts';

// Complete bounded reads may contain up to 1000 lessons and 1000 participant plans.
const maxResponseBytes=4_194_304;
const envelope=z.discriminatedUnion('ok',[
 z.object({ok:z.literal(true),data:z.unknown(),requestId:z.uuid()}).strict(),
 z.object({ok:z.literal(false),error:z.object({code:z.enum(Object.keys(errorStatus) as [ErrorCode,...ErrorCode[]])}).strict(),requestId:z.uuid()}).strict(),
]);
type Failure={code:ErrorCode;requestId:string|null};
export type ProgramOwnerReadResultV3<T>={state:'ready';value:T;requestId:string|null}|({state:'failed'}&Failure);
export type PreparedNativeFamilySaveV3=Readonly<{command:NativeFamilyCreateCommand;serialized:string;workspaceId:string}>;
export type NativeFamilySaveResultV3={state:'saved';record:FishingInquiryFamilyProposal;replayed:boolean;requestId:string}|({state:'unknown'|'rejected'|'not_sent'}&Failure);
const familyPath='/api/private/fishing-inquiry-family-proposals';
export type ProgramSourceReadResultV3={state:'ready';value:ProgramSourceGroupDataV3;requestId:string}|({state:'failed'}&Failure);
export type ProgramSourceSaveResultV3={state:'saved';value:ProgramSourceRecordedDataV3;requestId:string}|({state:'unknown'|'rejected'|'not_sent'}&Failure);
export type PreparedProgramSourceSaveV3=Readonly<{command:ProgramSourceCommandV3;serialized:string;workspaceId:string}>;
export type ProgramLessonInputsV3={sequence:string;startsAt:string;endsAt:string;state:'scheduled'|'cancelled'};
export type ProgramGroupInputsV3={location:string;state:'forming'|'cancelled'};
type GroupSaveInput={groupId:string;workspaceId:string;operationId:string;inputs:ProgramGroupInputsV3;current?:ProgramSourceRecordV3|undefined};
export type ProgramGroupPrepareResultV3={state:'prepared';save:PreparedProgramSourceSaveV3|null}|({state:'failed'}&Failure);
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
export function prepareProgramLessonSaveV3(groupId:string,id:string,operationId:string,inputs:ProgramLessonInputsV3,current?:ProgramSourceRecordV3,workspaceId?:string):PreparedProgramSourceSaveV3|null{
 if(current&&(current.command.kind!=='lesson'||current.command.groupId!==groupId||current.command.id!==id))throw new Error('LESSON_SELECTION_MISMATCH');
 const before=current?.command.kind==='lesson'?current.command.fields:undefined;
 const scope=current?.workspaceId??workspaceId;
 if(!scope||(current&&workspaceId&&current.workspaceId!==workspaceId))throw new Error('LESSON_WORKSPACE_REQUIRED');
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
 return prepareProgramSourceSaveV3({version:current?.version??PROGRAM_SOURCE_V3,kind:'lesson',groupId,id,operationId,expectedRevision:current?.revision??0,fields},scope);
}
type Dependencies={fetch:typeof fetch;session:typeof sessionInfo;timeoutMs:number};
type Wire={ok:true;data:unknown;requestId:string}|({ok:false;authoritative:boolean}&Failure);
function freeze<T>(value:T):T{
 if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;
}
export async function prepareProgramGroupSaveV3(input:GroupSaveInput,ownerAccountId:string):Promise<PreparedProgramSourceSaveV3|null>{
 const {current,inputs,groupId,workspaceId,operationId}=input;
 if(current&&(current.command.kind!=='group'||current.command.groupId!==groupId||current.workspaceId!==workspaceId))throw new Error('GROUP_SELECTION_MISMATCH');
 const before=current?.command.kind==='group'?current.command.fields:undefined,location=inputs.location.trim();
 if(before&&before.location===location&&before.state===inputs.state)return null;
 const source=before&&before.location===location&&!before.venueSource.id.startsWith(OWNER_LOCATION_PLANNING_PREFIX)?before.venueSource:
  await ownerLocationPlanningSource({workspaceId,ownerAccountId,groupId,operationId,location});
 return prepareProgramSourceSaveV3({version:PROGRAM_SOURCE_V3,kind:'group',groupId,id:groupId,operationId,expectedRevision:current?.revision??0,
  fields:{state:inputs.state,location,venueSource:source}},workspaceId);
}
export function prepareProgramSourceSaveV3(input:ProgramSourceCommandV3,workspaceId:string):PreparedProgramSourceSaveV3{
 if(!billingId.safeParse(workspaceId).success||workspaceId!==workspaceId.toLowerCase())throw new Error('SOURCE_WORKSPACE_REQUIRED');
 const command=programSourceCommandV3Schema.parse(input),serialized=JSON.stringify(command);
 if(new TextEncoder().encode(serialized).length>32_768)throw new Error('INVALID_SOURCE');
 return Object.freeze({command:freeze(command),serialized,workspaceId});
}
/** A later head or similar fields cannot confirm an earlier uncertain operation. */
export function programSourceSaveMatchesV3(pending:PreparedProgramSourceSaveV3,record:ProgramSourceRecordV3):boolean{
 return record.workspaceId===pending.workspaceId&&record.revision===pending.command.expectedRevision+1&&JSON.stringify(record.command)===pending.serialized;
}
export function programSourceSavedHeadV3(pending:PreparedProgramSourceSaveV3,data:ProgramSourceGroupDataV3){
 if(data.group.record.command.groupId!==pending.command.groupId)return null;
 const records=pending.command.kind==='group'?[data.group]:pending.command.kind==='lesson'?data.lessons:data.progressions;
 return records.find(item=>programSourceSaveMatchesV3(pending,item.record))??null;
}
export function prepareNativeFamilySaveV3(raw:NativeFamilyOwnerSource,familyLabel:string,reviewed:boolean,workspaceId:string,newId:()=>string=()=>crypto.randomUUID()):PreparedNativeFamilySaveV3{
 const source=nativeFamilyOwnerSourceSchema.parse(raw);
 if(!billingId.safeParse(workspaceId).success||workspaceId!==workspaceId.toLowerCase())throw new Error('FAMILY_WORKSPACE_REQUIRED');
 if(!reviewed||source.contactAdmission!=='admitted'||source.association)throw new Error('EXPLICIT_CURRENT_FAMILY_REVIEW_REQUIRED');
 const command=nativeFamilyCreateCommandSchema.parse({version:NATIVE_FAMILY_VERSION,operationId:newId(),reference:source.reference,
  expectedEpoch:source.expectedEpoch,expectedSourceDigest:source.sourceDigest,ownerReviewedMapping:true,familyId:newId(),familyLabel,
  children:source.children.map(child=>({applicationChildId:child.id,nativeChildId:newId()}))});
 return Object.freeze({command:freeze(command),serialized:JSON.stringify({action:'create_native_family',command}),workspaceId});
}
export function nativeFamilySaveMatchesV3(pending:PreparedNativeFamilySaveV3,record:FishingInquiryFamilyProposal){
 const c=pending.command,r=record.command,s=r.selection;
 return record.workspaceId===pending.workspaceId&&r.operationId===c.operationId&&r.expectedEpoch===c.expectedEpoch&&r.expectedSourceDigest===c.expectedSourceDigest&&
  s.reference===c.reference&&s.familyId===c.familyId&&JSON.stringify(s.children)===JSON.stringify(c.children);
}
export function prepareProgramParticipantSaveV3({data,source:raw,applicationChildId,lessonId,state,operationId}:{data:ProgramSourceGroupDataV3;source:NativeFamilyOwnerSource;
 applicationChildId:string;lessonId?:string|undefined;state:'planned'|'withdrawn';operationId:string}):PreparedProgramSourceSaveV3|null{
 const source=nativeFamilyOwnerSourceSchema.parse(raw),association=source.association;
 if(data.group.record.command.kind!=='group'||data.group.record.command.fields.state!=='forming')throw new Error('GROUP_NOT_FORMING');
 if(source.contactAdmission!=='admitted'||!association||association.workspaceId!==data.group.record.workspaceId)throw new Error('CURRENT_NATIVE_FAMILY_REQUIRED');
 const mapping=association.command.selection.children.find(child=>child.applicationChildId===applicationChildId);
 if(!mapping)throw new Error('SELECTED_CHILD_NOT_ASSOCIATED');
 const existing=data.progressions.find(item=>item.record.command.id===mapping.nativeChildId)?.record;
 if(existing&&existing.command.kind!=='progression')throw new Error('INVALID_PARTICIPANT_PLAN');
 const before=existing?.command.kind==='progression'?existing.command.fields:undefined;
 if(before&&(before.familyId!==association.command.selection.familyId||before.proposalId!==association.id||before.reference!==source.reference||before.expectedEpoch!==source.expectedEpoch))
  throw new Error('CURRENT_PARTICIPANT_MAPPING_CHANGED');
 if(!before&&state==='withdrawn')throw new Error('NO_PARTICIPANT_PLAN');
 const ready=before?.readiness??'needs_foundation';
 const lesson=data.lessons.find(item=>item.record.command.id===lessonId)?.record.command;
 if((!before||state!=='withdrawn')&&(!lesson||lesson.kind!=='lesson'||lesson.fields.state!=='scheduled'||
  (ready==='needs_foundation'&&lesson.fields.sequence!==1)||(ready==='foundation_one_complete'&&lesson.fields.sequence>2)))throw new Error('ELIGIBLE_SAVED_LESSON_REQUIRED');
 const selected=lesson?.kind==='lesson'?lesson.fields.startsAt:undefined;
 const eligibleFrom=before&&(state==='withdrawn'||(selected&&Date.parse(before.eligibleFrom)===Date.parse(selected)))?before.eligibleFrom:selected;
 if(!eligibleFrom)throw new Error('ELIGIBLE_SAVED_LESSON_REQUIRED');
 const fields=before?{...before,state,eligibleFrom}:{state,familyId:association.command.selection.familyId,proposalId:association.id,reference:source.reference,
  expectedEpoch:source.expectedEpoch,eligibleFrom,readiness:'needs_foundation' as const,evidence:null};
 if(before&&JSON.stringify(before)===JSON.stringify(fields))return null;
 return prepareProgramSourceSaveV3({version:PROGRAM_SOURCE_V3,kind:'progression',groupId:data.group.record.command.groupId,id:mapping.nativeChildId,
  expectedRevision:existing?.revision??0,operationId,fields},data.group.record.workspaceId);
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
  prepareGroup(input:GroupSaveInput,signal?:AbortSignal):Promise<ProgramGroupPrepareResultV3>{
   return bounded<ProgramGroupPrepareResultV3>(async inner=>{
    try{
     const session=await deps.session();if(inner.aborted)return {state:'failed',code:'UNAVAILABLE',requestId:null};
     if(session.role!=='practitioner')return {state:'failed',code:'FORBIDDEN',requestId:null};
     if(!z.uuid().safeParse(session.accountId).success)return {state:'failed',code:'UNAVAILABLE',requestId:null};
     const save=await prepareProgramGroupSaveV3(input,session.accountId);
     return {state:'prepared',save};
    }catch(error){return {state:'failed',code:error&&typeof error==='object'&&'code'in error&&error.code==='UNAUTHENTICATED'?'UNAUTHENTICATED':'INVALID_REQUEST',requestId:null};}
   },()=>({state:'failed',code:'UNAVAILABLE',requestId:null}),deps.timeoutMs,signal);
  },
  inquiries(search:string,cursor:string|null=null,signal?:AbortSignal):Promise<ProgramOwnerReadResultV3<ReturnType<typeof decodeInquiryReview>>>{
   if(search.length>160||(cursor!==null&&!/^[A-Za-z0-9_-]{64,2048}$/.test(cursor)))return Promise.resolve({state:'failed',code:'INVALID_REQUEST',requestId:null});
   return bounded<ProgramOwnerReadResultV3<ReturnType<typeof decodeInquiryReview>>>(async inner=>{
    try{
     const params=new URLSearchParams();if(search)params.set('search',search);if(cursor)params.set('cursor',cursor);
     const response=await deps.fetch('/api/private/group-applications'+(params.size?'?'+params:''),{method:'GET',signal:inner,credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer',headers:{accept:'application/json'}});
     if(response.status!==200){void response.body?.cancel().catch(()=>undefined);return {state:'failed' as const,code:response.status===401?'UNAUTHENTICATED' as const:response.status===403?'FORBIDDEN' as const:response.status===429?'RATE_LIMITED' as const:'UNAVAILABLE' as const,requestId:null};}
     const value=decodeInquiryReview(await bodyJson(response,inner));
     return {state:'ready' as const,value,requestId:null};
    }catch{return {state:'failed' as const,code:'UNAVAILABLE' as const,requestId:null};}
   },()=>({state:'failed' as const,code:'UNAVAILABLE' as const,requestId:null}),deps.timeoutMs,signal);
  },
  family(reference:string,signal?:AbortSignal):Promise<ProgramOwnerReadResultV3<NativeFamilyOwnerSource>>{
   if(!billingId.safeParse(reference).success||reference!==reference.toLowerCase())return Promise.resolve({state:'failed',code:'INVALID_REQUEST',requestId:null});
   return bounded<ProgramOwnerReadResultV3<NativeFamilyOwnerSource>>(async inner=>{
    const result=await wire(familyPath+'?'+new URLSearchParams({kind:'source',reference}),{method:'GET'},inner);
    if(!result.ok)return {state:'failed' as const,code:result.authoritative?result.code:'UNAVAILABLE',requestId:result.requestId};
    try{
     const value=nativeFamilyOwnerSourceSchema.parse(result.data);if(value.reference!==reference)throw new Error('SOURCE_REFERENCE_MISMATCH');
     return {state:'ready' as const,value,requestId:result.requestId};
    }catch{return {state:'failed' as const,code:'UNAVAILABLE' as const,requestId:result.requestId};}
   },()=>({state:'failed' as const,code:'UNAVAILABLE' as const,requestId:null}),deps.timeoutMs,signal);
  },
  saveFamily(pending:PreparedNativeFamilySaveV3,signal?:AbortSignal):Promise<NativeFamilySaveResultV3>{
   let started=false;const unavailable=():NativeFamilySaveResultV3=>({state:started?'unknown':'not_sent',code:'UNAVAILABLE',requestId:null});
   return bounded<NativeFamilySaveResultV3>(async inner=>{
    let session:Awaited<ReturnType<typeof sessionInfo>>;
    try{
     const command=nativeFamilyCreateCommandSchema.parse(pending.command);
     if(!billingId.safeParse(pending.workspaceId).success||pending.workspaceId!==pending.workspaceId.toLowerCase()||JSON.stringify({action:'create_native_family',command})!==pending.serialized)
      return {state:'not_sent' as const,code:'INVALID_REQUEST' as const,requestId:null};
     session=await deps.session();if(inner.aborted)return unavailable();
     if(session.role!=='practitioner')return {state:'not_sent' as const,code:'FORBIDDEN' as const,requestId:null};
     if(!z.uuid().safeParse(session.accountId).success||typeof session.csrfToken!=='string'||!session.csrfToken)return unavailable();
    }catch(error){return {state:'not_sent' as const,code:error&&typeof error==='object'&&'code'in error&&error.code==='UNAUTHENTICATED'?'UNAUTHENTICATED' as const:'UNAVAILABLE' as const,requestId:null};}
    if(inner.aborted)return unavailable();started=true;
    const result=await wire(familyPath,{method:'POST',headers:{'content-type':'application/json','x-csrf-token':session.csrfToken},body:pending.serialized},inner);
    if(!result.ok)return {state:result.authoritative&&!['UNAVAILABLE','INTERNAL'].includes(result.code)?'rejected' as const:'unknown' as const,code:result.authoritative?result.code:'UNAVAILABLE',requestId:result.requestId};
    try{
     const value=nativeFamilySaveDataSchema.parse(result.data);
     if(value.kind==='native_family_rejected'){
      if(value.actorId!==session.accountId||value.workspaceId!==pending.workspaceId||JSON.stringify(value.command)!==JSON.stringify(pending.command))throw new Error('NATIVE_FAMILY_REJECTION_MISMATCH');
      return {state:'rejected' as const,code:value.code,requestId:result.requestId};
     }
     if(value.record.recordedBy!==session.accountId||!nativeFamilySaveMatchesV3(pending,value.record))throw new Error('NATIVE_FAMILY_RECEIPT_MISMATCH');
     return {state:'saved' as const,record:value.record,replayed:value.replayed,requestId:result.requestId};
    }catch{return {state:'unknown' as const,code:'UNAVAILABLE' as const,requestId:result.requestId};}
   },unavailable,deps.timeoutMs,signal);
  },
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
     if(!billingId.safeParse(pending.workspaceId).success||pending.workspaceId!==pending.workspaceId.toLowerCase()||JSON.stringify(programSourceCommandV3Schema.parse(pending.command))!==pending.serialized)
      return {state:'not_sent',code:'INVALID_REQUEST',requestId:null};
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
     const value=programSourceSaveDataV3Schema.parse(result.data);
     if(value.kind==='rejected_source'){
      if(value.actorId!==session.accountId||value.workspaceId!==pending.workspaceId||JSON.stringify(value.command)!==pending.serialized)throw new Error('REJECTION_SOURCE_BINDING');
      return {state:'rejected',code:value.code,requestId:result.requestId};
     }
     if(!programSourceSaveMatchesV3(pending,value.record)||value.record.recordedBy!==session.accountId)throw new Error('SAVED_SOURCE_BINDING');
     return {state:'saved',value,requestId:result.requestId};
    }catch{return {state:'unknown',code:'UNAVAILABLE',requestId:result.requestId};}
   },unavailable,deps.timeoutMs,signal);
  },
 };
}
export type ProgramSourceClientV3=ReturnType<typeof createProgramSourceClientV3>;
