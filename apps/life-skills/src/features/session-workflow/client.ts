import { sessionInfo } from "../identity/client.ts";
import type { CommandOutcome,CommandPort } from "../../ui/revamp/use-command.ts";
import { sessionCommandInput } from "./command-input.ts";
import {sameSpeakerLabels,type SpeakerCorrectionInput} from "./speaker-corrections.ts";
import type {SessionDetail} from "./database.ts";
import {recapDraftSchema,recapShareInputSchema,recapVersionViewSchema,recapSharePreviewSchema,recapPublicationSchema,recapPracticeChoicesSchema,type RecapDraftInput,type RecapVersionView,type RecapSharePreview,type RecapPracticeChoices,type RecapPracticeSelection} from "./recap-contract.ts";
import type {BroadFocus} from "./types.ts";
type Envelope<T>={ok:boolean;data?:T;error?:{code?:string}};
async function read<T>(path:string,signal?:AbortSignal):Promise<T>{const response=await fetch(`/api/sessions${path}`,{credentials:"same-origin",cache:"no-store",...(signal?{signal}:{})});const body=await response.json() as Envelope<T>;if(!response.ok||!body.ok||body.data===undefined)throw new Error(body.error?.code??"UNAVAILABLE");return body.data;}
async function write<T>(path:string,input:unknown,key?:string):Promise<CommandOutcome<T>>{try{const session=await sessionInfo(),response=await fetch(`/api/sessions${path}`,{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json","X-CSRF-Token":session.csrfToken,...(key?{"Idempotency-Key":key}:{})},body:JSON.stringify(input)}),body=await response.json() as Envelope<T>;if(response.ok&&body.ok&&body.data!==undefined)return {state:"accepted",value:body.data};if(response.status>=500)return {state:"unknown"};return {state:"rejected",message:body.error?.code??"Request rejected"};}catch{return {state:"unknown"};}}
export const sessionRead=read;
export async function sessionRecapPracticeChoices(sessionId:string,signal?:AbortSignal):Promise<RecapPracticeChoices>{return recapPracticeChoicesSchema.parse(await read(`/${sessionId}/practice-choices`,signal));}
export async function sessionRecapPreview(sessionId:string,version:number,recipients:readonly string[],signal?:AbortSignal):Promise<RecapSharePreview>{const query=new URLSearchParams({version:String(version)});for(const id of recipients)query.append("recipient",id);const value=recapSharePreviewSchema.parse(await read(`/${sessionId}/recap-preview?${query}`,signal));if(value.recap.sessionId!==sessionId||value.recap.version!==version||!sameIds(value.recipients.map(row=>row.accountId),recipients))throw new Error("UNAVAILABLE");return value;}
function sameIds(a:readonly string[],b:readonly string[]){return a.length===b.length&&[...a].sort().every((id,index)=>id===[...b].sort()[index]);}
export type RecapShareInput={sessionId:string;expectedVersion:number;expectedDigest:string;recipientAccountIds:readonly string[]};
/** Neither an accepted write nor an optimistic UI state proves a durable save.
 * Retry the identical command until its exact authorized version reads back. */
export type RecapCommandInput=Omit<RecapDraftInput,"focus"|"practiceSelections">&{sessionId:string;focus:readonly BroadFocus[];practiceSelections?:readonly RecapPracticeSelection[]};
export function sessionRecapCommand(sessionId:string):CommandPort<RecapCommandInput,RecapVersionView>{
 const path=`/${sessionId}/recap`,pending=new Map<string,RecapDraftInput>();
 const submit=async(input:RecapDraftInput,key:string):Promise<CommandOutcome<RecapVersionView>>=>{
  const result=await write<RecapVersionView>(path,input,key);if(result.state!=="accepted"){if(result.state==="rejected")pending.delete(key);return result;}
  try{const receipt=recapVersionViewSchema.parse(result.value),saved=recapVersionViewSchema.parse(await read(`${path}?version=${receipt.recap.version}`)),recap=saved.recap;
   if(JSON.stringify(saved)!==JSON.stringify(receipt)||recap.sessionId!==sessionId||recap.version!==input.expectedVersion+1||recap.locale!==input.locale||JSON.stringify(recap.focus)!==JSON.stringify(input.focus)||recap.nextStep!==input.nextStep.trim()||recap.practices.length!==(input.practiceSelections?.length??0)||!recap.practices.every(row=>input.practiceSelections?.some(selected=>selected.versionId===row.responsibilityId&&selected.instructions===row.instructions)))return {state:"unknown"};
   pending.delete(key);return {state:"accepted",value:saved};
  }catch{return {state:"unknown"};}
 };
 return {async execute(input,key){let body:RecapDraftInput;try{body=recapDraftSchema.parse(sessionCommandInput(path,input));}catch{return {state:"rejected",message:"INVALID_REQUEST"};}pending.set(key,structuredClone(body));return submit(body,key);},async reconcile(key){const body=pending.get(key);return body?submit(body,key):{state:"rejected",message:"No unresolved request"};}};
}
export function sessionRecapShareCommand(sessionId:string):CommandPort<RecapShareInput,{publicationId:string;sharedAt:string}>{
 const path=`/${sessionId}/share`,pending=new Map<string,Omit<RecapShareInput,"sessionId">>();
 const submit=async(input:Omit<RecapShareInput,"sessionId">,key:string):Promise<CommandOutcome<{publicationId:string;sharedAt:string}>>=>{
  const result=await write<{publicationId:string;sharedAt:string}>(path,input,key);if(result.state!=="accepted"){if(result.state==="rejected")pending.delete(key);return result;}
  try{const value=recapPublicationSchema.parse(await read(`/${sessionId}/publications/${result.value.publicationId}`));if(value.publicationId!==result.value.publicationId||value.sharedAt!==result.value.sharedAt||value.sessionId!==sessionId||value.recap.sessionId!==sessionId||value.recap.version!==input.expectedVersion||value.contentDigest!==input.expectedDigest||!sameIds(value.recipientAccountIds,input.recipientAccountIds))return {state:"unknown"};pending.delete(key);return result;}catch{return {state:"unknown"};}
 };
 return {async execute(input,key){let body:Omit<RecapShareInput,"sessionId">;try{body=recapShareInputSchema.parse(sessionCommandInput(path,input));}catch{return {state:"rejected",message:"INVALID_REQUEST"};}pending.set(key,structuredClone(body));return submit(body,key);},async reconcile(key){const body=pending.get(key);return body?submit(body,key):{state:"rejected",message:"No unresolved request"};}};
}
export async function sessionEnsure(caseId:string,appointmentId:string){const result=await write<{sessionId:string}>("/ensure",{caseId,appointmentId});if(result.state!=="accepted")throw new Error(result.state);return result.value;}
export function sessionCommand<I,O>(path:string):CommandPort<I,O>{const pending=new Map<string,unknown>();return {async execute(input,key){let body:unknown;try{body=structuredClone(sessionCommandInput(path,input));}catch{return {state:"rejected",message:"INVALID_REQUEST"};}pending.set(key,body);const result=await write<O>(path,body,key);if(result.state!=="unknown")pending.delete(key);return result;},async reconcile(key){if(!pending.has(key))return {state:"rejected",message:"No unresolved request"};const result=await write<O>(path,pending.get(key),key);if(result.state!=="unknown")pending.delete(key);return result;}};}
export interface SpeakerSaveReceipt {version:number;revision:number;recordedAt:string;}
/** A 201 alone is not a confirmed saved label. Keep the exact request/key until
 * an authorized read returns that immutable revision, even if a later edit exists. */
export function sessionSpeakerCommand(sessionId:string):CommandPort<SpeakerCorrectionInput&{sessionId:string},SpeakerSaveReceipt>{
 const path=`/${sessionId}/speakers`,pending=new Map<string,SpeakerCorrectionInput>();
 const submit=async(input:SpeakerCorrectionInput,key:string):Promise<CommandOutcome<SpeakerSaveReceipt>>=>{
  const result=await write<SpeakerSaveReceipt>(path,input,key);
  if(result.state!=="accepted"){if(result.state==="rejected")pending.delete(key);return result;}
  try{
   const receipt=result.value,detail=await read<SessionDetail>(`/${sessionId}`),saved=detail.privateRecords?.transcript;
   const revision=saved?.speakerHistory.versions.find(row=>row.revision===receipt.revision);
   if(detail.sessionId!==sessionId||saved?.version!==input.transcriptVersion||receipt.version!==input.transcriptVersion||receipt.revision!==input.expectedRevision+1||!revision||revision.recordedAt!==receipt.recordedAt||!sameSpeakerLabels(input.labels,revision.labels))return {state:"unknown"};
   pending.delete(key);return result;
  }catch{return {state:"unknown"};}
 };
 return {async execute(input,key){let body:SpeakerCorrectionInput;try{body=structuredClone(sessionCommandInput(path,input)) as SpeakerCorrectionInput;}catch{return {state:"rejected",message:"INVALID_REQUEST"};}pending.set(key,body);return submit(body,key);},async reconcile(key){const input=pending.get(key);return input?submit(input,key):{state:"rejected",message:"No unresolved request"};}};
}
