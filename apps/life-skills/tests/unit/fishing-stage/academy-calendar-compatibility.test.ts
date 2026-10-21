/**
 * CAL-COMPAT1192: source authored against frozen 69a1561f / tree 23f61f55.
 * Execution requires separate Root admission. These are unit cases, not native
 * SQL, provider, booking, browser or ordinary-human acceptance.
 *
 * Only server-only is mocked. The classifiers, schemas, credit store, sealing,
 * freshActor and workspace-lock functions are actual production imports.
 * SQL results and the required authority are controlled synthetic unit inputs.
 * The SQL double models rows and rollback, not PostgreSQL locking/constraints,
 * concurrent transactions, database time or the missing real authority issuer.
 */
import {createHash} from "node:crypto";
import {describe,expect,expectTypeOf,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {seal,type Keyring} from "../../../src/features/identity/crypto.ts";
import type {Actor} from "../../../src/features/identity/types.ts";
import type {IdentityStore,SqlSession} from "../../../src/features/identity/store.ts";
import {
 academyPolicyPreflightVersion,academyFoundationPreparationPolicyVersion,
 type AcademyOriginalSessionAnchor,type AcademyRecordedDriveLimit,type AcademyRecordedDriveLimitWithMaximum,
 type AcademySessionKind,type AcademySessionDurationInput,type AcademyTravelChangeInput,
 type AcademyTravelChangeWithRecordedMaximumInput,type AcademyTravelChangeResult,
} from "../../../src/features/fishing/academy-policy-preflight-contract.ts";
import {
 academyCalendarCompatibilityVersion,academySessionPolicyNativeVersion,
 type AcademySessionCreditNativeFacts,type AcademySessionCreditNativeFactsV2,
 type AcademySessionCreditResolvedFacts,type AcademySessionCreditRecord,type AcademySessionCreditCommand,
 type AcademySessionCreditCommandResult,type AcademySessionPolicyNativeAuthority,
 type AcademySessionPolicyNativeAuthorityV2,type AcademySessionPolicyNativeDependencies,
 type AcademySessionPolicyNativeDependenciesV2,
} from "../../../src/features/fishing/academy-session-policy-native-contract.ts";
import {
 assessAcademySessionDuration,assessAcademyFoundationPreparationDuration,
 assessAcademyTravelChange,assessAcademyTravelChangeWithRecordedMaximum,
} from "../../../src/features/fishing-stage/academy-session-policy-preflight.ts";
import {
 academyCreditFactsSchema,academyCreditFactsV2Schema,academyCreditResolvedFactsSchema,
 academyEvidenceFacts,academyCreditDigest,
} from "../../../src/features/fishing-stage/academy-session-credit-store.ts";
import {AcademySessionPolicyNativeService} from "../../../src/features/fishing-stage/academy-session-policy-native.ts";

const id=(n:number)=>"00000000-0000-4000-8000-"+String(n).padStart(12,"0");
const now=new Date("2026-10-19T09:00:00.000Z");
// This key is deliberately public synthetic test material, never a credential.
const ring:Keyring={activeKeyId:"unit",keys:{unit:Buffer.alloc(32,7)}};
const actor={
 id:id(2),workspaceId:id(1),personId:id(3),role:"parent",state:"active",locale:"en",
 sessionDigest:"a".repeat(64),expiresAt:Date.parse("2026-10-20T09:00:00.000Z"),
} as Actor;
const independentDigest=(bytes:string)=>createHash("sha256").update(bytes).digest("hex");

// Literal pre-compatibility serialization, independent of the current schema,
// evidence helper and classifier. Repeated anchors reuse literal bytes only.
const legacyAnchorJson='{"workspaceId":"00000000-0000-4000-8000-000000000001","learnerId":"00000000-0000-4000-8000-000000000004","cohortId":"00000000-0000-4000-8000-000000000005","stageId":"00000000-0000-4000-8000-000000000006","occurrenceId":"00000000-0000-4000-8000-000000000007","ordinal":3,"moduleId":"foundation","moduleVersion":"synthetic-v1","activityId":"synthetic-activity"}';
const legacyJson='{"anchor":'+legacyAnchorJson+
 ',"enrollmentId":"00000000-0000-4000-8000-000000000008","purchaseId":"00000000-0000-4000-8000-000000000009","purchaseLineId":"synthetic-line","householdId":"00000000-0000-4000-8000-000000000010","guardianBindingId":"synthetic-guardian","acceptedTermsVersion":"synthetic-terms",'+
 '"inquiry":{"workspaceId":"00000000-0000-4000-8000-000000000001","applicationId":"00000000-0000-4000-8000-000000000011","fieldsDigest":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb","learnerIndex":0,"drivePreferenceDigest":"cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"},'+
 '"stageRevision":1,"sourceEvidenceId":"synthetic-change-1","evidenceRevision":1,"evidenceDigest":"dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",'+
 '"duration":{"version":"JLFA-POLICY-PREFLIGHT-20261018-03-v1","sessionKind":"ordinary","time":{"kind":"scheduled","startsAt":"2026-10-25T13:00:00.000Z","endsAt":"2026-10-25T16:00:00.000Z","timeZone":"America/New_York"}},'+
 '"travel":{"version":"JLFA-POLICY-PREFLIGHT-20261018-03-v1","original":'+legacyAnchorJson+
 ',"sessionKind":"ordinary","obligation":{"anchor":'+legacyAnchorJson+',"evidenceId":"synthetic-purchase-proof","state":"purchased_undelivered"},'+
 '"change":{"anchor":'+legacyAnchorJson+',"kind":"academy_venue","evidenceId":"synthetic-change-1","weatherQualification":"unknown","recordedDriveLimit":"up_to_30","revisedOneWayMinutes":45,"familyCannotAttend":true}},"legacyCredit":null}';
function legacyFacts():AcademySessionCreditNativeFacts{return JSON.parse(legacyJson) as AcademySessionCreditNativeFacts;}
function scheduled(minutes:number,timeZone="America/New_York"):Extract<AcademySessionDurationInput["time"],{kind:"scheduled"}>{
 return {kind:"scheduled",startsAt:"2026-10-25T13:00:00.000Z",
  endsAt:new Date(Date.parse("2026-10-25T13:00:00.000Z")+minutes*60000).toISOString(),timeZone};
}
type V2Options={stage?:1|2|3|4;ordinal?:number;minutes?:number;drive?:AcademyRecordedDriveLimitWithMaximum;kind?:AcademySessionKind};
function v2Facts(options:V2Options={}):AcademySessionCreditNativeFactsV2{
 const base=legacyFacts(),anchor={...base.anchor,ordinal:options.ordinal??3},kind=options.kind??"ordinary",drive=options.drive??35;
 return {...base,anchor,duration:{version:academyPolicyPreflightVersion,sessionKind:kind,time:scheduled(options.minutes??180)},
  travel:{...base.travel,original:anchor,sessionKind:kind,
   obligation:{anchor,evidenceId:"synthetic-purchase-proof",state:"purchased_undelivered"},
   change:{...base.travel.change,anchor,recordedDriveLimit:drive,revisedOneWayMinutes:typeof drive==="number"?drive+10:75}},
  compatibility:{version:academyCalendarCompatibilityVersion,originalStage:options.stage??1}};
}
function travel(facts:AcademySessionCreditResolvedFacts):AcademyTravelChangeWithRecordedMaximumInput{
 return {...facts.travel,existingCredit:null};
}
function commandFor(facts:AcademySessionCreditResolvedFacts,operationId=id(15)):AcademySessionCreditCommand{
 return {operationId,enrollmentId:facts.enrollmentId,originalOccurrenceId:facts.anchor.occurrenceId,
  expectedStageRevision:facts.stageRevision,sourceEvidenceId:facts.sourceEvidenceId,expectedEvidenceRevision:facts.evidenceRevision};
}
function creditFor(facts:AcademySessionCreditResolvedFacts,state:"outstanding"|"replacement_reserved"="outstanding"):AcademySessionCreditRecord{
 return {id:id(12),anchor:facts.anchor,enrollmentId:facts.enrollmentId,purchaseId:facts.purchaseId,
  purchaseLineId:facts.purchaseLineId,state,replacementReservationId:state==="replacement_reserved"?id(13):null};
}
const nativeKeys=["credit","mayBook","mayMarkDelivered","outcome","reason","replayed","specificDateOrSeatGuaranteed","version"];
function expectNative(result:AcademySessionCreditCommandResult,outcome:AcademySessionCreditCommandResult["outcome"],reason:AcademySessionCreditCommandResult["reason"]){
 expect(result).toMatchObject({version:academySessionPolicyNativeVersion,outcome,reason,
  mayBook:false,mayMarkDelivered:false,specificDateOrSeatGuaranteed:false});
 expect(Object.keys(result).sort()).toEqual(nativeKeys);
}
function expectTravel(result:AcademyTravelChangeResult,status:AcademyTravelChangeResult["status"],reason:AcademyTravelChangeResult["reason"]){
 expect(result).toEqual({version:academyPolicyPreflightVersion,status,reason,
  mayIssueCredit:false,mayBook:false,mayMarkDelivered:false,specificDateOrSeatGuaranteed:false});
}

type Row=Record<string,unknown>;
type Selected={enrollmentId:string;workspaceId:string;learnerId:string};
type UnitState={
 facts:AcademySessionCreditResolvedFacts|null;selected:Selected|null;sessionActive:boolean;
 sessionReads:number;selectedReads:number;factReads:number;
 revokeOnFinalSession:boolean;denySelectionOnFinal:boolean;changeFactsOnFinal:boolean;
};
function setup(initial:AcademySessionCreditResolvedFacts=v2Facts()){
 const trace:string[]=[],writes:{table:string;values:readonly unknown[]}[]=[];
 const rows={evidence:[] as Row[],credits:[] as Row[],events:[] as Row[]};
 const state:UnitState={facts:initial,selected:{enrollmentId:initial.enrollmentId,workspaceId:initial.anchor.workspaceId,learnerId:initial.anchor.learnerId},
  sessionActive:true,sessionReads:0,selectedReads:0,factReads:0,revokeOnFinalSession:false,denySelectionOnFinal:false,changeFactsOnFinal:false};
 const account={...actor,emailBlind:"synthetic-blind",emailCiphertext:"unused",emailVerifiedAt:new Date("2026-10-18T09:00:00.000Z"),
  passwordHash:"unused",phoneCiphertext:null,phoneVerifiedAt:null};
 let inTransaction=false,locked=false,transactions=0;
 const tx:SqlSession={
  async query<T extends object=Record<string,unknown>>(statement:string,values:readonly unknown[]=[]):Promise<T[]>{
   if(!inTransaction)throw Error("UNIT_QUERY_OUTSIDE_TRANSACTION");
   const sql=statement.replace(/\s+/g," ").trim();
   let result:Row[];
   if(sql==="SELECT id FROM ls_identity.workspaces WHERE id=$1 FOR UPDATE"){
    trace.push("lock");expect(values).toEqual([actor.workspaceId]);locked=true;result=[{id:actor.workspaceId}];
   }else if(sql.includes("FROM ls_identity.sessions s JOIN ls_identity.accounts a")){
    trace.push("session");state.sessionReads++;
    expect(locked).toBe(true);expect(values).toEqual([actor.workspaceId,actor.id,actor.sessionDigest,now]);
    result=state.sessionActive&&!(state.revokeOnFinalSession&&state.sessionReads>1)?[{id:actor.id}]:[];
   }else if(sql.includes("FROM ls_identity.accounts a JOIN ls_identity.account_subjects s")){
    trace.push("account");expect(values).toEqual([actor.workspaceId,actor.id]);result=[account];
   }else if(sql.startsWith("INSERT INTO ls_fishing_stage.academy_session_policy_evidence ")){
    trace.push("insert-evidence");writes.push({table:"evidence",values:[...values]});
    rows.evidence.push(Object.fromEntries(["workspaceId","id","learnerId","occurrenceId","sourceId","revision","digest","ciphertext","recordedAt"].map((key,index)=>[key,values[index]])));result=[];
   }else if(sql.startsWith("INSERT INTO ls_fishing_stage.academy_session_credits ")){
    trace.push("insert-credit");writes.push({table:"credits",values:[...values]});
    rows.credits.push(Object.fromEntries(["workspaceId","id","learnerId","cohortId","stageId","occurrenceId","ordinal","moduleId","moduleVersion","activityId","enrollmentId","purchaseId","purchaseLineId","state","replacementReservationId","firstEvidenceId","recordedAt"].map((key,index)=>[key,values[index]])));result=[];
   }else if(sql.startsWith("INSERT INTO ls_fishing_stage.academy_session_credit_events ")){
    trace.push("insert-event");writes.push({table:"events",values:[...values]});
    rows.events.push(Object.fromEntries(["workspaceId","actorId","operationId","requestDigest","evidenceId","creditId","outcome","ciphertext","recordedAt"].map((key,index)=>[key,values[index]])));result=[];
   }else if(sql.includes("FROM ls_fishing_stage.academy_session_credits ")){
    if(sql.includes("enrollment_id=$2 AND learner_id=$3")){
     trace.push("credit-selected");result=rows.credits.filter(row=>row.workspaceId===values[0]&&row.enrollmentId===values[1]&&row.learnerId===values[2]);
    }else if(sql.includes("learner_id=$2 AND original_occurrence_id=$3")){
     trace.push("credit-original");result=rows.credits.filter(row=>row.workspaceId===values[0]&&row.learnerId===values[1]&&row.occurrenceId===values[2]);
    }else if(sql.includes("AND id=$2")){
     trace.push("credit-id");result=rows.credits.filter(row=>row.workspaceId===values[0]&&row.id===values[1]);
    }else throw Error("UNEXPECTED_UNIT_CREDIT_QUERY");
   }else if(sql.includes("FROM ls_fishing_stage.academy_session_policy_evidence ")){
    if(sql.includes("AND id=$2")){
     trace.push("evidence-id");result=rows.evidence.filter(row=>row.workspaceId===values[0]&&row.id===values[1]);
    }else if(sql.includes("source_evidence_id=$4 AND source_revision=$5")){
     trace.push("evidence-source");result=rows.evidence.filter(row=>row.workspaceId===values[0]&&row.learnerId===values[1]&&row.occurrenceId===values[2]&&row.sourceId===values[3]&&row.revision===values[4]);
    }else throw Error("UNEXPECTED_UNIT_EVIDENCE_QUERY");
   }else if(sql.includes("FROM ls_fishing_stage.academy_session_credit_events ")){
    if(sql.includes("actor_account_id=$2 AND operation_id=$3")){
     trace.push("event-replay");result=rows.events.filter(row=>row.workspaceId===values[0]&&row.actorId===values[1]&&row.operationId===values[2]);
    }else if(sql.includes("credit_id=$2 ORDER BY recorded_at DESC,operation_id DESC LIMIT 1")){
     trace.push("event-latest");result=rows.events.filter(row=>row.workspaceId===values[0]&&row.creditId===values[1])
      .sort((left,right)=>(right.recordedAt as Date).valueOf()-(left.recordedAt as Date).valueOf()||String(right.operationId).localeCompare(String(left.operationId))).slice(0,1);
    }else throw Error("UNEXPECTED_UNIT_EVENT_QUERY");
   }else throw Error("UNEXPECTED_UNIT_SQL");
   return result.map(row=>({...row})) as T[];
  },
 };
 const database:IdentityStore={
  async transaction<T>(work:(session:SqlSession)=>Promise<T>):Promise<T>{
   if(inTransaction)throw Error("UNIT_NESTED_TRANSACTION");
   transactions++;inTransaction=true;locked=false;
   const before={evidence:rows.evidence.map(row=>({...row})),credits:rows.credits.map(row=>({...row})),events:rows.events.map(row=>({...row}))};
   try{return await work(tx);}
   catch(error){
    rows.evidence.splice(0,rows.evidence.length,...before.evidence);
    rows.credits.splice(0,rows.credits.length,...before.credits);
    rows.events.splice(0,rows.events.length,...before.events);throw error;
   }finally{inTransaction=false;locked=false;}
  },
 };
 const authority:AcademySessionPolicyNativeAuthorityV2={
  async resolveSelectedEnrollment(actual,context){
   trace.push("selected");state.selectedReads++;expect(actual).toBe(tx);expect(inTransaction&&locked).toBe(true);
   expect(context.actor).toMatchObject({id:actor.id,workspaceId:actor.workspaceId,personId:actor.personId,role:"parent"});
   expect(context.selection).toEqual({selectedEnrollmentId:initial.enrollmentId});
   return state.denySelectionOnFinal&&state.selectedReads>1?null:state.selected?{...state.selected}:null;
  },
  async resolveCreditFacts(actual,context,command){
   trace.push("facts");state.factReads++;expect(actual).toBe(tx);expect(inTransaction&&locked).toBe(true);
   expect(context.actor.id).toBe(actor.id);expect(command.enrollmentId).toBe(initial.enrollmentId);
   if(state.changeFactsOnFinal&&state.factReads>1&&state.facts&&"compatibility" in state.facts)
    return {...state.facts,compatibility:{version:academyCalendarCompatibilityVersion,originalStage:2}};
   return state.facts===null?null:structuredClone(state.facts);
  },
 };
 const dependencies:AcademySessionPolicyNativeDependenciesV2={database,keyring:ring,principal:actor,
  selection:{selectedEnrollmentId:initial.enrollmentId},authority,clock:{now:()=>new Date(now)}};
 return {state,rows,writes,trace,tx,database,authority,dependencies,command:commandFor(initial),
  service:new AcademySessionPolicyNativeService(dependencies),transactionCount:()=>transactions};
}
type UnitHarness=ReturnType<typeof setup>;
function seedLegacy(d:UnitHarness,state:"outstanding"|"replacement_reserved"="outstanding"){
 // Seed old-format sealed bytes directly, not through the current store writer.
 const facts=legacyFacts(),credit=creditFor(facts,state),command=commandFor(facts),evidenceId=id(14);
 const result:AcademySessionCreditCommandResult={version:academySessionPolicyNativeVersion,
  outcome:state==="outstanding"?"issued":"retained",reason:state==="outstanding"?"academy_change_exceeds_limit":"same_outstanding_credit",
  credit,replayed:false,mayBook:false,mayMarkDelivered:false,specificDateOrSeatGuaranteed:false};
 const requestDigest=independentDigest(JSON.stringify({version:academySessionPolicyNativeVersion,workspaceId:actor.workspaceId,
  actorId:actor.id,selection:{selectedEnrollmentId:facts.enrollmentId},command}));
 const evidenceFactsDigest=independentDigest(legacyJson),recordedAt=new Date(now.valueOf()-60000);
 const evidenceCiphertext=seal('{"facts":'+legacyJson+'}',"ls_fishing_stage/academy_evidence/v1/"+actor.workspaceId+"/"+evidenceId,ring);
 const receiptCiphertext=seal(JSON.stringify({requestDigest,evidenceId,evidenceFactsDigest,result}),
  "ls_fishing_stage/academy_credit_event/v1/"+actor.workspaceId+"/"+actor.id+"/"+command.operationId,ring);
 d.rows.evidence.push({id:evidenceId,workspaceId:actor.workspaceId,learnerId:facts.anchor.learnerId,occurrenceId:facts.anchor.occurrenceId,
  sourceId:facts.sourceEvidenceId,revision:facts.evidenceRevision,digest:facts.evidenceDigest,ciphertext:evidenceCiphertext,recordedAt});
 d.rows.credits.push({...credit.anchor,id:credit.id,enrollmentId:credit.enrollmentId,purchaseId:credit.purchaseId,purchaseLineId:credit.purchaseLineId,
  state:credit.state,replacementReservationId:credit.replacementReservationId,firstEvidenceId:evidenceId,recordedAt});
 d.rows.events.push({workspaceId:actor.workspaceId,actorId:actor.id,operationId:command.operationId,requestDigest,evidenceId,
  creditId:credit.id,outcome:result.outcome,ciphertext:receiptCiphertext,recordedAt});
 return {credit,result,evidenceFactsDigest,evidenceCiphertext,receiptCiphertext};
}
async function checkIssued(facts:AcademySessionCreditNativeFactsV2){
 const d=setup(facts),result=await d.service.execute(d.command);
 expectNative(result,"issued","academy_change_exceeds_limit");
 expect(result.credit).toMatchObject({anchor:facts.anchor,enrollmentId:facts.enrollmentId,purchaseId:facts.purchaseId,
  purchaseLineId:facts.purchaseLineId,state:"outstanding",replacementReservationId:null});
 expect(d.rows.credits).toHaveLength(1);return {d,result};
}
async function checkDurationDenied(facts:AcademySessionCreditResolvedFacts){
 const d=setup(facts),result=await d.service.execute(d.command);
 expectNative(result,"facts_required","invalid_input");expect(result.credit).toBeNull();expect(d.rows.credits).toHaveLength(0);
}
const anchorMutations:readonly (readonly [keyof AcademyOriginalSessionAnchor,string|number])[]=[
 ["workspaceId",id(91)],["learnerId",id(92)],["cohortId",id(93)],["stageId",id(94)],["occurrenceId",id(95)],
 ["ordinal",4],["moduleId","different-module"],["moduleVersion","different-version"],["activityId","different-activity"],
];
function changedAnchor(anchor:AcademyOriginalSessionAnchor,key:keyof AcademyOriginalSessionAnchor,value:string|number):AcademyOriginalSessionAnchor{
 return {...anchor,[key]:value} as AcademyOriginalSessionAnchor;
}

describe("G1 numeric drive compatibility",()=>{
 it("G1.01 preserves every five-minute numeric maximum from 5 through 120",()=>{
  for(let limit=5;limit<=120;limit+=5){
   const facts=v2Facts({drive:limit}),before=JSON.stringify(facts);
   expect(academyCreditFactsV2Schema.parse(facts).travel.change.recordedDriveLimit).toBe(limit);
   expect(academyCreditResolvedFactsSchema.parse(facts).travel.change.recordedDriveLimit).toBe(limit);
   expectTravel(assessAcademyTravelChangeWithRecordedMaximum(travel(facts)),"replacement_review_required","academy_change_exceeds_limit");
   expect(JSON.stringify(facts)).toBe(before);
  }
 });
 it("G1.02 rejects malformed non-step and out-of-range maxima without coercion",()=>{
  const invalid:readonly unknown[]=[undefined,null,true,false,"30"," 30 ","5","120","up_to_120",{},[30],-5,0,4,6,31,119,121,125,30.5,Number.NaN,Infinity,-Infinity];
  for(const limit of invalid){
   const base=v2Facts(),facts={...base,travel:{...base.travel,change:{...base.travel.change,recordedDriveLimit:limit}}};
   expect(academyCreditFactsV2Schema.safeParse(facts).success,String(limit)).toBe(false);
   expect(academyCreditResolvedFactsSchema.safeParse(facts).success,String(limit)).toBe(false);
   expectTravel(assessAcademyTravelChangeWithRecordedMaximum({...facts.travel,existingCredit:null} as unknown as AcademyTravelChangeWithRecordedMaximumInput),"facts_required","invalid_input");
  }
 });
 it("G1.03 keeps numeric input out of the legacy schema and classifier",()=>{
  const facts=v2Facts({drive:35}),withoutCompatibility={...facts} as Record<string,unknown>;delete withoutCompatibility.compatibility;
  expect(academyCreditFactsSchema.safeParse(facts).success).toBe(false);
  expect(academyCreditFactsSchema.safeParse(withoutCompatibility).success).toBe(false);
  expect(academyCreditResolvedFactsSchema.safeParse(withoutCompatibility).success).toBe(false);
  expectTravel(assessAcademyTravelChange(travel(facts) as AcademyTravelChangeInput),"facts_required","invalid_input");
 });
 it("G1.04 requires the exact compatibility version and strict authoritative stage",()=>{
  const invalid:readonly unknown[]=[undefined,null,{}, {version:academyCalendarCompatibilityVersion},
   {version:"other",originalStage:1},{version:academyCalendarCompatibilityVersion,originalStage:0},
   {version:academyCalendarCompatibilityVersion,originalStage:5},{version:academyCalendarCompatibilityVersion,originalStage:"1"},
   {version:academyCalendarCompatibilityVersion,originalStage:1,verified:true}];
  for(const compatibility of invalid){
   const facts={...v2Facts(),compatibility};
   expect(academyCreditFactsV2Schema.safeParse(facts).success).toBe(false);
   expect(academyCreditResolvedFactsSchema.safeParse(facts).success).toBe(false);
  }
  for(const facts of[{...v2Facts(),mayBook:true},{...v2Facts(),travel:{...v2Facts().travel,verified:true}}])
   expect(academyCreditResolvedFactsSchema.safeParse(facts).success).toBe(false);
 });
});

function checkLegacyCap(limit:AcademyRecordedDriveLimit,cap:number){
 for(const [minutes,status,reason] of[
  [cap-1,"no_new_credit","within_recorded_limit"],[cap,"no_new_credit","within_recorded_limit"],
  [cap+0.01,"replacement_review_required","academy_change_exceeds_limit"],
 ] as const){
  const base=legacyFacts(),input:AcademyTravelChangeInput={...base.travel,existingCredit:null,
   change:{...base.travel.change,recordedDriveLimit:limit,revisedOneWayMinutes:minutes}};
  expectTravel(assessAcademyTravelChange(input),status,reason);
  expect(assessAcademyTravelChangeWithRecordedMaximum(input)).toEqual(assessAcademyTravelChange(input));
  expect(academyCreditFactsV2Schema.parse(v2Facts({drive:limit})).travel.change.recordedDriveLimit).toBe(limit);
 }
}
describe("G2 legacy drive limits",()=>{
 it("G2.01 preserves the exact legacy 30-minute cap",()=>checkLegacyCap("up_to_30",30));
 it("G2.02 preserves the exact legacy 45-minute cap",()=>checkLegacyCap("up_to_45",45));
 it("G2.03 preserves the exact legacy 60-minute cap",()=>checkLegacyCap("up_to_60",60));
 it("G2.04 leaves over_60 unknown even above 120 minutes",()=>{
  for(const minutes of[61,120,600]){
   const base=legacyFacts(),input:AcademyTravelChangeInput={...base.travel,existingCredit:null,
    change:{...base.travel.change,recordedDriveLimit:"over_60",revisedOneWayMinutes:minutes}};
   expectTravel(assessAcademyTravelChange(input),"facts_required","drive_limit_requires_facts");
   expect(assessAcademyTravelChangeWithRecordedMaximum(input)).toEqual(assessAcademyTravelChange(input));
   expect(academyCreditFactsV2Schema.parse(v2Facts({drive:"over_60"})).travel.change.recordedDriveLimit).toBe("over_60");
  }
 });
});

describe("G3 independent travel and obligation facts",()=>{
 it("G3.01 distinguishes equality from any excess over the recorded numeric maximum",()=>{
  const base=travel(v2Facts({drive:35}));
  for(const minutes of[34.99,35])
   expectTravel(assessAcademyTravelChangeWithRecordedMaximum({...base,change:{...base.change,revisedOneWayMinutes:minutes}}),"no_new_credit","within_recorded_limit");
  expectTravel(assessAcademyTravelChangeWithRecordedMaximum({...base,change:{...base.change,revisedOneWayMinutes:35.01}}),"replacement_review_required","academy_change_exceeds_limit");
 });
 it("G3.02 requires an independent cannot-attend declaration despite excess travel",async()=>{
  for(const [cannotAttend,outcome,reason,status] of[
   [null,"facts_required","attendance_requires_facts","facts_required"],
   [false,"no_credit","family_can_attend","no_new_credit"],
  ] as const){
   const base=v2Facts(),facts={...base,travel:{...base.travel,change:{...base.travel.change,familyCannotAttend:cannotAttend}}},d=setup(facts);
   expectTravel(assessAcademyTravelChangeWithRecordedMaximum(travel(facts)),status,reason);
   expectNative(await d.service.execute(d.command),outcome,reason);expect(d.rows.credits).toHaveLength(0);
  }
 });
 it("G3.03 requires revised travel and independent source-change evidence",()=>{
  const input=travel(v2Facts());
  expectTravel(assessAcademyTravelChangeWithRecordedMaximum({...input,change:{...input.change,revisedOneWayMinutes:null}}),"facts_required","drive_limit_requires_facts");
  expectTravel(assessAcademyTravelChangeWithRecordedMaximum({...input,change:{...input.change,evidenceId:""}}),"facts_required","change_evidence_missing");
  for(const [kind,reason] of[["parent_absence","existing_absence_policy"],["other","no_qualifying_change"]] as const)
   expectTravel(assessAcademyTravelChangeWithRecordedMaximum({...input,change:{...input.change,kind}}),"no_new_credit",reason);
 });
 it("G3.04 requires a purchased undelivered original obligation",async()=>{
  for(const [obligationState,outcome,reason,status] of[
   [null,"facts_required","obligation_missing","facts_required"],
   ["unknown","facts_required","obligation_unknown","facts_required"],
   ["unpurchased","no_credit","obligation_not_purchased","no_new_credit"],
   ["delivered","no_credit","obligation_delivered","no_new_credit"],
  ] as const){
   const base=v2Facts(),facts={...base,travel:{...base.travel,obligation:obligationState===null?null:
    {anchor:base.anchor,evidenceId:"synthetic-purchase-proof",state:obligationState}}},d=setup(facts);
   expectTravel(assessAcademyTravelChangeWithRecordedMaximum(travel(facts)),status,reason);
   expectNative(await d.service.execute(d.command),outcome,reason);expect(d.rows.credits).toHaveLength(0);
  }
 });
 it("G3.05 supports separately evidenced venue and schedule changes",async()=>{
  for(const kind of["academy_venue","academy_schedule"] as const){
   const base=v2Facts({stage:1,ordinal:1,minutes:120,drive:40});
   await checkIssued({...base,travel:{...base.travel,change:{...base.travel.change,kind}}});
  }
 });
});

describe("G4 original identity and retention",()=>{
 it("G4.01 compares all nine anchors in change and purchased-obligation evidence",async()=>{
  for(const [key,value] of anchorMutations){
   const base=v2Facts(),different=changedAnchor(base.anchor,key,value);
   for(const target of["change","obligation"] as const){
    const facts={...base,travel:{...base.travel,...(target==="change"?
     {change:{...base.travel.change,anchor:different}}:
     {obligation:{anchor:different,evidenceId:"synthetic-purchase-proof",state:"purchased_undelivered" as const}})}};
    expectTravel(assessAcademyTravelChangeWithRecordedMaximum(travel(facts)),"facts_required","original_anchor_mismatch");
    const d=setup(facts);await expect(d.service.execute(d.command)).rejects.toMatchObject({code:"CONFLICT"});expect(d.writes).toHaveLength(0);
   }
  }
 });
 it("G4.02 compares all nine anchors before retaining an existing credit",async()=>{
  for(const [key,value] of anchorMutations){
   const base=v2Facts(),credit={...creditFor(base),anchor:changedAnchor(base.anchor,key,value)};
   expectTravel(assessAcademyTravelChangeWithRecordedMaximum({...travel(base),existingCredit:{anchor:credit.anchor,creditId:credit.id,state:credit.state}}),"facts_required","credit_anchor_mismatch");
   const d=setup({...base,legacyCredit:credit});await expect(d.service.execute(d.command)).rejects.toMatchObject({code:"CONFLICT"});expect(d.writes).toHaveLength(0);
  }
 });
 it("G4.03 retains one outstanding original credit after a later nonqualifying change",async()=>{
  const initial=v2Facts(),{d,result:first}=await checkIssued(initial),firstCiphertext=d.rows.evidence[0]?.ciphertext;
  const later={...initial,sourceEvidenceId:"synthetic-change-2",evidenceRevision:2,evidenceDigest:"e".repeat(64),
   travel:{...initial.travel,change:{...initial.travel.change,evidenceId:"synthetic-change-2",kind:"other" as const,revisedOneWayMinutes:5,familyCannotAttend:false}}};
  d.state.facts=later;const next=await d.service.execute(commandFor(later,id(16)));
  expectNative(next,"retained","same_outstanding_credit");expect(next.credit).toEqual(first.credit);
  expect(d.rows.credits).toHaveLength(1);expect(d.rows.evidence[0]?.ciphertext).toBe(firstCiphertext);
  expect((await d.service.readFamilySummary()).credits).toEqual([first.credit]);
 });
 it("G4.04 retains a reserved legacy replacement without treating it as delivered",async()=>{
  const d=setup(legacyFacts()),seed=seedLegacy(d,"replacement_reserved"),base=v2Facts();
  const later={...base,sourceEvidenceId:"synthetic-change-2",evidenceRevision:2,evidenceDigest:"e".repeat(64),
   travel:{...base.travel,change:{...base.travel.change,evidenceId:"synthetic-change-2",kind:"parent_absence" as const,familyCannotAttend:null}}};
  d.state.facts=later;const result=await d.service.execute(commandFor(later,id(16)));
  expectNative(result,"retained","same_outstanding_credit");expect(result.credit).toEqual(seed.credit);
  expect(result.credit?.replacementReservationId).toBe(id(13));expect(d.rows.credits).toHaveLength(1);
  expect((await d.service.readFamilySummary()).credits).toEqual([seed.credit]);
 });
});

describe("G5 Foundation preparation duration",()=>{
 it("G5.01 accepts authoritative original stage 1 ordinal 1 at exactly 120 minutes",async()=>{
  await checkIssued(v2Facts({stage:1,ordinal:1,minutes:120}));
 });
 it("G5.02 accepts authoritative original stage 1 ordinal 2 at exactly 120 minutes",async()=>{
  await checkIssued(v2Facts({stage:1,ordinal:2,minutes:120}));
 });
 it("G5.03 denies 119 121 and 180 minutes for the first two Foundation originals",async()=>{
  for(const ordinal of[1,2])for(const minutes of[119,121,180])
   await checkDurationDenied(v2Facts({stage:1,ordinal,minutes}));
 });
 it("G5.04 cannot infer an absent original stage from a Foundation module name",async()=>{
  const base=v2Facts({ordinal:1,minutes:120,drive:"up_to_30"}),oldEnvelope={...base} as Record<string,unknown>;
  delete oldEnvelope.compatibility;await checkDurationDenied(academyCreditFactsSchema.parse(oldEnvelope));
  const malformed={...base,compatibility:{version:academyCalendarCompatibilityVersion}} as unknown as AcademySessionCreditNativeFactsV2;
  const d=setup(malformed);await expect(d.service.execute(d.command)).rejects.toMatchObject({code:"UNAVAILABLE"});expect(d.writes).toHaveLength(0);
 });
 it("G5.05 requires dated Florida-zone preparation facts",async()=>{
  const base=v2Facts({ordinal:1,minutes:120});
  await checkDurationDenied({...base,duration:{...base.duration,time:{kind:"undated",timeZone:"America/New_York"}}});
  await checkDurationDenied({...base,duration:{...base.duration,time:scheduled(120,"UTC")}});
 });
});

describe("G6 ordinary duration outside Foundation preparation",()=>{
 it("G6.01 accepts 180 minutes for original stage 1 ordinals 3 through 12",async()=>{
  for(let ordinal=3;ordinal<=12;ordinal++)await checkIssued(v2Facts({stage:1,ordinal,minutes:180}));
 });
 it("G6.02 rejects 120 minutes for original stage 1 ordinals 3 through 12",async()=>{
  for(let ordinal=3;ordinal<=12;ordinal++)await checkDurationDenied(v2Facts({stage:1,ordinal,minutes:120}));
 });
 it("G6.03 accepts 180 minutes in stages 2 through 4 despite a Foundation module label",async()=>{
  for(const stage of[2,3,4] as const)for(const ordinal of[1,2,3,12])
   await checkIssued(v2Facts({stage,ordinal,minutes:180}));
 });
 it("G6.04 rejects 120 minutes in the first two positions of stages 2 through 4",async()=>{
  for(const stage of[2,3,4] as const)for(const ordinal of[1,2])
   await checkDurationDenied(v2Facts({stage,ordinal,minutes:120}));
 });
});

async function checkException(kind:"keys"|"offshore"|"unclassified"){
 for(const [stage,ordinal,minutes] of[[1,1,120],[1,3,180],[2,1,180]] as const){
  const facts=v2Facts({stage,ordinal,minutes,kind}),d=setup(facts);
  expectTravel(assessAcademyTravelChangeWithRecordedMaximum(travel(facts)),"facts_required","separate_exception_terms");
  expect(assessAcademySessionDuration(facts.duration)).toMatchObject({status:"exception_review_required",reason:"separate_exception_terms",mayBook:false});
  expectNative(await d.service.execute(d.command),"facts_required","separate_exception_terms");expect(d.rows.credits).toHaveLength(0);
 }
}
describe("G7 separate exceptions",()=>{
 it("G7.01 keeps Keys outside ordinary and preparation eligibility",async()=>checkException("keys"));
 it("G7.02 keeps offshore outside ordinary and preparation eligibility",async()=>checkException("offshore"));
 it("G7.03 keeps unclassified sessions outside ordinary and preparation eligibility",async()=>checkException("unclassified"));
 it("G7.04 keeps qualifying weather review separate from new credit issuance",async()=>{
  const base=v2Facts({ordinal:1,minutes:120}),facts={...base,travel:{...base.travel,
   change:{...base.travel.change,kind:"academy_weather_cancelled" as const,weatherQualification:"qualifying" as const}}},d=setup(facts);
  expectTravel(assessAcademyTravelChangeWithRecordedMaximum(travel(facts)),"replacement_review_required","qualifying_weather_cancellation");
  expectNative(await d.service.execute(d.command),"facts_required","weather_requires_review");expect(d.rows.credits).toHaveLength(0);
 });
});

describe("G8 legacy sealed continuity",()=>{
 it("G8.01 preserves literal legacy bytes digest types and evidence overload",()=>{
  expectTypeOf<AcademySessionCreditNativeFacts["travel"]["change"]["recordedDriveLimit"]>().toEqualTypeOf<AcademyRecordedDriveLimit>();
  const input=legacyFacts(),parsed=academyCreditFactsSchema.parse(input),resolved=academyCreditResolvedFactsSchema.parse(input);
  const legacyEvidence:AcademySessionCreditNativeFacts=academyEvidenceFacts(parsed);
  expect(JSON.stringify(parsed)).toBe(legacyJson);expect(JSON.stringify(resolved)).toBe(legacyJson);
  expect(JSON.stringify(legacyEvidence)).toBe(legacyJson);
  expect(academyCreditDigest(legacyEvidence)).toBe(independentDigest(legacyJson));
  expect(academyCreditFactsV2Schema.safeParse(input).success).toBe(false);
  expect(legacyEvidence).not.toHaveProperty("compatibility");
  const withReservation={...input,legacyCredit:creditFor(input,"replacement_reserved")};
  expect(JSON.stringify(academyEvidenceFacts(withReservation))).toBe(legacyJson);
  expect(withReservation.legacyCredit?.replacementReservationId).toBe(id(13));
  const v2Evidence:AcademySessionCreditNativeFactsV2=academyEvidenceFacts(v2Facts());
  expect(v2Evidence.compatibility).toEqual({version:academyCalendarCompatibilityVersion,originalStage:1});
 });
 it("G8.02 reads and replays a sealed pre-compatibility grant without rewriting it",async()=>{
  const d=setup(legacyFacts()),seed=seedLegacy(d);
  expect(await d.service.readFamilySummary()).toEqual({version:academySessionPolicyNativeVersion,enrollmentId:id(8),learnerId:id(4),credits:[seed.credit]});
  d.trace.length=0;
  expect(await d.service.execute(d.command)).toEqual({...seed.result,replayed:true});
  expect(d.trace.slice(0,5)).toEqual(["lock","session","account","selected","facts"]);
  expect(d.trace.indexOf("facts")).toBeLessThan(d.trace.indexOf("event-replay"));
  expect(d.trace.slice(-4)).toEqual(["session","account","selected","facts"]);
  expect(d.rows.evidence[0]?.ciphertext).toBe(seed.evidenceCiphertext);
  expect(d.rows.events[0]?.ciphertext).toBe(seed.receiptCiphertext);expect(d.writes).toHaveLength(0);
  expect(seed.evidenceFactsDigest).toBe(independentDigest(legacyJson));
 });
 it("G8.03 retains an existing legacy outstanding credit on a new operation",async()=>{
  const d=setup(legacyFacts()),seed=seedLegacy(d),result=await d.service.execute({...d.command,operationId:id(16)});
  expectNative(result,"retained","same_outstanding_credit");expect(result.credit).toEqual(seed.credit);
  expect(d.rows.credits).toHaveLength(1);expect(d.rows.evidence).toHaveLength(1);
  expect(d.rows.evidence[0]?.ciphertext).toBe(seed.evidenceCiphertext);
 });
 it("G8.04 retains an existing legacy reservation on a new operation",async()=>{
  const d=setup(legacyFacts()),seed=seedLegacy(d,"replacement_reserved"),result=await d.service.execute({...d.command,operationId:id(16)});
  expectNative(result,"retained","same_outstanding_credit");expect(result.credit).toEqual(seed.credit);
  expect(d.rows.credits).toHaveLength(1);expect(result.credit?.state).toBe("replacement_reserved");
  expect((await d.service.readFamilySummary()).credits).toEqual([seed.credit]);
 });
 it("G8.05 keeps the legacy dependency interface but denies fresh legacy issuance",async()=>{
  for(const minutes of[120,180]){
   const base=legacyFacts(),d=setup({...base,duration:{...base.duration,time:scheduled(minutes)}});
   const authority:AcademySessionPolicyNativeAuthority={resolveSelectedEnrollment:d.authority.resolveSelectedEnrollment,
    resolveCreditFacts:async(tx,context,command)=>await d.authority.resolveCreditFacts(tx,context,command) as AcademySessionCreditNativeFacts|null};
   const dependencies:AcademySessionPolicyNativeDependencies={...d.dependencies,authority};
   const result=await new AcademySessionPolicyNativeService(dependencies).execute(d.command);
   expectNative(result,"facts_required","invalid_input");expect(result.credit).toBeNull();expect(d.rows.credits).toHaveLength(0);
  }
 });
 it("G8.06 rejects changed evidence or a V2 reinterpretation of a cached legacy operation",async()=>{
  for(const changed of[
   {...legacyFacts(),travel:{...legacyFacts().travel,change:{...legacyFacts().travel.change,recordedDriveLimit:"up_to_45" as const}}},
   {...legacyFacts(),compatibility:{version:academyCalendarCompatibilityVersion,originalStage:1 as const}},
  ]){
   const d=setup(legacyFacts()),seed=seedLegacy(d);d.state.facts=changed;
   await expect(d.service.execute(d.command)).rejects.toMatchObject({code:"CONFLICT"});
   expect(d.writes).toHaveLength(0);expect(d.rows.events[0]?.ciphertext).toBe(seed.receiptCiphertext);
  }
 });
 it("G8.07 rejects numeric data smuggled into an old sealed envelope",async()=>{
  const d=setup(legacyFacts());seedLegacy(d);const base=legacyFacts();
  const invalid={...base,travel:{...base.travel,change:{...base.travel.change,recordedDriveLimit:35}}};
  const row=d.rows.evidence[0];if(!row)throw Error("MISSING_SYNTHETIC_EVIDENCE");
  row.ciphertext=seal(JSON.stringify({facts:invalid}),"ls_fishing_stage/academy_evidence/v1/"+actor.workspaceId+"/"+id(14),ring);
  await expect(d.service.readFamilySummary()).rejects.toMatchObject({code:"UNAVAILABLE"});expect(d.writes).toHaveLength(0);
 });
});

describe("G9 authority and effect boundaries",()=>{
 it("G9.01 keeps classifier and native effect flags false with fixed output keys",async()=>{
  const input=travel(v2Facts());
  expectTravel(assessAcademyTravelChangeWithRecordedMaximum(input),"replacement_review_required","academy_change_exceeds_limit");
  const foundation=assessAcademyFoundationPreparationDuration({version:academyFoundationPreparationPolicyVersion,
   sessionKind:"foundation_preparation",stage:1,originalOrdinal:1,time:scheduled(120)});
  expect(foundation).toEqual({version:academyFoundationPreparationPolicyVersion,status:"foundation_preparation_duration_matches",
   reason:"foundation_preparation_120_minutes",elapsedMinutes:120,mayBook:false,mayIssueCredit:false,mayMarkDelivered:false});
  const {d,result}=await checkIssued(v2Facts());
  expectNative(result,"issued","academy_change_exceeds_limit");
  expect(d.writes.map(write=>write.table)).toEqual(["evidence","credits","events"]);
  expect(JSON.stringify(result)).not.toContain("mayIssueCredit");
 });
 it("G9.02 rejects browser facts and permission flags before any transaction",async()=>{
  const d=setup();
  for(const extra of[{facts:v2Facts()},{compatibility:{version:academyCalendarCompatibilityVersion,originalStage:1}},
   {originalStage:1},{guardianVerified:true},{mayBook:true},{mayMarkDelivered:true},{specificDateOrSeatGuaranteed:true}]){
   await expect(d.service.execute({...d.command,...extra})).rejects.toMatchObject({code:"INVALID_REQUEST"});
  }
  expect(d.transactionCount()).toBe(0);expect(d.trace).toEqual([]);expect(d.writes).toHaveLength(0);
 });
 it("G9.03 requires both authority methods without a default resolver",()=>{
  const d=setup();
  for(const authority of[undefined,{}, {resolveCreditFacts:d.authority.resolveCreditFacts},{resolveSelectedEnrollment:d.authority.resolveSelectedEnrollment}])
   expect(()=>new AcademySessionPolicyNativeService({...d.dependencies,authority} as unknown as AcademySessionPolicyNativeDependenciesV2)).toThrow("UNAVAILABLE");
  expect(d.trace).toEqual([]);expect(d.transactionCount()).toBe(0);
 });
 it("G9.04 rechecks the actual session before a cached legacy receipt",async()=>{
  const d=setup(legacyFacts());seedLegacy(d);d.state.sessionActive=false;
  await expect(d.service.execute(d.command)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
  expect(d.trace).toEqual(["lock","session"]);expect(d.writes).toHaveLength(0);
 });
 it("G9.05 rechecks selected-child authority before any cached data",async()=>{
  const d=setup(legacyFacts());seedLegacy(d);d.state.selected=null;
  await expect(d.service.execute(d.command)).rejects.toMatchObject({code:"FORBIDDEN"});
  expect(d.trace).toEqual(["lock","session","account","selected"]);expect(d.writes).toHaveLength(0);
 });
 it("G9.06 cannot replace missing native facts with a cached grant",async()=>{
  const d=setup(legacyFacts());seedLegacy(d);d.state.facts=null;
  await expect(d.service.execute(d.command)).rejects.toMatchObject({code:"FORBIDDEN"});
  expect(d.trace).toEqual(["lock","session","account","selected","facts"]);expect(d.writes).toHaveLength(0);
 });
 it("G9.07 rolls back all modeled ledger rows when final session revalidation fails",async()=>{
  const d=setup(v2Facts({ordinal:1,minutes:120}));d.state.revokeOnFinalSession=true;
  await expect(d.service.execute(d.command)).rejects.toMatchObject({code:"UNAUTHENTICATED"});
  expect(d.writes.map(write=>write.table)).toEqual(["evidence","credits","events"]);
  expect(d.rows).toEqual({evidence:[],credits:[],events:[]});
 });
 it("G9.08 rolls back when the authoritative original stage changes before return",async()=>{
  const d=setup(v2Facts({ordinal:1,minutes:120}));d.state.changeFactsOnFinal=true;
  await expect(d.service.execute(d.command)).rejects.toMatchObject({code:"CONFLICT"});
  expect(d.state.factReads).toBe(2);expect(d.rows).toEqual({evidence:[],credits:[],events:[]});
 });
 it("G9.09 uses one locked SqlSession for actual identity and both authority passes",async()=>{
  const {d}=await checkIssued(v2Facts({ordinal:2,minutes:120}));
  expect(d.transactionCount()).toBe(1);expect(d.trace.slice(0,5)).toEqual(["lock","session","account","selected","facts"]);
  expect(d.trace.indexOf("facts")).toBeLessThan(d.trace.indexOf("event-replay"));
  expect(d.trace.slice(-4)).toEqual(["session","account","selected","facts"]);
  expect([d.state.sessionReads,d.state.selectedReads,d.state.factReads]).toEqual([2,2,2]);
 });
 it("G9.10 withholds a family summary if selected-child authority is revoked before return",async()=>{
  const d=setup(legacyFacts());seedLegacy(d);d.state.denySelectionOnFinal=true;
  await expect(d.service.readFamilySummary()).rejects.toMatchObject({code:"FORBIDDEN"});
  expect(d.state.selectedReads).toBe(2);expect(d.writes).toHaveLength(0);
 });
 it("G9.11 rejects a different selected learner rather than using browser or household fallback",async()=>{
  const d=setup(legacyFacts());seedLegacy(d);
  d.state.selected={enrollmentId:id(8),workspaceId:id(1),learnerId:id(99)};
  await expect(d.service.execute(d.command)).rejects.toMatchObject({code:"CONFLICT"});
  expect(d.trace).not.toContain("credit-original");expect(d.writes).toHaveLength(0);
 });
});

describe('G10 Root public selected-child projection (controlled SQL unit evidence only)',()=>{
 it('omits private native credit/source/purchase/reservation identifiers from the serialized response',async()=>{
  const d=setup(legacyFacts()),{credit}=seedLegacy(d),body=await d.service.readPublicFamilySummary();
  expect(body).toEqual({version:'JLFA-SESSION-CREDIT-PARENT-20261021-01',enrollmentId:credit.enrollmentId,learnerId:credit.anchor.learnerId,credits:[{id:credit.id,originalOccurrenceId:credit.anchor.occurrenceId,originalOrdinal:credit.anchor.ordinal,state:credit.state}]});
  const json=JSON.stringify(body);for(const privateId of [credit.purchaseId,credit.purchaseLineId,credit.anchor.workspaceId,credit.anchor.cohortId,credit.anchor.stageId,credit.anchor.moduleId,credit.anchor.moduleVersion,credit.anchor.activityId,credit.replacementReservationId].filter((v):v is string=>v!==null))expect(json).not.toContain(privateId);
  expect(d.writes).toHaveLength(0);expect(d.state.sessionReads).toBe(2);expect(d.state.selectedReads).toBe(2);
 });
 it('returns the same original-session reference and undelivered reserved state after reconstruction, without exposing its reservation',async()=>{
  const d=setup(legacyFacts()),{credit:reserved}=seedLegacy(d,'replacement_reserved');const before=structuredClone(d.rows),body=await d.service.readPublicFamilySummary();expect(body.credits).toEqual([{id:reserved.id,originalOccurrenceId:reserved.anchor.occurrenceId,originalOrdinal:reserved.anchor.ordinal,state:'replacement_reserved'}]);expect(JSON.stringify(body)).not.toContain(reserved.replacementReservationId!);expect(d.rows).toEqual(before);expect(d.writes).toHaveLength(0);
 });
 it('denies public read when the actual selected-child authority is revoked during final revalidation',async()=>{
  const d=setup(legacyFacts());seedLegacy(d);d.state.denySelectionOnFinal=true;await expect(d.service.readPublicFamilySummary()).rejects.toMatchObject({code:'FORBIDDEN'});expect(d.state.selectedReads).toBe(2);expect(d.writes).toHaveLength(0);
 });
 it('does not use a cached private record after current session revocation',async()=>{
  const d=setup(legacyFacts());seedLegacy(d);d.state.sessionActive=false;await expect(d.service.readPublicFamilySummary()).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(d.trace).toEqual(['lock','session']);expect(d.writes).toHaveLength(0);
 });
});
