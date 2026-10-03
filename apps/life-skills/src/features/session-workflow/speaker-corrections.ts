import {z} from "zod";
import {AppError} from "../../lib/errors.ts";
import {validIso} from "./policy.ts";
import type {Transcript} from "./types.ts";

// The route cannot accept more label bytes than the existing complete encrypted
// revision record can retain. This does not change the general JSON body limit.
export const MAX_SPEAKER_RECORD_BYTES=2000000;
const label=z.string().min(1).max(100).refine(value=>value.trim().length>0);
// z.record normalizes reserved own keys such as __proto__; retain the exact
// caller's plain dictionary while validating every own key/value instead.
const labelsSchema=z.custom<Record<string,string>>(value=>Boolean(value&&typeof value==="object"&&!Array.isArray(value)&&[null,Object.prototype].includes(Object.getPrototypeOf(value))&&Object.keys(value).length<=20000&&Object.entries(value).every(([key,text])=>label.safeParse(key).success&&label.safeParse(text).success)));
export const speakerCorrectionInput=z.strictObject({transcriptVersion:z.number().int().min(1).max(2147483647),expectedRevision:z.number().int().min(0).max(100),labels:labelsSchema});
export type SpeakerCorrectionInput=z.infer<typeof speakerCorrectionInput>;
export interface SpeakerCorrection {revision:number;recordedByAccountId:string;recordedAt:string;labels:Readonly<Record<string,string>>;}
export interface SpeakerHistory {schemaVersion:1;revision:number;originalLabels:Readonly<Record<string,string>>;versions:readonly SpeakerCorrection[];}
const correction=z.strictObject({revision:z.number().int().min(1).max(100),recordedByAccountId:z.string().uuid(),recordedAt:z.string().datetime({offset:true}),labels:labelsSchema});
const historySchema=z.strictObject({schemaVersion:z.literal(1),revision:z.number().int().min(1).max(100),originalLabels:labelsSchema,versions:z.array(correction).min(1).max(100)});
function validateLabels(value:unknown,transcript:Transcript):asserts value is Record<string,string>{
  labelsSchema.parse(value);
  if(Object.keys(value as object).length>20000)throw new Error("SPEAKER_BOUND");
  const source=new Set(transcript.segments.map(segment=>segment.speaker));
  if(Object.keys(value as object).some(key=>!source.has(key)))throw new Error("SPEAKER_MAPPING");
}
/** Preserve the pre-correction mapping as unattributed baseline, never inventing an actor/date.
 * Schema parsing validates, but does not normalize prototype-named own labels away. */
export function readSpeakerHistory(value:unknown,transcript:Transcript):SpeakerHistory{
  try{
    if(value&&typeof value==="object"&&!Array.isArray(value)&&Object.hasOwn(value,"schemaVersion")&&typeof (value as {schemaVersion:unknown}).schemaVersion==="number"){
      historySchema.parse(value);const history=value as SpeakerHistory;
      validateLabels(history.originalLabels,transcript);
      if(history.revision!==history.versions.length)throw new Error();
      let prior=-Infinity;
      history.versions.forEach((version,index)=>{if(version.revision!==index+1||!validIso(version.recordedAt)||Date.parse(version.recordedAt)<prior)throw new Error();prior=Date.parse(version.recordedAt);validateLabels(version.labels,transcript);});
      return history;
    }
    validateLabels(value,transcript);return {schemaVersion:1,revision:0,originalLabels:value,versions:[]};
  }catch{throw new AppError("UNAVAILABLE");}
}
export function currentSpeakerLabels(history:SpeakerHistory):Readonly<Record<string,string>>{return history.versions.at(-1)?.labels??history.originalLabels;}
export function appendSpeakerCorrection(history:SpeakerHistory,transcript:Transcript,input:SpeakerCorrectionInput,actorId:string,recordedAt:string):SpeakerHistory{
  // Service methods are also a boundary; do not rely only on the HTTP schema.
  if(!speakerCorrectionInput.safeParse(input).success)throw new AppError("INVALID_REQUEST");
  try{validateLabels(input.labels,transcript);}catch{throw new AppError("INVALID_REQUEST");}
  if(input.transcriptVersion!==transcript.version||input.expectedRevision!==history.revision)throw new AppError("CONFLICT");
  // A known capacity rejection is terminal, not an ambiguous server outage.
  // Retain every private revision; never trim history to admit another write.
  if(history.revision>=100)throw new AppError("PAYLOAD_TOO_LARGE");
  const version={revision:history.revision+1,recordedByAccountId:actorId,recordedAt,labels:input.labels};
  return readSpeakerHistory({schemaVersion:1,revision:version.revision,originalLabels:history.originalLabels,versions:[...history.versions,version]},transcript);
}
export function sameSpeakerLabels(a:Readonly<Record<string,string>>,b:Readonly<Record<string,string>>):boolean{
  const keys=Object.keys(a);return keys.length===Object.keys(b).length&&keys.every(key=>Object.hasOwn(b,key)&&a[key]===b[key]);
}
