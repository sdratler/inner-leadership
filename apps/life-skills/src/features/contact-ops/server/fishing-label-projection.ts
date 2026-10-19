import "server-only";
import {FISHING_ACADEMY_LEAD_LABEL,fishingLabelProjectionSchema,fishingLabelBindingSchema,fishingLabelVerified,
 type FishingLabelBinding,type FishingLabelProjection} from "../core/fishing-lead.ts";

/** Normalized exact-account evidence from the existing authorized connector.
 * Unknown/unavailable is NOT known unsupported. A source URL is not capability.
 * This interface grants no access, provider effects or automatic scheduling. */
export type FishingLabelCapability={accountId:string;checkedAt:string;state:"supported"|"unsupported"};
export type FishingLabelReadback={binding:FishingLabelBinding;present:boolean;checkedAt:string;labelName?:string};
export type FishingLabelPorts={
 accountId:string;now:()=>Date;
 // Serializes provider jobs for this workspace; native Add/Remove remains
 // independent of external I/O. Busy jobs fail boundedly without pool starvation.
 serial:<T>(work:()=>Promise<T>)=>Promise<T>;
 current:()=>Promise<FishingLabelProjection>;
 record:(expected:FishingLabelProjection,next:FishingLabelProjection,readback?:FishingLabelReadback&{generation:number})=>Promise<boolean>;
 capability:()=>Promise<FishingLabelCapability>;
 // Exact-account inventory evidence. Academy sync never guesses a label ID
 // from its name, uses LS • Lead, or creates/renames provider labels here.
 labels?:()=>Promise<{accountId:string;checkedAt:string;labels:{id:string;name:string}[]}>;
 // Must return a provider-resolved, registered managed Business-label/chat
 // binding, not a phone+suffix, group, display-name match or custom List.
 binding:()=>Promise<FishingLabelBinding|null>;
 read:(binding:FishingLabelBinding)=>Promise<FishingLabelReadback>;
 // Only association POST/DELETE; no label/chat delete, message, contact import,
 // group addition or account creation. Definite 4xx vs uncertain timeout/5xx.
 change:(binding:FishingLabelBinding,present:boolean)=>Promise<{status:number}>;
};
export type FishingLabelReconciliation={state:"unconfigured"|"unsupported"|"pending"|"failed"|"outcome_unknown"|"verified"|"superseded";generation:number};
const sameBinding=(a:FishingLabelBinding,b:FishingLabelBinding)=>a.accountId===b.accountId&&a.managedLabelId===b.managedLabelId&&a.chatId===b.chatId;
const sameTarget=(a:FishingLabelProjection,b:FishingLabelProjection)=>a.workspaceId===b.workspaceId&&a.personId===b.personId&&a.program===b.program&&
 a.generation===b.generation&&a.desiredPresent===b.desiredPresent&&JSON.stringify(a.binding)===JSON.stringify(b.binding);
const fresh=(time:string,now:Date)=>Number.isFinite(Date.parse(time))&&Date.parse(time)<=now.getTime()&&now.getTime()-Date.parse(time)<=60_000;
const observation=(p:FishingLabelProjection,status:Exclude<FishingLabelProjection["status"],"unsupported"|"verified">)=>
 fishingLabelProjectionSchema.parse({...p,status,verifiedAt:null,capability:undefined,
  unresolvedEffect:p.unresolvedEffect??(status==="outcome_unknown"&&p.binding?{generation:p.generation,binding:p.binding}:undefined)});

/** One bounded serial pass. ALWAYS read before a retry/unknown outcome; never
 * resend merely because native Add succeeded or a request was accepted. All
 * writes are exact latest-generation/binding CAS. No in-process retry timer. */
export async function reconcileFishingLabel(expected:FishingLabelProjection,ports:FishingLabelPorts):Promise<FishingLabelReconciliation>{
 expected=fishingLabelProjectionSchema.parse(expected);
 return ports.serial(async()=>{
  let current=fishingLabelProjectionSchema.parse(await ports.current());
  if(!sameTarget(expected,current))return {state:"superseded",generation:current.generation};
  const result=(state:FishingLabelReconciliation["state"]):FishingLabelReconciliation=>({state,generation:current.generation});
  const unavailable=async()=>{
   const status=current.status==="outcome_unknown"||current.unresolvedEffect?"outcome_unknown":current.binding?"pending":"unconfigured";
   return result(await ports.record(current,observation(current,status))?status:"superseded");
  };
  let cap:FishingLabelCapability;
  try{cap=await ports.capability();}catch{return unavailable();}
  if(cap.accountId!==ports.accountId||!fresh(cap.checkedAt,ports.now()))return unavailable();
  if(cap.state==="unsupported"){
   if(current.status==="outcome_unknown"||current.unresolvedEffect)return result("outcome_unknown"); // Cannot erase a prior generation's possible effect.
   const next=fishingLabelProjectionSchema.parse({...current,status:"unsupported",verifiedAt:null,
    capability:{accountId:cap.accountId,labelsSupported:false,checkedAt:cap.checkedAt}});
   return result(await ports.record(current,next)?"unsupported":"superseded");
  }
  if(cap.state!=="supported")throw Error("FISHING_LABEL_CAPABILITY_INVALID");
  let academyLabelId:string|null=null;
  if(current.program==="sunday_fishing_academy"){
   try{
    const catalog=await ports.labels?.();
    if(!catalog||catalog.accountId!==ports.accountId||!fresh(catalog.checkedAt,ports.now()))return unavailable();
    const matches=catalog.labels.filter(label=>label.name===FISHING_ACADEMY_LEAD_LABEL);
    if(matches.length!==1||!matches[0]!.id||catalog.labels.filter(label=>label.id===matches[0]!.id).length!==1)return unavailable();
    academyLabelId=matches[0]!.id;
   }catch{return unavailable();}
  }
  if(current.binding===null){
   let binding:FishingLabelBinding|null;try{binding=await ports.binding();}catch{return result("unconfigured");}
   if(!binding)return result("unconfigured");binding=fishingLabelBindingSchema.parse(binding);
   if(binding.accountId!==ports.accountId)throw Error("FISHING_LABEL_ACCOUNT_MISMATCH");
   if(academyLabelId!==null&&binding.managedLabelId!==academyLabelId)return result("unconfigured");
   const next=fishingLabelProjectionSchema.parse({...current,binding,status:"pending",capability:undefined,verifiedAt:null});
   if(!await ports.record(current,next))return result("superseded");current=next;
  }
  if(current.binding!.accountId!==ports.accountId)throw Error("FISHING_LABEL_ACCOUNT_MISMATCH");
  if(academyLabelId!==null&&current.binding!.managedLabelId!==academyLabelId)return unavailable();
  const read=async()=>{
   const value=await ports.read(current.binding!);
   if(!sameBinding(value.binding,current.binding!)||!fresh(value.checkedAt,ports.now())||academyLabelId!==null&&value.labelName!==FISHING_ACADEMY_LEAD_LABEL)throw Error("FISHING_LABEL_READBACK_INVALID");return value;
  };
  let before:FishingLabelReadback;
  try{before=await read();}catch{return unavailable();}
  if(before.present===current.desiredPresent){
   const next=fishingLabelVerified(observation(current,"pending"),{...before,generation:current.generation});
   return result(await ports.record(current,next,{...before,generation:current.generation})?"verified":"superseded");
  }
  const latest=fishingLabelProjectionSchema.parse(await ports.current());
  if(!sameTarget(current,latest)||JSON.stringify(current)!==JSON.stringify(latest))return {state:"superseded",generation:latest.generation};
  // Durable unknown BEFORE external I/O covers a killed process/lost response.
  const uncertain=observation(current,"outcome_unknown");
  if(!await ports.record(current,uncertain))return result("superseded");current=uncertain;
  let status:number|null=null;try{status=(await ports.change(current.binding!,current.desiredPresent)).status;}catch{/* Outcome remains unknown until actual readback. */}
  let after:FishingLabelReadback;
  try{after=await read();}catch{
   if(status!==null&&[400,401,402,403,422,429].includes(status)){
    return result(await ports.record(current,observation(current,"failed"))?"failed":"superseded");
   }
   return result("outcome_unknown");
  }
  if(after.present===current.desiredPresent){
   const next=fishingLabelVerified(current,{...after,generation:current.generation});
   return result(await ports.record(current,next,{...after,generation:current.generation})?"verified":"superseded");
  }
  // Readback proves the latest desired association is not present/absent yet.
  // POST409 and DELETE404 still require this exact observation, not assumptions.
  return result(await ports.record(current,observation(current,status!==null&&status>=400&&status<500?"failed":"pending"))?
   status!==null&&status>=400&&status<500?"failed":"pending":"superseded");
 });
}
