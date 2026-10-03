import { sessionInfo } from "../identity/client.ts";
import type { CommandOutcome,CommandPort } from "../../ui/revamp/use-command.ts";
import { sessionCommandInput } from "./command-input.ts";
import {sameSpeakerLabels,type SpeakerCorrectionInput} from "./speaker-corrections.ts";
import type {SessionDetail} from "./database.ts";
type Envelope<T>={ok:boolean;data?:T;error?:{code?:string}};
async function read<T>(path:string,signal?:AbortSignal):Promise<T>{const response=await fetch(`/api/sessions${path}`,{credentials:"same-origin",cache:"no-store",...(signal?{signal}:{})});const body=await response.json() as Envelope<T>;if(!response.ok||!body.ok||body.data===undefined)throw new Error(body.error?.code??"UNAVAILABLE");return body.data;}
async function write<T>(path:string,input:unknown,key?:string):Promise<CommandOutcome<T>>{try{const session=await sessionInfo(),response=await fetch(`/api/sessions${path}`,{method:"POST",credentials:"same-origin",cache:"no-store",headers:{"Content-Type":"application/json","X-CSRF-Token":session.csrfToken,...(key?{"Idempotency-Key":key}:{})},body:JSON.stringify(input)}),body=await response.json() as Envelope<T>;if(response.ok&&body.ok&&body.data!==undefined)return {state:"accepted",value:body.data};if(response.status>=500)return {state:"unknown"};return {state:"rejected",message:body.error?.code??"Request rejected"};}catch{return {state:"unknown"};}}
export const sessionRead=read;
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
   const receipt=result.value,detail=await read<SessionDetail>(`/${sessionId}?transcriptVersion=${input.transcriptVersion}`),saved=detail.privateRecords?.transcript;
   const revision=saved?.speakerHistory.versions.find(row=>row.revision===receipt.revision);
   if(detail.sessionId!==sessionId||saved?.version!==input.transcriptVersion||receipt.version!==input.transcriptVersion||receipt.revision!==input.expectedRevision+1||!revision||revision.recordedAt!==receipt.recordedAt||!sameSpeakerLabels(input.labels,revision.labels))return {state:"unknown"};
   pending.delete(key);return result;
  }catch{return {state:"unknown"};}
 };
 return {async execute(input,key){let body:SpeakerCorrectionInput;try{body=structuredClone(sessionCommandInput(path,input)) as SpeakerCorrectionInput;}catch{return {state:"rejected",message:"INVALID_REQUEST"};}pending.set(key,body);return submit(body,key);},async reconcile(key){const input=pending.get(key);return input?submit(input,key):{state:"rejected",message:"No unresolved request"};}};
}
