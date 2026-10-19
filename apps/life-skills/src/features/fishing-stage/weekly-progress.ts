import {z} from "zod";

/** Pure shared schema/transition module. Root owns fresh operator/guardian and
 * enrollment authorization, native stage CAS, replay, encryption and persistence.
 * Facts and digest/ID functions must be server-resolved in that same transaction.
 * A structurally valid object is not authority. There are no runtime imports,
 * default state, senders, booking/delivery effects or clinical-report adapters. */
export const weeklySkillIds=[
 "equipment_care","rod_reel_line","basic_knots","rig_construction","casting_control","safe_hook_handling",
 "bait_terminal_tackle","reading_conditions","fish_identification_handling","teamwork","listening",
 "communication","persistence","self_governance",
] as const;
export const weeklyLimits=Object.freeze({observations:512,recapVersions:256,stateBytes:512*1024,skillsPerCommand:14});
const uuid=z.uuid(),revision=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const hash=z.string().regex(/^[a-f0-9]{64}$/);
const text=(max:number,required=false)=>z.string().max(max).refine(value=>
 (!required||value.trim().length>0)&&value===value.trim()&&!/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value));
const name=text(120,true),skillId=z.enum(weeklySkillIds),level=z.enum(["introduced","practicing","demonstrated"]);
const instant=z.iso.datetime({offset:true}).max(40).refine(value=>{
 const y=Number(value.slice(0,4)),m=Number(value.slice(5,7)),d=Number(value.slice(8,10));
 const leap=y%4===0&&(y%100!==0||y%400===0),days=[31,leap?29:28,31,30,31,30,31,31,30,31,30,31];
 return y>=1&&m>=1&&m<=12&&d>=1&&d<=days[m-1]!&&Number.isFinite(Date.parse(value));
});
const occurrenceSchema=z.strictObject({id:uuid,revision:revision.min(1),moduleId:name,moduleVersion:name,
 startsAt:instant,endsAt:instant,state:z.enum(["draft","published","completed","cancelled"])});
const enrollmentSchema=z.strictObject({id:uuid,learnerId:uuid});
const attendanceSchema=z.strictObject({state:z.enum(["present","late","absent","no_show"]),recordedAt:instant,recordedBy:uuid});
const sourceFactsSchema=z.strictObject({now:instant,occurrence:occurrenceSchema,enrollment:enrollmentSchema,attendance:attendanceSchema});
type SourceFacts=z.infer<typeof sourceFactsSchema>;
export type WeeklyReadFacts=SourceFacts&{digest:(value:unknown)=>string};
export type WeeklyFacts=WeeklyReadFacts&{actorId:string;nextId:()=>string};

const common={operationId:uuid,expectedRevision:revision,occurrenceId:uuid,expectedOccurrenceRevision:revision.min(1),enrollmentId:uuid};
const skillObservationSchema=z.strictObject({skillId,level,evidence:text(600,true)});
const unique=<T>(items:readonly T[])=>new Set(items).size===items.length;
export const weeklyCommandSchemas=[
 z.strictObject({...common,action:z.literal("observe_skills"),
  observations:z.array(skillObservationSchema).min(1).max(14).refine(items=>unique(items.map(item=>item.skillId)))}),
 z.strictObject({...common,action:z.literal("draft_weekly_recap"),expectedRecapVersion:revision,
  locale:z.enum(["en","he"]),groupWork:text(600,true),observationIds:z.array(uuid).min(1).max(14).refine(unique),
  nextStep:text(400,true),gearReminder:text(300),questionInvitation:text(200)}),
 z.strictObject({...common,action:z.literal("review_weekly_recap"),recapId:uuid,expectedRecapVersion:revision.min(1)}),
 z.strictObject({...common,action:z.literal("publish_weekly_recap"),recapId:uuid,expectedRecapVersion:revision.min(1)}),
] as const;
export const weeklyCommandSchema=z.discriminatedUnion("action",weeklyCommandSchemas);
export type WeeklyCommand=z.infer<typeof weeklyCommandSchema>;
const observationSchema=z.strictObject({id:uuid,operationId:uuid,recordedAt:instant,recordedBy:uuid,
 learnerId:uuid,enrollmentId:uuid,occurrenceId:uuid,occurrenceRevision:revision.min(1),moduleId:name,moduleVersion:name,
 skillId,level,evidence:text(600,true)});
export type WeeklyObservation=z.infer<typeof observationSchema>;
const safeSkillSchema=z.strictObject({skillId,level,observedAt:instant});
const stampSchema=z.strictObject({actorId:uuid,at:instant,digest:hash});
const recapSchema=z.strictObject({
 id:uuid,version:revision.min(1),state:z.enum(["draft","reviewed","published"]),operationId:uuid,
 enrollmentId:uuid,learnerId:uuid,occurrenceId:uuid,moduleId:name,moduleVersion:name,
 locale:z.enum(["en","he"]),groupWork:text(600,true),observationIds:z.array(uuid).min(1).max(14).refine(unique),
 nextStep:text(400,true),gearReminder:text(300),questionInvitation:text(200),
 skills:z.array(safeSkillSchema).min(1).max(14),
 source:z.strictObject({occurrence:occurrenceSchema,attendance:attendanceSchema,observationSetDigest:hash}),
 sourceDigest:hash,authoredAt:instant,authoredBy:uuid,review:stampSchema.nullable(),publication:stampSchema.nullable(),
});
export type WeeklyRecap=z.infer<typeof recapSchema>;
const stateShape=z.strictObject({observations:z.array(observationSchema).max(weeklyLimits.observations),
 recaps:z.array(recapSchema).max(weeklyLimits.recapVersions)});
export type WeeklyState=z.infer<typeof stateShape>;
export type WeeklyPublication=Pick<WeeklyRecap,"id"|"version"|"enrollmentId"|"learnerId"|"occurrenceId"|"moduleId"|"moduleVersion"|
 "locale"|"groupWork"|"nextStep"|"gearReminder"|"questionInvitation"|"skills">&{publishedAt:string};
export class WeeklyProgressError extends Error{
 constructor(readonly code:"INVALID_REQUEST"|"CONFLICT"|"UNAVAILABLE"){super(code);this.name="WeeklyProgressError";}
}
const same=(a:unknown,b:unknown)=>JSON.stringify(a)===JSON.stringify(b);
const eventKey=(enrollmentId:string,occurrenceId:string)=>enrollmentId+"/"+occurrenceId;
const safeSkill=(o:WeeklyObservation)=>({skillId:o.skillId,level:o.level,observedAt:o.recordedAt});
const stampTime=(r:WeeklyRecap)=>r.publication?.at??r.review?.at??r.authoredAt;
function body(r:WeeklyRecap){
 return {id:r.id,enrollmentId:r.enrollmentId,learnerId:r.learnerId,occurrenceId:r.occurrenceId,moduleId:r.moduleId,moduleVersion:r.moduleVersion,
  locale:r.locale,groupWork:r.groupWork,observationIds:r.observationIds,nextStep:r.nextStep,gearReminder:r.gearReminder,
  questionInvitation:r.questionInvitation,skills:r.skills,source:r.source,sourceDigest:r.sourceDigest,authoredAt:r.authoredAt,authoredBy:r.authoredBy};
}
function eligible(source:SourceFacts):boolean{
 return source.occurrence.state==="completed"&&Date.parse(source.occurrence.endsAt)>Date.parse(source.occurrence.startsAt)&&
  Date.parse(source.occurrence.endsAt)<=Date.parse(source.now)&&Date.parse(source.attendance.recordedAt)<=Date.parse(source.now)&&
  (source.attendance.state==="present"||source.attendance.state==="late");
}
function bound(o:WeeklyObservation,r:Pick<WeeklyRecap,"enrollmentId"|"learnerId"|"occurrenceId"|"moduleId"|"moduleVersion">):boolean{
 return o.enrollmentId===r.enrollmentId&&o.learnerId===r.learnerId&&o.occurrenceId===r.occurrenceId&&
  o.moduleId===r.moduleId&&o.moduleVersion===r.moduleVersion;
}
function validHistory(state:WeeklyState):boolean{
 const observations=new Map<string,WeeklyObservation>(),ids=new Set<string>(),operations=new Map<string,string>();
 const enrollments=new Map<string,string>(),latest=new Map<string,WeeklyRecap>();
 for(const o of state.observations){
  if(ids.has(o.id)||enrollments.has(o.enrollmentId)&&enrollments.get(o.enrollmentId)!==o.learnerId)return false;
  ids.add(o.id);observations.set(o.id,o);enrollments.set(o.enrollmentId,o.learnerId);
  const batch=JSON.stringify([o.enrollmentId,o.learnerId,o.occurrenceId,o.occurrenceRevision,o.moduleId,o.moduleVersion,o.recordedAt,o.recordedBy]);
  if(operations.has(o.operationId)&&operations.get(o.operationId)!==batch)return false;
  operations.set(o.operationId,batch);
 }
 for(const operation of operations.keys()){
  const batch=state.observations.filter(o=>o.operationId===operation);
  if(batch.length>14||!unique(batch.map(o=>o.skillId)))return false;
 }
 for(const r of state.recaps){
  if(operations.has(r.operationId)||enrollments.has(r.enrollmentId)&&enrollments.get(r.enrollmentId)!==r.learnerId)return false;
  operations.set(r.operationId,"recap");enrollments.set(r.enrollmentId,r.learnerId);
  const selected=r.observationIds.map(id=>observations.get(id));
  if(selected.some(o=>!o||!bound(o,r)||o.occurrenceRevision!==r.source.occurrence.revision||Date.parse(o.recordedAt)>Date.parse(r.authoredAt))||
   !unique(selected.map(o=>o?.skillId))||!same(selected.map(o=>safeSkill(o!)),r.skills))return false;
  const source=r.source;
  if(source.occurrence.id!==r.occurrenceId||source.occurrence.moduleId!==r.moduleId||source.occurrence.moduleVersion!==r.moduleVersion||
   !eligible({now:r.authoredAt,occurrence:source.occurrence,attendance:source.attendance,enrollment:{id:r.enrollmentId,learnerId:r.learnerId}}))return false;
  const key=eventKey(r.enrollmentId,r.occurrenceId),previous=latest.get(key);
  if(r.version!==(previous?.version??0)+1||previous&&Date.parse(stampTime(r))<Date.parse(stampTime(previous)))return false;
  if(r.state==="draft"){
   if(ids.has(r.id)||r.review!==null||r.publication!==null)return false;ids.add(r.id);
  }else{
   if(!previous||previous.id!==r.id||!same(body(previous),body(r))||!r.review||r.review.digest!==r.sourceDigest||
    Date.parse(r.review.at)<Date.parse(r.authoredAt))return false;
   if(r.state==="reviewed"){
    if(previous.state!=="draft"||r.publication!==null)return false;
   }else if(previous.state!=="reviewed"||!same(previous.review,r.review)||!r.publication||
    r.publication.digest!==r.sourceDigest||Date.parse(r.publication.at)<Date.parse(r.review.at))return false;
  }
  latest.set(key,r);
 }
 return true;
}
export const weeklyStateSchema=stateShape.superRefine((state,context)=>{
 if(new TextEncoder().encode(JSON.stringify(state)).byteLength>weeklyLimits.stateBytes)
  context.addIssue({code:"custom",message:"WEEKLY_STATE_LIMIT"});
 if(!validHistory(state))context.addIssue({code:"custom",message:"INVALID_WEEKLY_HISTORY"});
});
function parse<T>(schema:z.ZodType<T>,value:unknown,code:"INVALID_REQUEST"|"UNAVAILABLE"="INVALID_REQUEST"):T{
 const result=schema.safeParse(value);if(!result.success)throw new WeeklyProgressError(code);return result.data;
}
function digest(facts:WeeklyReadFacts,value:unknown):string{
 if(typeof facts?.digest!=="function")throw new WeeklyProgressError("UNAVAILABLE");
 let result:unknown;try{result=facts.digest(value);}catch{throw new WeeklyProgressError("UNAVAILABLE");}
 if(!hash.safeParse(result).success)throw new WeeklyProgressError("UNAVAILABLE");return result as string;
}
function readSource(facts:WeeklyReadFacts):SourceFacts{
 return parse(sourceFactsSchema,{now:facts?.now,occurrence:facts?.occurrence,enrollment:facts?.enrollment,attendance:facts?.attendance});
}
function observationsFor(state:WeeklyState,enrollmentId:string,occurrenceId:string){
 return state.observations.filter(o=>o.enrollmentId===enrollmentId&&o.occurrenceId===occurrenceId);
}
function sourceDigest(state:WeeklyState,r:WeeklyRecap,facts:WeeklyReadFacts):string{
 const selected=r.observationIds.map(id=>state.observations.find(o=>o.id===id));
 return digest(facts,{version:"JLFA-WEEKLY-PROGRESS-20261019-v1",id:r.id,enrollmentId:r.enrollmentId,learnerId:r.learnerId,
  occurrence:r.source.occurrence,attendance:r.source.attendance,observationSetDigest:r.source.observationSetDigest,
  selectedObservations:selected,locale:r.locale,groupWork:r.groupWork,nextStep:r.nextStep,gearReminder:r.gearReminder,
  questionInvitation:r.questionInvitation,authoredAt:r.authoredAt,authoredBy:r.authoredBy});
}
function current(state:WeeklyState,r:WeeklyRecap,source:SourceFacts,facts:WeeklyReadFacts):boolean{
 if(!eligible(source)||r.enrollmentId!==source.enrollment.id||r.learnerId!==source.enrollment.learnerId||
  !same(r.source.occurrence,source.occurrence)||!same(r.source.attendance,source.attendance)||
  Date.parse(stampTime(r))>Date.parse(source.now))return false;
 const set=observationsFor(state,r.enrollmentId,r.occurrenceId);
 return set.every(o=>Date.parse(o.recordedAt)<=Date.parse(source.now))&&
  digest(facts,set)===r.source.observationSetDigest&&sourceDigest(state,r,facts)===r.sourceDigest;
}
function nextId(state:WeeklyState,facts:WeeklyFacts,allocated:Set<string>):string{
 if(typeof facts.nextId!=="function")throw new WeeklyProgressError("UNAVAILABLE");
 let id:unknown;try{id=facts.nextId();}catch{throw new WeeklyProgressError("UNAVAILABLE");}
 if(!uuid.safeParse(id).success)throw new WeeklyProgressError("UNAVAILABLE");
 const value=id as string;
 if(allocated.has(value)||state.observations.some(o=>o.id===value)||state.recaps.some(r=>r.id===value))throw new WeeklyProgressError("CONFLICT");
 allocated.add(value);return value;
}

/** Returns a fully detached snapshot. expectedRevision and successful operation
 * replay belong to Root's enclosing StageState transaction, never this slice.
 * Retrying an already represented operation directly is a conflict, not a grant. */
export function applyWeeklyCommand(state:WeeklyState,command:WeeklyCommand,facts:WeeklyFacts):WeeklyState{
 const next=parse(weeklyStateSchema,state,"UNAVAILABLE"),c=parse(weeklyCommandSchema,command),source=readSource(facts);
 const actorId=parse(uuid,facts?.actorId),now=source.now;
 if(typeof facts?.nextId!=="function"||typeof facts?.digest!=="function")throw new WeeklyProgressError("UNAVAILABLE");
 if(!eligible(source)||c.enrollmentId!==source.enrollment.id||c.occurrenceId!==source.occurrence.id||
  c.expectedOccurrenceRevision!==source.occurrence.revision)throw new WeeklyProgressError("CONFLICT");
 if(next.observations.some(o=>o.operationId===c.operationId)||next.recaps.some(r=>r.operationId===c.operationId))
  throw new WeeklyProgressError("CONFLICT");
 const previous=next.recaps.filter(r=>r.enrollmentId===c.enrollmentId&&r.occurrenceId===c.occurrenceId).at(-1);
 const existing=observationsFor(next,c.enrollmentId,c.occurrenceId);
 if(existing.some(o=>o.learnerId!==source.enrollment.learnerId||Date.parse(o.recordedAt)>Date.parse(now))||
  previous&&Date.parse(stampTime(previous))>Date.parse(now))throw new WeeklyProgressError("CONFLICT");
 const allocated=new Set<string>();
 if(c.action==="observe_skills"){
  for(const observation of c.observations)next.observations.push({...observation,id:nextId(next,facts,allocated),
   operationId:c.operationId,recordedAt:now,recordedBy:actorId,learnerId:source.enrollment.learnerId,
   enrollmentId:c.enrollmentId,occurrenceId:c.occurrenceId,occurrenceRevision:source.occurrence.revision,
   moduleId:source.occurrence.moduleId,moduleVersion:source.occurrence.moduleVersion});
 }else{
  if(c.expectedRecapVersion!==(previous?.version??0))throw new WeeklyProgressError("CONFLICT");
  const version=(previous?.version??0)+1;
  if(c.action==="draft_weekly_recap"){
   const selected=c.observationIds.map(id=>existing.find(o=>o.id===id));
   if(selected.some(o=>!o||o.learnerId!==source.enrollment.learnerId||o.moduleId!==source.occurrence.moduleId||
    o.moduleVersion!==source.occurrence.moduleVersion||o.occurrenceRevision!==source.occurrence.revision||
    existing.filter(item=>item.skillId===o.skillId).at(-1)?.id!==o.id)||!unique(selected.map(o=>o?.skillId)))
    throw new WeeklyProgressError("CONFLICT");
   const recap:WeeklyRecap={id:nextId(next,facts,allocated),version,state:"draft",operationId:c.operationId,
    enrollmentId:c.enrollmentId,learnerId:source.enrollment.learnerId,occurrenceId:c.occurrenceId,
    moduleId:source.occurrence.moduleId,moduleVersion:source.occurrence.moduleVersion,locale:c.locale,groupWork:c.groupWork,
    observationIds:c.observationIds,nextStep:c.nextStep,gearReminder:c.gearReminder,questionInvitation:c.questionInvitation,
    skills:selected.map(o=>safeSkill(o!)),source:{occurrence:source.occurrence,attendance:source.attendance,
     observationSetDigest:digest(facts,existing)},sourceDigest:"0".repeat(64),authoredAt:now,authoredBy:actorId,review:null,publication:null};
   recap.sourceDigest=sourceDigest(next,recap,facts);next.recaps.push(recap);
  }else{
   if(!previous||c.recapId!==previous.id||!current(next,previous,source,facts))throw new WeeklyProgressError("CONFLICT");
   const stamp={actorId,at:now,digest:previous.sourceDigest};
   if(c.action==="review_weekly_recap"){
    if(previous.state!=="draft")throw new WeeklyProgressError("CONFLICT");
    next.recaps.push({...previous,version,state:"reviewed",operationId:c.operationId,review:stamp});
   }else{
    if(previous.state!=="reviewed"||!previous.review||previous.review.digest!==previous.sourceDigest)
     throw new WeeklyProgressError("CONFLICT");
    next.recaps.push({...previous,version,state:"published",operationId:c.operationId,publication:stamp});
   }
  }
 }
 // Parsing clones every nested value, including freshly supplied source objects.
 return parse(weeklyStateSchema,next,"UNAVAILABLE");
}

/** Latest explicit publication per occurrence, for this enrollment only.
 * This projection does not authorize a caller or certify live source freshness.
 * Root must recheck current family rights and weeklyPublicationCurrent on reads. */
export function weeklyPublications(state:WeeklyState,enrollmentId:string):WeeklyPublication[]{
 const parsed=parse(weeklyStateSchema,state,"UNAVAILABLE"),enrollment=parse(uuid,enrollmentId);
 const latest=new Map<string,WeeklyRecap>();
 for(const r of parsed.recaps)if(r.enrollmentId===enrollment&&r.state==="published")latest.set(r.occurrenceId,r);
 return [...latest.values()].map(r=>({
  id:r.id,version:r.version,enrollmentId:r.enrollmentId,learnerId:r.learnerId,occurrenceId:r.occurrenceId,
  moduleId:r.moduleId,moduleVersion:r.moduleVersion,locale:r.locale,groupWork:r.groupWork,nextStep:r.nextStep,
  gearReminder:r.gearReminder,questionInvitation:r.questionInvitation,skills:r.skills.map(s=>({...s})),publishedAt:r.publication!.at,
 }));
}
/** Fail closed on malformed or stale sources, without deleting publication
 * history. A supplied object is only an id/version reference to persisted data. */
export function weeklyPublicationCurrent(
 state:WeeklyState,publicationIdOrRecord:string|Pick<WeeklyPublication,"id"|"version">,facts:WeeklyReadFacts,
):boolean{
 try{
  const parsed=parse(weeklyStateSchema,state,"UNAVAILABLE"),source=readSource(facts);
  const reference=typeof publicationIdOrRecord==="string"?{id:parse(uuid,publicationIdOrRecord)}:
   parse(z.strictObject({id:uuid,version:revision.min(1)}),{id:publicationIdOrRecord?.id,version:publicationIdOrRecord?.version});
  const published=parsed.recaps.find(r=>r.state==="published"&&r.id===reference.id);
  if(!published||"version" in reference&&reference.version!==published.version)return false;
  const latest=parsed.recaps.filter(r=>r.state==="published"&&r.enrollmentId===published.enrollmentId&&r.occurrenceId===published.occurrenceId).at(-1);
  return latest?.id===published.id&&current(parsed,published,source,facts);
 }catch{return false;}
}
