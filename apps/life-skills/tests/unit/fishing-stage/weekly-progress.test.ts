import {createHash} from "node:crypto";
import {describe,expect,it} from "vitest";
import {
 applyWeeklyCommand,weeklyCommandSchema,weeklyCommandSchemas,weeklyStateSchema,weeklyPublications,
 weeklyPublicationCurrent,weeklyLimits,weeklySkillIds,WeeklyProgressError,
 type WeeklyState,type WeeklyCommand,type WeeklyFacts,type WeeklyObservation,
} from "../../../src/features/fishing-stage/weekly-progress.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const digest=(value:unknown)=>createHash("sha256").update(JSON.stringify(value)).digest("hex");
const empty=():WeeklyState=>({observations:[],recaps:[]});
function fixture(){
 let identity=100,operation=10000;
 const facts:WeeklyFacts={actorId:id(1),now:"2026-10-19T18:00:00.000Z",nextId:()=>id(identity++),digest,
  occurrence:{id:id(2),revision:2,moduleId:"angling-foundation",moduleVersion:"v1",
   startsAt:"2026-10-19T15:00:00.000Z",endsAt:"2026-10-19T17:00:00.000Z",state:"completed"},
  enrollment:{id:id(3),learnerId:id(4)},attendance:{state:"present",recordedAt:"2026-10-19T15:05:00.000Z",recordedBy:id(1)}};
 const command=(action:WeeklyCommand["action"],extra:Record<string,unknown>={})=>weeklyCommandSchema.parse({
  action,operationId:id(operation++),expectedRevision:0,occurrenceId:facts.occurrence.id,
  expectedOccurrenceRevision:facts.occurrence.revision,enrollmentId:facts.enrollment.id,...extra});
 return {facts,command};
}
type Fixture=ReturnType<typeof fixture>;
const observations=[
 {skillId:"basic_knots" as const,level:"practicing" as const,evidence:"PRIVATE_OBSERVATION_KNOT: needed a second demonstration."},
 {skillId:"self_governance" as const,level:"demonstrated" as const,evidence:"PRIVATE_OBSERVATION_PAUSE: put the rod down before asking."},
];
function observe(f:Fixture,state=empty()){
 return applyWeeklyCommand(state,f.command("observe_skills",{observations}),f.facts);
}
function draft(f:Fixture,state:WeeklyState,extra:Record<string,unknown>={}){
 const latest=state.recaps.filter(r=>r.enrollmentId===f.facts.enrollment.id&&r.occurrenceId===f.facts.occurrence.id).at(-1);
 return applyWeeklyCommand(state,f.command("draft_weekly_recap",{
  expectedRecapVersion:latest?.version??0,locale:"en",groupWork:"We practiced knots and taking turns with the rod.",
  observationIds:state.observations.filter(o=>o.enrollmentId===f.facts.enrollment.id&&o.occurrenceId===f.facts.occurrence.id).slice(-2).map(o=>o.id),
  nextStep:"Practice the knot with a short length of line.",gearReminder:"Bring your labeled tackle box.",
  questionInvitation:"What would you like to practice next?",...extra}),f.facts);
}
function advance(f:Fixture,state:WeeklyState,action:"review_weekly_recap"|"publish_weekly_recap",extra:Record<string,unknown>={}){
 const r=state.recaps.filter(r=>r.enrollmentId===f.facts.enrollment.id&&r.occurrenceId===f.facts.occurrence.id).at(-1);
 if(!r)throw Error("UNIT_RECAP_REQUIRED");
 return applyWeeklyCommand(state,f.command(action,{recapId:r.id,expectedRecapVersion:r.version,...extra}),f.facts);
}
function flow(f=fixture()){
 const observed=observe(f),drafted=draft(f,observed),reviewed=advance(f,drafted,"review_weekly_recap");
 const published=advance(f,reviewed,"publish_weekly_recap");
 return {f,observed,drafted,reviewed,published,publication:weeklyPublications(published,f.facts.enrollment.id)[0]!};
}
function failure(action:()=>unknown,code:"INVALID_REQUEST"|"CONFLICT"|"UNAVAILABLE"){
 try{action();throw Error("EXPECTED_WEEKLY_FAILURE");}catch(error){
  expect(error).toBeInstanceOf(WeeklyProgressError);expect(error).toMatchObject({code,message:code});
 }
}
function freeze<T>(value:T):T{
 if(value!==null&&typeof value==="object"){Object.freeze(value);for(const child of Object.values(value))freeze(child);}
 return value;
}

describe("weekly observation and deliberate recap flow",()=>{
 it("completes the two-skill draft review publish flow with immutable version history",()=>{
  const {f,observed,drafted,reviewed,published,publication}=flow();
  expect(observed.observations).toHaveLength(2);expect(observed.recaps).toEqual([]);
  expect(weeklyPublications(drafted,f.facts.enrollment.id)).toEqual([]);
  expect(weeklyPublications(reviewed,f.facts.enrollment.id)).toEqual([]);
  expect(published.recaps.map(r=>[r.state,r.version])).toEqual([["draft",1],["reviewed",2],["published",3]]);
  expect(new Set(published.recaps.map(r=>r.id)).size).toBe(1);
  expect(published.recaps[0]).toEqual(drafted.recaps[0]);expect(published.recaps[1]).toEqual(reviewed.recaps[1]);
  expect(published.recaps[0]?.review).toBeNull();expect(published.recaps[1]?.publication).toBeNull();
  expect(published.recaps[2]?.review?.digest).toBe(published.recaps[0]?.sourceDigest);
  expect(published.recaps[2]?.publication?.digest).toBe(published.recaps[0]?.sourceDigest);
  expect(publication.skills).toEqual(observed.observations.map(o=>({skillId:o.skillId,level:o.level,observedAt:o.recordedAt})));
  expect(weeklyPublicationCurrent(published,publication,f.facts)).toBe(true);
  expect(weeklyPublicationCurrent(published,publication.id,f.facts)).toBe(true);
 });
 it("never auto-publishes observations or a draft and refuses publish before review",()=>{
  const f=fixture(),observed=observe(f),drafted=draft(f,observed);
  expect(weeklyPublications(observed,f.facts.enrollment.id)).toEqual([]);
  expect(weeklyPublications(drafted,f.facts.enrollment.id)).toEqual([]);
  failure(()=>advance(f,drafted,"publish_weekly_recap"),"CONFLICT");
 });
 it("keeps Hebrew authored content separate from raw private observations",()=>{
  const f=fixture(),state=advance(f,advance(f,draft(f,observe(f),{locale:"he",groupWork:"תרגלנו קשרים ועבודה משותפת.",
   nextStep:"נמשיך לתרגל קשר פשוט.",gearReminder:"",questionInvitation:"מה תרצו לתרגל?"}),"review_weekly_recap"),"publish_weekly_recap");
  const [publication]=weeklyPublications(state,f.facts.enrollment.id);
  expect(publication).toMatchObject({locale:"he",groupWork:"תרגלנו קשרים ועבודה משותפת.",gearReminder:""});
  expect(JSON.stringify(publication)).not.toMatch(/PRIVATE_OBSERVATION|evidence|recordedBy|authoredBy|review|sourceDigest|observationIds|actorId/);
 });
 it("publishes only the latest explicit version while keeping all prior versions",()=>{
  const {f,published,publication}=flow();
  const drafted=draft(f,published,{groupWork:"OWNER_AUTHORED_REVISION"});
  expect(weeklyPublications(drafted,f.facts.enrollment.id)).toEqual([publication]);
  const next=advance(f,advance(f,drafted,"review_weekly_recap"),"publish_weekly_recap");
  expect(next.recaps.map(r=>r.version)).toEqual([1,2,3,4,5,6]);
  expect(next.recaps.slice(0,3)).toEqual(published.recaps);
  const [replacement]=weeklyPublications(next,f.facts.enrollment.id);
  expect(replacement).toMatchObject({version:6,groupWork:"OWNER_AUTHORED_REVISION"});
  expect(replacement?.id).not.toBe(publication.id);
  expect(weeklyPublicationCurrent(next,publication,f.facts)).toBe(false);
 });
 it("returns detached snapshots and projections without mutating frozen inputs",()=>{
  const f=fixture(),before=freeze(observe(f)),beforeJson=JSON.stringify(before);
  const ids=before.observations.map(o=>o.id),command=freeze(f.command("draft_weekly_recap",{
   expectedRecapVersion:0,locale:"en",groupWork:"Public text.",observationIds:ids,nextStep:"Practice.",gearReminder:"",questionInvitation:""}));
  const next=applyWeeklyCommand(before,command,freeze(f.facts));
  expect(JSON.stringify(before)).toBe(beforeJson);expect(next.observations[0]).not.toBe(before.observations[0]);
  expect(next.recaps[0]?.source.occurrence).not.toBe(f.facts.occurrence);
  const complete=advance(f,advance(f,next,"review_weekly_recap"),"publish_weekly_recap"),snapshot=JSON.stringify(complete);
  const projection=weeklyPublications(complete,f.facts.enrollment.id);projection[0]!.groupWork="Mutated consumer copy";
  projection[0]!.skills[0]!.level="introduced";
  expect(JSON.stringify(complete)).toBe(snapshot);
 });
 it("rejects duplicate operation invocation and leaves successful replay to Root",()=>{
  const f=fixture(),command=f.command("observe_skills",{observations}),first=applyWeeklyCommand(empty(),command,f.facts),saved=JSON.stringify(first);
  failure(()=>applyWeeklyCommand(first,command,f.facts),"CONFLICT");expect(JSON.stringify(first)).toBe(saved);
  const drafted=draft(f,first),r=drafted.recaps[0]!;
  const review=f.command("review_weekly_recap",{recapId:r.id,expectedRecapVersion:r.version});
  const reviewed=applyWeeklyCommand(drafted,review,f.facts);
  failure(()=>applyWeeklyCommand(reviewed,review,f.facts),"CONFLICT");
 });
 it("keeps enclosing stage revision CAS outside this pure weekly state",()=>{
  const f=fixture(),command=f.command("observe_skills",{observations,expectedRevision:42});
  expect(applyWeeklyCommand(empty(),command,f.facts).observations).toHaveLength(2);
  expect(Object.keys(weeklyStateSchema.parse(empty()))).toEqual(["observations","recaps"]);
  expect(weeklyStateSchema.safeParse(undefined).success).toBe(false);
 });
});

describe("weekly recap stale-source and CAS checks",()=>{
 it.each(["draft_weekly_recap","review_weekly_recap","publish_weekly_recap"] as const)("rejects stale recap CAS for %s",action=>{
  const f=fixture(),drafted=draft(f,observe(f)),reviewed=advance(f,drafted,"review_weekly_recap");
  if(action==="draft_weekly_recap")failure(()=>draft(f,reviewed,{expectedRecapVersion:0}),"CONFLICT");
  else failure(()=>advance(f,action==="review_weekly_recap"?drafted:reviewed,action,{expectedRecapVersion:99}),"CONFLICT");
 });
 it("rejects a different recap id and a superseded reviewed draft",()=>{
  const f=fixture(),reviewed=advance(f,draft(f,observe(f)),"review_weekly_recap"),old=reviewed.recaps.at(-1)!;
  failure(()=>advance(f,reviewed,"publish_weekly_recap",{recapId:id(999)}),"CONFLICT");
  const redrafted=draft(f,reviewed);
  failure(()=>applyWeeklyCommand(redrafted,f.command("publish_weekly_recap",{recapId:old.id,expectedRecapVersion:redrafted.recaps.at(-1)!.version}),f.facts),"CONFLICT");
 });
 it.each(["occurrence_revision","module_version","attendance_time","attendance_actor","attendance_state"] as const)(
  "withholds stale publication and refuses approval after %s changes",change=>{
   const {f,reviewed,published,publication}=flow();
   if(change==="occurrence_revision")f.facts.occurrence.revision++;
   if(change==="module_version")f.facts.occurrence.moduleVersion="v2";
   if(change==="attendance_time")f.facts.attendance.recordedAt="2026-10-19T15:06:00.000Z";
   if(change==="attendance_actor")f.facts.attendance.recordedBy=id(9);
   if(change==="attendance_state")f.facts.attendance.state="late";
   failure(()=>advance(f,reviewed,"publish_weekly_recap"),"CONFLICT");
   expect(weeklyPublicationCurrent(published,publication,f.facts)).toBe(false);
   expect(weeklyPublications(published,f.facts.enrollment.id)).toEqual([publication]);
  });
 it("invalidates review and publication after a later same-child observation without rewriting safe skills",()=>{
  const {f,reviewed,published,publication}=flow(),before=JSON.stringify(publication);
  const correction=()=>f.command("observe_skills",{observations:[{skillId:"basic_knots",level:"demonstrated",evidence:"PRIVATE_CORRECTION"}]});
  const staleReviewed=applyWeeklyCommand(reviewed,correction(),f.facts);
  failure(()=>advance(f,staleReviewed,"publish_weekly_recap"),"CONFLICT");
  const next=applyWeeklyCommand(published,correction(),f.facts);
  expect(weeklyPublicationCurrent(next,publication,f.facts)).toBe(false);
  expect(JSON.stringify(weeklyPublications(next,f.facts.enrollment.id)[0])).toBe(before);
  expect(next.observations.slice(0,2)).toEqual(published.observations);
 });
 it("requires a fresh draft to select the current immutable observation for a corrected skill",()=>{
  const f=fixture(),original=observe(f),corrected=applyWeeklyCommand(original,f.command("observe_skills",{
   observations:[{skillId:"basic_knots",level:"demonstrated",evidence:"New observed attempt."}]}),f.facts);
  failure(()=>draft(f,corrected,{observationIds:original.observations.map(o=>o.id)}),"CONFLICT");
  const currentIds=[corrected.observations[2]!.id,corrected.observations[1]!.id];
  const d=draft(f,corrected,{observationIds:currentIds});
  expect(d.recaps[0]?.skills[0]?.level).toBe("demonstrated");
  failure(()=>draft(f,corrected,{observationIds:[original.observations[0]!.id,corrected.observations[2]!.id]}),"CONFLICT");
 });
 it("detects tampered draft text and selected evidence instead of approving an old digest",()=>{
  const f=fixture(),drafted=draft(f,observe(f)),changed=structuredClone(drafted);
  changed.recaps[0]!.groupWork="Unreviewed replacement text";
  failure(()=>advance(f,changed,"review_weekly_recap"),"CONFLICT");
  const changedEvidence=structuredClone(drafted);changedEvidence.observations[0]!.evidence="Altered private evidence";
  failure(()=>advance(f,changedEvidence,"review_weekly_recap"),"CONFLICT");
 });
 it("rejects edited review proof and forged publication lifecycle history",()=>{
  const {f,reviewed,published}=flow(),badReview=structuredClone(reviewed);
  badReview.recaps[1]!.review!.digest="0".repeat(64);
  expect(weeklyStateSchema.safeParse(badReview).success).toBe(false);
  failure(()=>advance(f,badReview,"publish_weekly_recap"),"UNAVAILABLE");
  const noDraft=structuredClone(published);noDraft.recaps.shift();
  expect(weeklyStateSchema.safeParse(noDraft).success).toBe(false);
  const forged=structuredClone(reviewed);forged.recaps[1]!.state="published";
  expect(weeklyStateSchema.safeParse(forged).success).toBe(false);
 });
});

describe("weekly enrollment isolation and attendance constraints",()=>{
 it("does not return drafts private evidence reviewer details or another enrollment",()=>{
  const {f,published,publication}=flow();
  expect(weeklyPublications(published,id(700))).toEqual([]);
  expect(weeklyPublications(published,f.facts.enrollment.learnerId)).toEqual([]);
  expect(Object.keys(publication).sort()).toEqual(["enrollmentId","gearReminder","groupWork","id","learnerId","locale","moduleId","moduleVersion",
   "nextStep","occurrenceId","publishedAt","questionInvitation","skills","version"]);
  expect(Object.keys(publication.skills[0]!).sort()).toEqual(["level","observedAt","skillId"]);
  expect(JSON.stringify(publication)).not.toMatch(/PRIVATE_|sourceDigest|observationIds|review|recordedBy|authoredBy/);
 });
 it("rejects other-child and other-event observation references without roster fallback",()=>{
  const f=fixture(),original=observe(f);
  f.facts.enrollment={id:id(30),learnerId:id(40)};
  const second=observe(f,original);
  failure(()=>draft(f,second,{observationIds:original.observations.map(o=>o.id)}),"CONFLICT");
  f.facts.occurrence={...f.facts.occurrence,id:id(20)};
  failure(()=>draft(f,second,{observationIds:second.observations.slice(-2).map(o=>o.id)}),"CONFLICT");
 });
 it("does not invalidate a publication for an unrelated child's later observation",()=>{
  const {f,published,publication}=flow(),originalSource=structuredClone({occurrence:f.facts.occurrence,enrollment:f.facts.enrollment,attendance:f.facts.attendance});
  f.facts.enrollment={id:id(30),learnerId:id(40)};
  const next=observe(f,published);
  expect(weeklyPublicationCurrent(next,publication,f.facts)).toBe(false);
  expect(weeklyPublicationCurrent(next,publication,{...originalSource,now:f.facts.now,digest})).toBe(true);
 });
 it.each(["absent","no_show"] as const)("rejects observation and recap actions for %s attendance",state=>{
  const f=fixture(),drafted=draft(f,observe(f));f.facts.attendance.state=state;
  failure(()=>observe(f),"CONFLICT");failure(()=>advance(f,drafted,"review_weekly_recap"),"CONFLICT");
 });
 it("accepts actual late attendance and the exact completed end-time boundary",()=>{
  const f=fixture();f.facts.attendance.state="late";f.facts.now=f.facts.occurrence.endsAt;
  const {published,publication}=flow(f);
  expect(weeklyPublicationCurrent(published,publication,f.facts)).toBe(true);
  expect(published.recaps.at(-1)?.source.attendance.state).toBe("late");
 });
 it.each(["draft","published","cancelled"] as const)("rejects an occurrence still marked %s",state=>{
  const f=fixture();f.facts.occurrence.state=state;failure(()=>observe(f),"CONFLICT");
 });
 it("requires ended scheduled time and nonfuture attendance without marking delivery",()=>{
  const f=fixture();f.facts.now="2026-10-19T16:59:00.000Z";failure(()=>observe(f),"CONFLICT");
  f.facts.now="2026-10-19T18:00:00.000Z";f.facts.attendance.recordedAt="2026-10-19T18:01:00.000Z";
  failure(()=>observe(f),"CONFLICT");f.facts.attendance.recordedAt="2026-10-19T15:05:00.000Z";
  f.facts.occurrence.endsAt=f.facts.occurrence.startsAt;failure(()=>observe(f),"CONFLICT");
 });
 it("rejects occurrence and enrollment ids and occurrence revisions that disagree with native facts",()=>{
  const f=fixture();
  for(const extra of[{occurrenceId:id(99)},{enrollmentId:id(99)},{expectedOccurrenceRevision:1}])
   failure(()=>applyWeeklyCommand(empty(),f.command("observe_skills",{observations,...extra}),f.facts),"CONFLICT");
 });
 it("rejects backdated approvals and future source reads",()=>{
  const {f,drafted,published,publication}=flow();
  f.facts.now="2026-10-19T17:59:00.000Z";
  failure(()=>advance(f,drafted,"review_weekly_recap"),"CONFLICT");
  expect(weeklyPublicationCurrent(published,publication,f.facts)).toBe(false);
 });
});

describe("weekly strict data and bounded growth",()=>{
 it("exports four strict composable command schemas and exactly fourteen angling skills",()=>{
  expect(weeklyCommandSchemas).toHaveLength(4);expect(weeklySkillIds).toHaveLength(14);
  expect(new Set(weeklySkillIds).size).toBe(14);expect(weeklySkillIds).toContain("self_governance");
  const f=fixture(),command=f.command("observe_skills",{observations});
  for(const extra of[{guardianVerified:true},{sourceDigest:"a".repeat(64)},{sendEmail:true},{mentalHealthGrade:5}])
   expect(weeklyCommandSchema.safeParse({...command,...extra}).success).toBe(false);
  for(const skillId of["mental_health","clinical_score","confidence_grade"])
   expect(weeklyCommandSchema.safeParse({...command,observations:[{...observations[0],skillId}]}).success).toBe(false);
 });
 it("rejects duplicate skill entries duplicate selections and unknown observation ids",()=>{
  const f=fixture();
  expect(weeklyCommandSchema.safeParse({...f.command("observe_skills",{observations}),observations:[observations[0],observations[0]]}).success).toBe(false);
  const observed=observe(f),o=observed.observations[0]!;
  expect(()=>draft(f,observed,{observationIds:[o.id,o.id]})).toThrow();
  failure(()=>draft(f,observed,{observationIds:[id(999)]}),"CONFLICT");
 });
 it("enforces evidence and recap text caps and rejects hidden controls or missing explicit fields",()=>{
  const f=fixture(),observation=f.command("observe_skills",{observations});
  for(const evidence of[""," ","x".repeat(601),"unsafe\u0000text"]){
   expect(weeklyCommandSchema.safeParse({...observation,observations:[{...observations[0],evidence}]}).success).toBe(false);
  }
  const observed=observe(f),base=f.command("draft_weekly_recap",{expectedRecapVersion:0,locale:"en",
   groupWork:"x".repeat(600),observationIds:observed.observations.map(o=>o.id),nextStep:"x".repeat(400),
   gearReminder:"x".repeat(300),questionInvitation:"x".repeat(200)});
  expect(weeklyCommandSchema.safeParse(base).success).toBe(true);
  for(const [key,limit] of[["groupWork",600],["nextStep",400],["gearReminder",300],["questionInvitation",200]] as const){
   expect(weeklyCommandSchema.safeParse({...base,[key]:"x".repeat(limit+1)}).success).toBe(false);
   const missing={...base} as Record<string,unknown>;delete missing[key];expect(weeklyCommandSchema.safeParse(missing).success).toBe(false);
  }
 });
 it.each(["2026-02-30T15:00:00Z","2026-10-19T15:00:00","not-a-date","2026-10-19T15:00:00+99:99"])(
  "rejects malformed date %s",value=>{
   const f=fixture();f.facts.occurrence.startsAt=value;failure(()=>observe(f),"INVALID_REQUEST");
  });
 it("refuses invalid and colliding generated ids without partially mutating input",()=>{
  const f=fixture(),state=empty();f.facts.nextId=()=>"not-a-uuid";
  failure(()=>observe(f,state),"UNAVAILABLE");expect(state).toEqual(empty());
  f.facts.nextId=()=>id(50);failure(()=>observe(f,state),"CONFLICT");expect(state).toEqual(empty());
  const good=fixture(),observed=observe(good);good.facts.nextId=()=>observed.observations[0]!.id;
  failure(()=>draft(good,observed),"CONFLICT");expect(observed.recaps).toEqual([]);
 });
 it("requires a working injected digest and never falls back to a browser or weak hash",()=>{
  const f=fixture(),observed=observe(f);
  for(const hashValue of["","weak","A".repeat(64),"g".repeat(64)]){
   f.facts.digest=()=>hashValue;failure(()=>draft(f,observed),"UNAVAILABLE");
  }
  f.facts.digest=()=>{throw Error("PRIVATE_DIGEST_FAILURE");};failure(()=>draft(f,observed),"UNAVAILABLE");
  const {f:valid,published,publication}=flow();
  expect(weeklyPublicationCurrent(published,publication,{...valid.facts,digest:()=>"weak"})).toBe(false);
 });
 it("fails closed on missing current facts unknown publication ids and wrong publication versions",()=>{
  const {f,published,publication}=flow();
  expect(weeklyPublicationCurrent(published,id(999),f.facts)).toBe(false);
  expect(weeklyPublicationCurrent(published,{...publication,version:publication.version+1},f.facts)).toBe(false);
  expect(weeklyPublicationCurrent(published,publication,{...f.facts,attendance:undefined} as unknown as WeeklyFacts)).toBe(false);
  expect(weeklyPublicationCurrent(published,publication,{...f.facts,enrollment:{id:f.facts.enrollment.id,learnerId:id(99)}})).toBe(false);
 });
 it("rejects duplicate persisted ids reused operations and changed enrollment-to-child bindings",()=>{
  const f=fixture(),observed=observe(f),first=observed.observations[0]!;
  expect(weeklyStateSchema.safeParse({...observed,observations:[...observed.observations,first]}).success).toBe(false);
  const foreign={...first,id:id(88),learnerId:id(99),operationId:id(888)};
  expect(weeklyStateSchema.safeParse({...observed,observations:[...observed.observations,foreign]}).success).toBe(false);
  const reused={...first,id:id(89),recordedBy:id(99)};
  expect(weeklyStateSchema.safeParse({...observed,observations:[...observed.observations,reused]}).success).toBe(false);
 });
 it("bounds observation and recap arrays plus UTF-8 bytes without raising native limits",()=>{
  const f=fixture(),one=observe(f).observations[0]!;
  const makeRows=(count:number,evidence:string):WeeklyObservation[]=>Array.from({length:count},(_,i)=>({
   ...one,id:id(1000+i),operationId:id(10000+i),evidence,
  }));
  expect(weeklyStateSchema.safeParse({observations:makeRows(513,"bounded"),recaps:[]}).success).toBe(false);
  const oversized={observations:makeRows(512,"ש".repeat(600)),recaps:[]};
  expect(new TextEncoder().encode(JSON.stringify(oversized)).byteLength).toBeGreaterThan(weeklyLimits.stateBytes);
  expect(weeklyStateSchema.safeParse(oversized).success).toBe(false);
  const {published}=flow();expect(weeklyStateSchema.safeParse({...published,recaps:Array.from({length:257},()=>published.recaps[0])}).success).toBe(false);
  expect(weeklyLimits.stateBytes).toBe(512*1024);
 });
 it("rejects safe-skill or lifecycle modifications without leaking submitted data in errors",()=>{
  const {f,reviewed,published,publication}=flow(),changed=structuredClone(reviewed);
  changed.recaps[1]!.skills[0]!.level="introduced";
  expect(weeklyStateSchema.safeParse(changed).success).toBe(false);
  failure(()=>advance(f,changed,"publish_weekly_recap"),"UNAVAILABLE");
  const leaked=structuredClone(published) as unknown as {recaps:Record<string,unknown>[]};
  leaked.recaps[2]!.privateEvidence="PRIVATE_CANARY";
  expect(weeklyPublicationCurrent(leaked as unknown as WeeklyState,publication,f.facts)).toBe(false);
 });
});
