import {afterEach,describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
vi.mock("../../src/features/identity/data.ts",()=>({lockWorkspace:vi.fn(async()=>{})}));
import {lockWorkspace} from "../../src/features/identity/data.ts";
import {AppError} from "../../src/lib/errors.ts";
import type {Actor} from "../../src/features/identity/types.ts";
import type {SqlSession,IdentityStore} from "../../src/features/identity/store.ts";
import type {NativeFishingProgram} from "../../src/features/fishing/native-program.ts";
import type {PublicGroupApplicationStore} from "../../src/features/group-application/store.ts";
import {floridaParentApplicationFieldsSchema,academyApplicationNotice} from "../../src/features/group-application/contract.ts";
import {AcademyInquiryLearnerLinkStore,academyInquiryFieldsDigest} from "../../src/features/fishing/academy-inquiry-learner-link.ts";

const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const actor={workspaceId:id(1),id:id(2),personId:id(3),role:"practitioner",state:"active",locale:"en",sessionDigest:"synthetic-only",expiresAt:9999999999999} as unknown as Actor;
function fields(){return floridaParentApplicationFieldsSchema.parse({parentName:"Synthetic private parent",contact:"synthetic@example.invalid",language:"en",cityArea:"Synthetic area",programId:"sunday_fishing_academy",schedulePreference:["sunday"],scheduleContext:"program_format_interest",permission:{confirmed:true,version:academyApplicationNotice.version,language:"en"},
 academyFit:{version:"RM-FIT-20261014-04-v1",learners:[{approximateAge:12,gear:"not_sure",experience:"new"},{approximateAge:12,gear:"not_sure",experience:"new"}],maximumDriveMinutes:120,parentDropoff:"discuss"},
 academyIntake:{version:"JLFA-ENROLLMENT-20261018-03-v1",postalCode:"33431",driveLimit:120,preferredGroupLanguage:"either",stagePreference:"foundation",keysTravel:"parent_drive",offshoreInterest:"discuss",nextStep:"callback",learners:[{ageYears:12,gradeBand:"grade_6_8",schooling:"school",tackleBox:"not_sure"},{ageYears:12,gradeBand:"grade_6_8",schooling:"school",tackleBox:"not_sure"}]}});}
function setup(){
 const state={fields:fields(),nativeDenied:false,inquiryDenied:false,writeFails:false,writeFault:null as Error|null,denyOnFinalRead:false,sourceDigest:"a".repeat(64),guardianDigest:"b".repeat(64),enrollmentRevision:3,workspaceId:actor.workspaceId};
 const trace:string[]=[],committed:{id:string;commandDigest:string;bindingDigest:string;operationId:string;applicationId:string;index:number;learnerId:string}[]=[],writes:unknown[][]=[];
 let pending:typeof committed=[];
 const query=vi.fn(async(sql:string,values:readonly unknown[]=[])=>{
  if(sql.startsWith("SELECT request_digest")){trace.push("source");return [{requestDigest:state.sourceDigest}];}
  if(sql.includes("command_digest AS")){trace.push("prior");return committed.filter(x=>x.operationId===values[2]).map(({id,commandDigest,bindingDigest})=>({id,commandDigest,bindingDigest}));}
  if(sql.startsWith("SELECT id FROM")){trace.push("duplicate");return committed.filter(x=>x.applicationId===values[1]&&(x.index===values[2]||x.learnerId===values[3])).map(({id})=>({id}));}
  if(sql.startsWith("INSERT INTO")){trace.push("insert");writes.push([...values]);if(state.writeFault)throw state.writeFault;if(state.writeFails)throw new AppError("UNAVAILABLE");pending.push({id:values[1] as string,commandDigest:values[20] as string,bindingDigest:values[17] as string,operationId:values[19] as string,applicationId:values[2] as string,index:values[3] as number,learnerId:values[4] as string});return [{id:values[1]}];}
  throw Error("UNEXPECTED_SQL");
 });
 const tx={query} as unknown as SqlSession;
 const database={transaction:vi.fn(async(work:(tx:SqlSession)=>Promise<unknown>)=>{pending=[];try{const result=await work(tx);committed.push(...pending);return result;}finally{pending=[];}})} as unknown as IdentityStore;
 vi.mocked(lockWorkspace).mockImplementation(async(actual,workspace)=>{expect(actual).toBe(tx);expect(workspace).toBe(actor.workspaceId);trace.push("lock");});
 const readNative=vi.fn(async(actual:SqlSession,principal:Actor,selection:string)=>{
  trace.push("native");expect(actual).toBe(tx);expect(principal).toBe(actor);expect(selection).toBe(id(5));if(state.nativeDenied||(state.denyOnFinalRead&&readNative.mock.calls.length>1))throw new AppError("FORBIDDEN");
  return {operatorAccountId:actor.id,payerAccountId:id(6),offerId:"synthetic-offer",guardianDigest:state.guardianDigest,enrollment:{id:id(5),revision:state.enrollmentRevision,workspaceId:state.workspaceId,program:"sunday_fishing_academy",state:"confirmed",learnerId:id(7),householdId:id(8),purchaseId:id(9),purchaseLineId:"synthetic-line",evidence:{acceptedTermsVersion:"synthetic-terms"}}};
 });
 const readInquiry=vi.fn(async(actual:SqlSession,principal:Actor,applicationId:string)=>{trace.push("inquiry");expect(actual).toBe(tx);expect(principal).toBe(actor);if(state.inquiryDenied)throw new AppError("UNAUTHENTICATED");return {id:applicationId,fields:state.fields};});
 const service=new AcademyInquiryLearnerLinkStore(database,{readEnrollmentForInquiryLinkInTransaction:readNative} as unknown as NativeFishingProgram,{readForOwnerInTransaction:readInquiry} as unknown as PublicGroupApplicationStore);
 const command={operationId:id(10),applicationId:id(4),learnerIndex:0,selectedEnrollmentId:id(5),expectedEnrollmentRevision:3,expectedInquiryFieldsDigest:academyInquiryFieldsDigest(state.fields)};
 return {service,state,command,committed,writes,trace,readNative,readInquiry,database,query};
}
afterEach(()=>vi.clearAllMocks());
describe("trusted native inquiry correlation writer, SQL doubles only",()=>{
 it("reuses one transaction and both actual-reader interfaces before creating one immutable correlation",async()=>{
  const d=setup(),result=await d.service.link(actor,d.command);expect(result).toMatchObject({saved:true,replayed:false});expect(d.committed).toHaveLength(1);expect(d.trace).toEqual(["lock","native","inquiry","source","prior","duplicate","insert","native"]);expect(d.database.transaction).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(d.writes)).not.toMatch(/Synthetic private parent|synthetic@example.invalid|33431/);expect(Object.keys(result).sort()).toEqual(["linkId","replayed","saved","version"]);
 });
 it("reauthorizes before a same-command replay and creates no second row",async()=>{const d=setup(),first=await d.service.link(actor,d.command);d.trace.length=0;expect(await d.service.link(actor,d.command)).toEqual({...first,replayed:true});expect(d.trace).toEqual(["lock","native","inquiry","source","prior","native"]);expect(d.committed).toHaveLength(1);expect(d.readNative).toHaveBeenCalledTimes(4);expect(d.readInquiry).toHaveBeenCalledTimes(2);});
 it.each(["nativeDenied","inquiryDenied"] as const)("a cached link cannot bypass current %s",async key=>{const d=setup();await d.service.link(actor,d.command);d.state[key]=true;d.trace.length=0;await expect(d.service.link(actor,d.command)).rejects.toBeInstanceOf(AppError);expect(d.trace).not.toContain("prior");expect(d.committed).toHaveLength(1);});
 it("rejects same operation with another learner index instead of replaying or overwriting",async()=>{const d=setup();await d.service.link(actor,d.command);await expect(d.service.link(actor,{...d.command,learnerIndex:1})).rejects.toMatchObject({code:"CONFLICT"});expect(d.committed).toHaveLength(1);});
 it("does not create an unreceipted new-key alias or map the same learner twice",async()=>{const d=setup();await d.service.link(actor,d.command);await expect(d.service.link(actor,{...d.command,operationId:id(11)})).rejects.toMatchObject({code:"CONFLICT"});await expect(d.service.link(actor,{...d.command,operationId:id(12),learnerIndex:1})).rejects.toMatchObject({code:"CONFLICT"});expect(d.committed).toHaveLength(1);});
 it("requires the reviewed inquiry digest and exact current enrollment revision",async()=>{const d=setup();for(const command of[{...d.command,expectedInquiryFieldsDigest:"c".repeat(64)},{...d.command,expectedEnrollmentRevision:2}])await expect(d.service.link(actor,command)).rejects.toMatchObject({code:"CONFLICT"});expect(d.committed).toHaveLength(0);});
 it("cannot replay an old guardian or inquiry binding snapshot",async()=>{const d=setup();await d.service.link(actor,d.command);d.state.guardianDigest="c".repeat(64);await expect(d.service.link(actor,d.command)).rejects.toMatchObject({code:"CONFLICT"});d.state.guardianDigest="b".repeat(64);d.state.sourceDigest="d".repeat(64);await expect(d.service.link(actor,d.command)).rejects.toMatchObject({code:"CONFLICT"});expect(d.committed).toHaveLength(1);});
 it("rejects a different workspace returned by the native reader",async()=>{const d=setup();d.state.workspaceId=id(99) as Actor["workspaceId"];await expect(d.service.link(actor,d.command)).rejects.toMatchObject({code:"FORBIDDEN"});expect(d.committed).toHaveLength(0);});
 it("requires complete validated intake and an existing in-range learner index",async()=>{const d=setup();await expect(d.service.link(actor,{...d.command,learnerIndex:8})).rejects.toMatchObject({code:"INVALID_REQUEST"});d.state.fields={...d.state.fields,academyIntake:undefined};await expect(d.service.link(actor,d.command)).rejects.toMatchObject({code:"INVALID_REQUEST"});expect(d.committed).toHaveLength(0);});
 it("rejects browser authority extras before entering a transaction",async()=>{const d=setup();await expect(d.service.link(actor,{...d.command,learnerId:id(7),guardianVerified:true})).rejects.toMatchObject({code:"INVALID_REQUEST"});expect(d.database.transaction).not.toHaveBeenCalled();});
 it("does not commit a link if the insert fails",async()=>{const d=setup();d.state.writeFails=true;await expect(d.service.link(actor,d.command)).rejects.toMatchObject({code:"UNAVAILABLE"});expect(d.committed).toHaveLength(0);});
 it("rolls back an inserted link when the final native authorization fails",async()=>{const d=setup();d.state.denyOnFinalRead=true;await expect(d.service.link(actor,d.command)).rejects.toMatchObject({code:"FORBIDDEN"});expect(d.trace).toContain("insert");expect(d.committed).toHaveLength(0);});
 it("sanitizes database uniqueness and unknown errors without private details",async()=>{const d=setup();d.state.writeFault=Object.assign(Error("PRIVATE_ERROR_CANARY"),{code:"23505"});await expect(d.service.link(actor,d.command)).rejects.toMatchObject({code:"CONFLICT",message:"CONFLICT"});d.state.writeFault=Error("PRIVATE_ERROR_CANARY");await expect(d.service.link(actor,d.command)).rejects.toMatchObject({code:"UNAVAILABLE",message:"UNAVAILABLE"});expect(d.committed).toHaveLength(0);});
 it("rejects malformed persisted inquiry digest instead of replacing it with browser input",async()=>{const d=setup();d.state.sourceDigest="invalid";await expect(d.service.link(actor,d.command)).rejects.toMatchObject({code:"UNAVAILABLE"});expect(d.committed).toHaveLength(0);});
});
