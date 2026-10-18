import http from "node:http";
import https from "node:https";
import net from "node:net";
import tls from "node:tls";
import dgram from "node:dgram";
import {afterAll,afterEach,beforeAll,expect,test,vi} from "vitest";
import {asId} from "../../../src/lib/ids.ts";
import {approvedOffer,POLICY_VERSION} from "../../../src/features/fishing-payments/domain.ts";
import {academyPolicyPreflightVersion,academyCompletedIntakeVersion,type AcademyPaymentPreflightInput,type AcademyPaymentPreflightReason} from "../../../src/features/fishing/academy-policy-preflight-contract.ts";
import {assessInquiryPaymentPreflight} from "../../../src/features/fishing-payments/intake-payment-preflight.ts";

const NOW="2026-10-18T12:00:00.000Z",EXPIRES="2026-10-19T12:00:00.000Z",CAPACITY="2026-10-20T12:00:00.000Z";
const CANARY="PRIVATE_SYNTHETIC_INTAKE1115_contact@example.invalid";
const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
type Mutable<T>=T extends string|number|boolean|null|undefined?T:T extends readonly(infer U)[]?Mutable<U>[]:{-readonly[K in keyof T]:Mutable<T[K]>};
type Input=Mutable<AcademyPaymentPreflightInput>;
const noNetwork=vi.fn(()=>{throw new Error("UNEXPECTED_NETWORK_ATTEMPT");});
beforeAll(()=>{
 vi.stubGlobal("fetch",noNetwork);vi.stubGlobal("WebSocket",noNetwork);
 vi.spyOn(http,"request").mockImplementation(noNetwork);vi.spyOn(http,"get").mockImplementation(noNetwork);
 vi.spyOn(https,"request").mockImplementation(noNetwork);vi.spyOn(https,"get").mockImplementation(noNetwork);
 vi.spyOn(net,"connect").mockImplementation(noNetwork);vi.spyOn(net,"createConnection").mockImplementation(noNetwork);
 vi.spyOn(net.Socket.prototype,"connect").mockImplementation(noNetwork);
 vi.spyOn(tls,"connect").mockImplementation(noNetwork);vi.spyOn(dgram,"createSocket").mockImplementation(noNetwork);
});
afterEach(()=>{expect(noNetwork).not.toHaveBeenCalled();});
afterAll(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});

function fixture(count=2):Input{
 const payer=asId(uuid(2),"account");
 const offer=approvedOffer({id:uuid(3),revision:1,workspaceId:asId(uuid(1),"workspace"),program:"sunday_fishing_academy",operatorAccountId:asId(uuid(4),"account"),householdId:uuid(5),payerAccountId:payer,currency:"USD",policyVersion:POLICY_VERSION,sourceVersion:"synthetic-source03",expiresAt:EXPIRES,terms:{version:"synthetic-terms-v1",acceptedBy:payer,acceptedAt:"2026-10-17T12:00:00.000Z"},lines:Array.from({length:count},(_,i)=>({id:uuid(100+i),learnerId:asId(uuid(200+i),"person"),cohortId:uuid(10),stageId:uuid(11),stage:1,sessions:12,mode:"prepay",totalCents:175000,discountBasis:"ordinary_primary_prepay",eligibility:{kind:"ordinary",evidenceId:`discount-evidence-${i}`,policyVersion:POLICY_VERSION},dues:[{id:uuid(300+i),index:1,dueAt:NOW,currency:"USD",amountCents:175000,state:"pending",paidCents:0}],capacity:{reservationId:uuid(400+i),revision:1,expiresAt:CAPACITY}}))});
 const reference={workspaceId:uuid(1),applicationId:uuid(6),fieldsDigest:"a".repeat(64)};
 const mutableOffer={...offer,terms:{...offer.terms},lines:offer.lines.map(line=>({...line,eligibility:{...line.eligibility},capacity:{...line.capacity},dues:line.dues.map(due=>({...due}))}))};
 return {version:academyPolicyPreflightVersion,now:NOW,intake:{...reference,state:"complete",version:academyCompletedIntakeVersion,learnerCount:count},link:{...reference,householdId:offer.householdId,payerAccountId:payer,guardianBindingId:"native-guardian-binding",acceptedTermsVersion:offer.terms.version,approvedOfferId:offer.id,learners:offer.lines.map((line,learnerIndex)=>({learnerIndex,learnerId:line.learnerId,cohortId:line.cohortId,stageId:line.stageId,stage:line.stage,fit:{decisionId:`actual-fit-decision-${learnerIndex}`,state:"suitable"},capacity:{...line.capacity},schedule:{evidenceId:`native-schedule-${learnerIndex}`,state:"suitable"},location:{evidenceId:`native-location-${learnerIndex}`,state:"suitable"}}))},offer:mutableOffer};
}
function check(input:unknown,reason?:AcademyPaymentPreflightReason){
 const out=assessInquiryPaymentPreflight(input as AcademyPaymentPreflightInput);expect(out.version).toBe(academyPolicyPreflightVersion);expect(out.mayCharge).toBe(false);expect(out.mayReserveFounding).toBe(false);expect(Number.isInteger(out.learnerCount)&&out.learnerCount>=0&&out.learnerCount<=10).toBe(true);expect(Number.isInteger(out.mappedLearnerCount)&&out.mappedLearnerCount>=0&&out.mappedLearnerCount<=out.learnerCount).toBe(true);
 expect(JSON.stringify(out)).not.toContain(CANARY);expect(JSON.stringify(out)).not.toContain("00000000-");if(reason){expect(out.status).toBe("incomplete");expect(out.reasons).toContain(reason);}return out;
}
test.each([1,2,10])("complete consistent%d-learner facts are review-only, never charge/reservation authority",count=>{
 const out=check(fixture(count));expect(out).toEqual({version:academyPolicyPreflightVersion,status:"ready_for_native_review",reasons:[],learnerCount:count,mappedLearnerCount:count,mayCharge:false,mayReserveFounding:false});expect(Object.isFrozen(out)).toBe(true);expect(Object.isFrozen(out.reasons)).toBe(true);
});
test("fit evidence is independent of discount eligibility and ordinary later stages are not founder-gated",()=>{
 const input=fixture();for(const [i,line]of input.offer!.lines.entries()){line.stage=2;input.link!.learners[i]!.stage=2;expect(input.link!.learners[i]!.fit.decisionId).not.toBe(line.eligibility.evidenceId);}expect(check(input).status).toBe("ready_for_native_review");
});
test("mapping follows learner identity and complete indices rather than array order",()=>{
 const input=fixture();input.offer!.lines.reverse();input.link!.learners.reverse();expect(check(input).status).toBe("ready_for_native_review");
});
test.each([null,undefined,[],{},false,CANARY])("malformed top-level input never throws (%s)",value=>{check(value,"invalid_input");});
test.each(["old",undefined,null])("preflight version mismatch is fixed invalid_input (%s)",version=>{check({...fixture(),version},"invalid_input");});
test.each(["",CANARY,"2026-10-18T12:00:00","2026-02-30T12:00:00Z",null,Infinity])("now must be a finite valid explicit-offset instant (%s)",now=>{check({...fixture(),now},"invalid_input");});
test.each([null,undefined])("absent intake is incomplete (%s)",intake=>{check({...fixture(),intake},"intake_missing");});
test.each(["ordinary_inquiry","invalid"] as const)("%s intake does not open a payment path",state=>{const input=fixture();input.intake!.state=state;check(input,"intake_incomplete");});
test.each(["",CANARY,false,[]])("malformed intake is a safe incomplete result (%s)",intake=>{check({...fixture(),intake},"invalid_input");});
test("current complete intake version is mandatory",()=>{const input=fixture();input.intake!.version="old-intake";check(input,"intake_version");});
test.each([0,-1,11,1.5,NaN,Infinity,"2",null])("learner count is a bounded integer1..10 (%s)",learnerCount=>{const input=fixture();Object.assign(input.intake!,{learnerCount});expect(check(input,"invalid_input").learnerCount).toBe(0);});
test.each(["workspaceId","applicationId","fieldsDigest"] as const)("invalid or mismatched inquiry %s is rejected",key=>{
 const invalid=fixture();invalid.intake![key]="";check(invalid,"inquiry_binding_mismatch");const wrong=fixture();wrong.link![key]=key==="fieldsDigest"?"b".repeat(64):uuid(999);check(wrong,"inquiry_binding_mismatch");
});
test.each(["not-a-digest","A".repeat(64),"a".repeat(63),CANARY])("untrusted digest shape is not accepted even if both strings match (%s)",fieldsDigest=>{
 const input=fixture();input.intake!.fieldsDigest=fieldsDigest;input.link!.fieldsDigest=fieldsDigest;check(input,"inquiry_binding_mismatch");
});
test("missing link and missing offer remain distinct prerequisites",()=>{check({...fixture(),link:null},"link_missing");check({...fixture(),offer:null},"offer_missing");});
test.each(["householdId","payerAccountId"] as const)("household/payer mismatch %s is concealed",key=>{
 const input=fixture();input.link![key]=uuid(999);check(input,"household_payer_mismatch");const missing=fixture();Object.assign(missing.link!,{[key]:""});check(missing,"household_payer_mismatch");
});
test.each(["",CANARY,"x".repeat(161),null])("missing/invalid guardian binding is not synthesized (%s)",guardianBindingId=>{
 const input=fixture();Object.assign(input.link!,{guardianBindingId});check(input,"guardian_missing");
});
test.each(["offer-id","workspace"])("offer%s must match the saved native link",kind=>{
 const input=fixture();if(kind==="offer-id")input.link!.approvedOfferId=uuid(999);else input.offer!.workspaceId=asId(uuid(999),"workspace");check(input,"offer_binding_mismatch");
});
test.each(["version","acceptedBy","future","malformed","missing"])("terms%s cannot qualify the offer",kind=>{
 const input=fixture();if(kind==="version")input.link!.acceptedTermsVersion="different-terms";if(kind==="acceptedBy")input.offer!.terms.acceptedBy=asId(uuid(999),"account");if(kind==="future")input.offer!.terms.acceptedAt="2026-10-18T12:00:01.000Z";if(kind==="malformed")input.offer!.terms.acceptedAt=CANARY;if(kind==="missing")input.link!.acceptedTermsVersion="";check(input,"terms_mismatch");
});
test.each(["expired","edge"])("offer expiry uses supplied now (%s)",kind=>{
 const input=fixture();input.offer!.expiresAt=kind==="edge"?NOW:"2026-10-18T11:59:59.000Z";check(input,"offer_expired");
});
test.each(["policy","line-shape","line-duplicate","dues","program"])("structurally invalid offer%s is not native authority",kind=>{
 const input=fixture();if(kind==="policy")input.offer!.policyVersion="wrong-policy";if(kind==="line-shape")Object.assign(input.offer!.lines[0]!,{sessions:1});if(kind==="line-duplicate")input.offer!.lines[1]!.id=input.offer!.lines[0]!.id;if(kind==="dues")input.offer!.lines[0]!.dues=[];if(kind==="program")input.offer!.program="private_fishing_life_skills";check(input,"offer_invalid");
});
test.each(["absent","extra","missing-index","duplicate-index","negative-index","fraction-index","out-of-range","duplicate-learner","wrong-learner","wrong-cohort","wrong-stage-id","wrong-stage","offer-extra"])("one-to-one learner mapping%s is enforced",kind=>{
 const input=fixture(),learners=input.link!.learners;
 if(kind==="absent")learners.length=0;if(kind==="extra")learners.push(structuredClone(learners[0]!));if(kind==="missing-index")learners.pop();if(kind==="duplicate-index")learners[1]!.learnerIndex=0;if(kind==="negative-index")learners[0]!.learnerIndex=-1;if(kind==="fraction-index")learners[0]!.learnerIndex=.5;if(kind==="out-of-range")learners[1]!.learnerIndex=2;if(kind==="duplicate-learner")learners[1]!.learnerId=learners[0]!.learnerId;if(kind==="wrong-learner")learners[0]!.learnerId=uuid(999);if(kind==="wrong-cohort")learners[0]!.cohortId=uuid(999);if(kind==="wrong-stage-id")learners[0]!.stageId=uuid(999);if(kind==="wrong-stage")learners[0]!.stage=2;if(kind==="offer-extra")input.offer!.lines.push(structuredClone(input.offer!.lines[0]!));expect(check(input,"learner_mapping_invalid").mappedLearnerCount).toBe(0);
});
test.each(["missing","unsuitable","unknown","id"])("fit%s requires its own suitable decision evidence",kind=>{
 const input=fixture(),fact=input.link!.learners[0]!;if(kind==="missing")Object.assign(fact,{fit:null});if(kind==="unsuitable")fact.fit.state="unsuitable";if(kind==="unknown")fact.fit.state="unknown";if(kind==="id")fact.fit.decisionId="";check(input,"fit_incomplete");
});
test.each(["missing","id","revision","zero-revision","fraction-revision","expired","different-expiry","invalid-expiry"])("capacity%s must match the exact live offer reservation",kind=>{
 const input=fixture(),fact=input.link!.learners[0]!;if(kind==="missing")Object.assign(fact,{capacity:null});if(kind==="id")fact.capacity.reservationId=uuid(999);if(kind==="revision")fact.capacity.revision=2;if(kind==="zero-revision")fact.capacity.revision=0;if(kind==="fraction-revision")fact.capacity.revision=.5;if(kind==="expired")fact.capacity.expiresAt=NOW;if(kind==="different-expiry")fact.capacity.expiresAt="2026-10-21T12:00:00.000Z";if(kind==="invalid-expiry")fact.capacity.expiresAt=CANARY;check(input,"capacity_incomplete");
});
test.each(["schedule","location"] as const)("%s needs suitable current evidence",key=>{
 for(const state of ["unsuitable","unknown"] as const){const input=fixture();input.link!.learners[0]![key].state=state;check(input,key==="schedule"?"schedule_incomplete":"location_incomplete");}
 const missing=fixture();missing.link!.learners[0]![key].evidenceId="";check(missing,key==="schedule"?"schedule_incomplete":"location_incomplete");
});
test("missing proof reasons are unique and ordered; mapped count denotes identity mapping only",()=>{
 const input=fixture();for(const fact of input.link!.learners){fact.fit.state="unknown";fact.capacity.revision=2;fact.schedule.state="unknown";fact.location.state="unknown";}const out=check(input);expect(out.reasons).toEqual(["fit_incomplete","capacity_incomplete","schedule_incomplete","location_incomplete"]);expect(out.status).toBe("incomplete");expect(out.mappedLearnerCount).toBe(2);
});
test("equivalent supplied now offsets use actual instants without a clock read",()=>{
 const input=fixture();input.now="2026-10-18T08:00:00.000-04:00";expect(check(input).status).toBe("ready_for_native_review");
});
test("frozen input remains byte-equivalent and no proof or right is minted",()=>{
 const input=fixture(),before=structuredClone(input);function freeze(value:unknown){if(value&&typeof value==="object"){for(const child of Object.values(value))freeze(child);Object.freeze(value);}}freeze(input);const first=check(input),second=check(input);expect(first).toEqual(second);expect(input).toEqual(before);expect(Object.keys(first).sort()).toEqual(["version","status","reasons","learnerCount","mappedLearnerCount","mayCharge","mayReserveFounding"].sort());
});
test("malformed runtime exceptions and canaries produce fixed safe reasons without throwing or logging",()=>{
 const spies=[vi.spyOn(console,"log"),vi.spyOn(console,"warn"),vi.spyOn(console,"error")];try{const input={version:academyPolicyPreflightVersion,now:NOW,get intake(){throw new Error(CANARY);}};expect(check(input,"invalid_input").reasons).toEqual(["invalid_input"]);for(const spy of spies)expect(spy).not.toHaveBeenCalled();}finally{for(const spy of spies)spy.mockRestore();}
});
