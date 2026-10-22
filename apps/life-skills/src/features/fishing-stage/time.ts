import {floridaZone,occurrenceTimeSchema} from "./contract.ts";
import type {OccurrenceProjection} from "../fishing/contract.ts";

const wallFormatter=new Intl.DateTimeFormat("en-CA",{timeZone:floridaZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"});
function wallAt(instant:number){const p=Object.fromEntries(wallFormatter.formatToParts(instant).map(v=>[v.type,v.value]));return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;}
/** A wall time may have zero or two real instants. Never choose silently. */
export function floridaWallTimeCandidates(wall:string):string[]{
 if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(wall))throw Error("FISHING_TIME_INVALID");
 const guess=Date.parse(wall+":00Z");
 if(!Number.isFinite(guess)||new Date(guess).toISOString().slice(0,16)!==wall)throw Error("FISHING_TIME_INVALID");
 const candidates:string[]=[];
 // Explicit instants; covers all current IANA offsets without a local-time parser.
 for(let offset=-14*60;offset<=14*60;offset+=15){const utc=guess-offset*60_000;if(wallAt(utc)===wall)candidates.push(new Date(utc).toISOString());}
 return candidates.sort();
}
export function resolveFloridaWallTime(wall:string,chosenInstant?:string):string{
 const candidates=floridaWallTimeCandidates(wall);
 if(!candidates.length)throw Error("FISHING_TIME_NONEXISTENT");
 if(chosenInstant!==undefined){const parsed=Date.parse(chosenInstant);if(!Number.isFinite(parsed)||!/(?:Z|[+-]\d{2}:\d{2})$/.test(chosenInstant))throw Error("FISHING_TIME_INVALID");const selected=new Date(parsed).toISOString();if(!candidates.includes(selected))throw Error("FISHING_TIME_CHOICE_MISMATCH");return selected;}
 if(candidates.length!==1)throw Error("FISHING_TIME_CHOICE_REQUIRED");
 return candidates[0]!;
}
export function canonicalTime(value:unknown):OccurrenceProjection["time"]{
 const time=occurrenceTimeSchema.parse(value);
 return time.kind==="undated"?time:{...time,startsAt:new Date(time.startsAt).toISOString(),endsAt:new Date(time.endsAt).toISOString()};
}
export function noticeState(receivedAt:string,originalStartsAt:string,reason:"ordinary_absence"|"unavoidable"){
 const received=Date.parse(receivedAt),starts=Date.parse(originalStartsAt);
 if(!Number.isFinite(received)||!Number.isFinite(starts))throw Error("FISHING_TIME_INVALID");
 return starts-received>=24*60*60*1000?"protected" as const:reason==="unavoidable"?"operator_review" as const:"best_effort" as const;
}
