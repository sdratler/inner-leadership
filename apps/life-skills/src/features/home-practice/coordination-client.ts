import {IdentityClientError,sessionInfo,type IdentityClientErrorCode} from '../identity/client.ts';
import type {PracticeCoordinationPage,CoordinationVersion,CompletionMode} from './types.ts';
const codes:readonly IdentityClientErrorCode[]=['INVALID_REQUEST','UNAUTHENTICATED','FORBIDDEN','NOT_FOUND','CONFLICT','RATE_LIMITED','UNAVAILABLE','INTERNAL'];
async function request<T>(path:string,init:RequestInit,signal?:AbortSignal):Promise<T>{
 try{
  const response=await fetch(path,{...init,...(signal?{signal}:{}),credentials:'same-origin',cache:'no-store',redirect:'error',referrerPolicy:'no-referrer'});
  const payload=await response.json() as {ok?:boolean;data?:T;error?:{code?:string}};
  if(response.ok&&payload?.ok===true&&Object.hasOwn(payload,'data'))return payload.data as T;
  throw new IdentityClientError(codes.includes(payload?.error?.code as IdentityClientErrorCode)?payload.error!.code as IdentityClientErrorCode:'UNAVAILABLE');
 }catch(error){if(signal?.aborted||error instanceof IdentityClientError)throw error;throw new IdentityClientError('UNAVAILABLE');}
}
const ids=(value:unknown):value is string[]=>Array.isArray(value)&&value.length<=2&&value.every(id=>typeof id==='string'&&/^[a-f0-9-]{36}$/i.test(id))&&new Set(value).size===value.length;
export async function readCoordination(assignmentId:string,caseId:string,audienceId:string,signal?:AbortSignal):Promise<PracticeCoordinationPage>{
 const value=await request<PracticeCoordinationPage>('/api/home-practice?'+new URLSearchParams({view:'coordination',assignmentId}),{method:'GET'},signal);
 const valid=(row:CoordinationVersion)=>row&&row.assignmentId===assignmentId&&row.caseId===caseId&&row.audienceId===audienceId&&typeof row.versionId==='string'&&ids(row.assigneeAccountIds)&&ids(row.reminderCandidateAccountIds)&&row.reminderCandidateAccountIds.every(id=>row.assigneeAccountIds.includes(id))&&['any_assignee','each_assignee'].includes(row.completionMode)&&Number.isFinite(Date.parse(row.effectiveFrom))&&typeof row.changedByAccountId==='string';
 if(!value||!['parent','adult_client'].includes(value.role)||typeof value.ownAccountId!=='string'||!ids(value.eligibleAccountIds)||typeof value.hasMore!=='boolean'||typeof value.asOf!=='string'||!Number.isFinite(Date.parse(value.asOf))||!Array.isArray(value.versions)||value.versions.length>20||value.versions.some(row=>!valid(row))||value.currentVersion!==null&&(!valid(value.currentVersion)||Date.parse(value.currentVersion.effectiveFrom)>Date.parse(value.asOf)))throw new IdentityClientError('UNAVAILABLE');
 if(value.role==='adult_client'&&(value.eligibleAccountIds.length!==1||value.eligibleAccountIds[0]!==value.ownAccountId))throw new IdentityClientError('UNAVAILABLE');
 if(value.readOnlyReason!==undefined&&(value.readOnlyReason!=='legacy_child_assignment'||value.role!=='parent'||value.eligibleAccountIds.length!==0))throw new IdentityClientError('UNAVAILABLE');
 return value;
}
/** Defaults follow the server's current selection, never insertion order or
 * the browser clock. Future changes remain visible in immutable history. */
export function coordinationDefaults(page:PracticeCoordinationPage):{assignees:string[];reminders:string[];mode:CompletionMode}{
 const current=page.currentVersion,assignees=page.readOnlyReason?[...(current?.assigneeAccountIds??[])]:page.role==='adult_client'?[page.ownAccountId]:current?.assigneeAccountIds.filter(id=>page.eligibleAccountIds.includes(id))??[page.ownAccountId].filter(id=>page.eligibleAccountIds.includes(id));
 return {assignees,reminders:current?.reminderCandidateAccountIds.filter(id=>assignees.includes(id))??[],mode:assignees.length===2&&current?.completionMode==='each_assignee'?'each_assignee':'any_assignee'};
}
/** A draft is based on effective responsibility and current authorization, not
 * on a timestamp or incidental history pagination. */
export function coordinationFrameKey(page:PracticeCoordinationPage):string{return JSON.stringify([page.ownAccountId,page.role,page.currentVersion?.versionId??null,page.readOnlyReason??null,[...page.eligibleAccountIds].sort()]);}
export function coordinationRefreshDelay(page:PracticeCoordinationPage,elapsed:number):number|null{
 const asOf=Date.parse(page.asOf),pending=page.versions.map(row=>Date.parse(row.effectiveFrom)).filter(at=>at>asOf);
 return pending.length?Math.min(2_147_483_647,Math.max(100,Math.min(...pending)-asOf-Math.max(0,elapsed)+100)):null;
}
export type CoordinationCommand=Readonly<{action:'coordinate';assignmentId:string;assigneeAccountIds:readonly string[];completionMode:CompletionMode;reminderCandidateAccountIds:readonly string[];effectiveFrom:string;expectedCurrentVersionId?:string|null}>;
export function coordinationCommand(assignmentId:string,assignees:readonly string[],mode:CompletionMode,reminders:readonly string[],now:number,expectedCurrentVersionId?:string|null):CoordinationCommand{
 if(!ids([...assignees])||!assignees.length||!ids([...reminders])||reminders.some(id=>!assignees.includes(id))||mode==='each_assignee'&&assignees.length!==2||!['any_assignee','each_assignee'].includes(mode)||!Number.isFinite(now))throw new IdentityClientError('INVALID_REQUEST');
 if(expectedCurrentVersionId!==undefined&&expectedCurrentVersionId!==null&&!ids([expectedCurrentVersionId]))throw new IdentityClientError('INVALID_REQUEST');
 return Object.freeze({action:'coordinate',assignmentId,assigneeAccountIds:Object.freeze([...assignees]),completionMode:mode,reminderCandidateAccountIds:Object.freeze([...reminders]),effectiveFrom:new Date(now+60_000).toISOString(),...(expectedCurrentVersionId===undefined?{}:{expectedCurrentVersionId})});
}
/** Complete the potentially slow ordinary session lookup before obtaining a
 * fresh server-clock frame. The closure posts once with that session's CSRF;
 * server authentication and the effective-version guard remain authoritative. */
export async function prepareCoordinationSave(assignmentId:string,caseId:string,audienceId:string,ownAccountId:string,role:'parent'|'adult_client'){
 const session=await sessionInfo();
 if(session.accountId!==ownAccountId||session.role!==role)throw new IdentityClientError('NOT_FOUND');
 const page=await readCoordination(assignmentId,caseId,audienceId);
 if(page.ownAccountId!==ownAccountId||page.role!==role)throw new IdentityClientError('NOT_FOUND');
 return {page,submit:(command:CoordinationCommand):Promise<{versionId:string}>=>request('/api/home-practice',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify(command)})};
}
export async function saveCoordination(command:CoordinationCommand,ownAccountId:string,role:'parent'|'adult_client'):Promise<{versionId:string}>{
 const session=await sessionInfo();
 if(session.accountId!==ownAccountId||session.role!==role)throw new IdentityClientError('NOT_FOUND');
 return request('/api/home-practice',{method:'POST',headers:{'Content-Type':'application/json','X-CSRF-Token':session.csrfToken},body:JSON.stringify(command)});
}
/** Exact frozen parameters and authenticated writer, not a matching label.
 * Unknown writes are reconciled by a read, never automatically submitted twice. */
export function coordinationReadback(command:CoordinationCommand,page:PracticeCoordinationPage,versionId?:string):CoordinationVersion|null{
 const equal=(a:readonly string[],b:readonly string[])=>a.length===b.length&&[...a].sort().every((id,index)=>id===[...b].sort()[index]);
 return page.versions.find(row=>(versionId===undefined||row.versionId===versionId)&&row.assignmentId===command.assignmentId&&row.changedByAccountId===page.ownAccountId&&row.effectiveFrom===command.effectiveFrom&&row.completionMode===command.completionMode&&equal(row.assigneeAccountIds,command.assigneeAccountIds)&&equal(row.reminderCandidateAccountIds,command.reminderCandidateAccountIds))??null;
}
