import {it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {randomBytes} from "node:crypto";
import {authoritySchema,assertPlanBinding,decodeNative,digest,encodeNative,nativeLimits,parseSnapshot,planHeaderSchema} from "../../../src/features/fishing-stage/native-storage.ts";
import {NativeFishingStageStore} from "../../../src/features/fishing-stage/native-store.ts";
import type {FishingStageNativeHooks} from "../../../src/features/fishing/native-stage-ports.ts";
import {FishingStageService} from "../../../src/features/fishing-stage/service.ts";
import {Fixture,actor,id,ref} from "./fixture.ts";
const ring={activeKeyId:"synthetic",keys:{synthetic:randomBytes(32)}};
async function snapshot(){const f=new Fixture();await new FishingStageService(f,{now:()=>f.now}).execute(actor(),ref,{action:"create",operationId:id(101),expectedRevision:0,templateVersion:f.template.version,childCapacity:4});return parseSnapshot({state:f.state,links:[]});}
function header(s:Awaited<ReturnType<typeof snapshot>>){return planHeaderSchema.parse({...ref,workspaceId:actor().workspaceId,templateVersion:s.state.template.version,revision:s.state.revision,stateHash:digest(s)});}
it("roundtrips real identity AEAD for a snapshot larger than one seal limit without plaintext fields",async()=>{
 const s=await snapshot();for(const o of s.state.occurrences)Object.assign(o,{location:"א".repeat(1000),directions:"א".repeat(1000),equipment:"א".repeat(1000),logisticalNote:"א".repeat(1000)});
 const value=parseSnapshot(s),h=header(value);expect(Buffer.byteLength(JSON.stringify(value))).toBeGreaterThan(65536);
 const encoded=encodeNative("plan",h,value,ring);expect(encoded).not.toContain("logisticalNote");expect(encoded).not.toContain("Synthetic instructor");
 const decoded=parseSnapshot(decodeNative("plan",h,encoded,ring));assertPlanBinding(h,decoded);expect(decoded).toEqual(value);
});
it("rejects changed physical headers, record kinds, reordered/truncated/repeated encrypted parts",async()=>{
 const s=await snapshot(),h=header(s),encoded=encodeNative("plan",h,{payload:"x".repeat(50000)},ring);
 for(const changed of [{...h,stageId:id(999)},{...h,revision:2},{...h,stateHash:"b".repeat(64)}])expect(()=>decodeNative("plan",changed,encoded,ring)).toThrow();
 expect(()=>decodeNative("revision",h,encoded,ring)).toThrow();
 const envelope=JSON.parse(encoded) as {version:number;parts:string[]};
 for(const parts of [envelope.parts.slice(1),[...envelope.parts].reverse(),[envelope.parts[0]!,envelope.parts[0]!,envelope.parts[2]!]])expect(()=>decodeNative("plan",h,JSON.stringify({...envelope,parts}),ring)).toThrow();
});
it("fails closed on oversize writes and malformed/oversize encrypted reads",()=>{
 expect(()=>encodeNative("plan",{},"x".repeat(nativeLimits.snapshotBytes),ring)).toThrow();
 expect(()=>encodeNative("operation",{},"x".repeat(8192),ring)).toThrow();
 for(const value of ["not-json","x".repeat(nativeLimits.envelopeBytes+1),JSON.stringify({version:1,parts:[]})])expect(()=>decodeNative("plan",{},value,ring)).toThrow();
});
it("validates snapshot shape and authenticated hash before exposing decoded records",async()=>{
 const s=await snapshot(),h=header(s);expect(()=>parseSnapshot({...s,state:{...s.state,privateTeacherNote:"foreign"}})).toThrow();
 expect(()=>parseSnapshot({...s,state:{...s.state,occurrences:s.state.occurrences.slice(1)}})).toThrow();
 const altered=structuredClone(s);Object.assign(altered.state.occurrences[0]!,{location:"altered"});expect(()=>assertPlanBinding(h,altered)).toThrow();
 const wrongHistory=structuredClone(s);wrongHistory.state.history.push({...wrongHistory.state.occurrences[0]!,moduleVersion:"wrong-history-version"});expect(()=>parseSnapshot(wrongHistory)).toThrow();
});
it("does not allow a MAIN hook to provide actor or session authority",()=>{
 expect(()=>authoritySchema.parse({actor:actor(),sessionRevoked:false})).toThrow();
});
it("requires every MAIN hook and never opens a database as a fallback",()=>{
 const transaction=vi.fn(async()=>{throw Error("must not open");});
 expect(()=>new NativeFishingStageStore({transaction},ring,{actor:actor(),selection:{selectedEnrollmentId:null}},{} as FishingStageNativeHooks)).toThrow();expect(transaction).not.toHaveBeenCalled();
});
