import {expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {academyCrmCommandSchema,academyInitializationInputSchema,academyContactOriginSchema} from "../../../src/features/contact-ops/core/academy-crm.ts";
import {writeDestination,advanceCutover,type CutoverState,type CutoverProof} from "../../../src/features/contact-ops/core/cutover.ts";
import {cutoverStateSchema} from "../../../src/features/contact-ops/server/cutover-state.ts";
import {inboundProjectionEnabled} from "../../../src/features/contact-ops/core/inbound-projection.ts";
const operationId="00000000-0000-4000-8000-000000000001";
const evidence={retiredSourcesFence:"a".repeat(64),retiredSchedulesFence:"b".repeat(64),retainedAcademyRecords:"c".repeat(64),queueReconciliation:"d".repeat(64),restorePlan:"e".repeat(64)};
const fresh:CutoverState={phase:"academy_native",epoch:1,batchId:operationId,sourceFileId:null,sourceRevision:null,nativeWritesSinceSwitch:0,
 academy:{kind:"academy_fresh",program:"sunday_fishing_academy",operationId,decisionId:"ACADEMY-ONLY-CRM-20261028-01",initializedAt:"2026-10-28T12:00:00.000Z",importedRows:0,evidence}};
const fields={name:"Synthetic Academy parent",phone:null,email:"synthetic@example.invalid",language:"en",relationship:"guardian",stage:"New inquiry",nextAction:null,followUpDate:null,notes:""};

it("fresh Academy authority cannot wake generic native writers or old inbound projection",()=>{
 expect(cutoverStateSchema.safeParse(fresh).success).toBe(true);
 expect(writeDestination("academy_native")).toBe("durable_queue_only");expect(inboundProjectionEnabled("academy_native")).toBe(false);
 expect(()=>advanceCutover(fresh,"prepare_rollback",{} as CutoverProof,"fake")).toThrow("ACADEMY_AUTHORITY_IS_NOT_LEGACY_CUTOVER");
 for(const change of [{academy:undefined},{sourceFileId:"retired-sheet"},{sourceRevision:"fake"},{batchId:"other"},
  {academy:{...fresh.academy,importedRows:1}},{phase:"native_active"}])expect(cutoverStateSchema.safeParse({...fresh,...change}).success).toBe(false);
});
it("initialization evidence has no import or browser-selected authority fields",()=>{
 const input={operationId,expectedEpoch:0,observedNativeWritesSinceSwitch:0,decisionId:"ACADEMY-ONLY-CRM-20261028-01",evidence};
 expect(academyInitializationInputSchema.safeParse(input).success).toBe(true);
 for(const field of ["imported","sourceFileId","phase","workspaceId","program","empty"])
  expect(academyInitializationInputSchema.safeParse({...input,[field]:true}).success).toBe(false);
 expect(academyInitializationInputSchema.safeParse({...input,evidence:{...evidence,restorePlan:""}}).success).toBe(false);
});
it("accepts genuine email-only or phone-only contacts without fabricated phone values",()=>{
 const input={action:"create",operationId,expectedEpoch:1,fields};
 expect(academyCrmCommandSchema.parse(input)).toMatchObject({fields:{phone:null,email:"synthetic@example.invalid"}});
 expect(academyCrmCommandSchema.safeParse({...input,fields:{...fields,phone:"+13055550123",email:null}}).success).toBe(true);
 expect(academyCrmCommandSchema.safeParse({...input,fields:{...fields,email:null}}).success).toBe(false);
 expect(academyCrmCommandSchema.safeParse({...input,fields:{...fields,phone:"synthetic@example.invalid"}}).success).toBe(false);
});
it.each(["program","workspaceId","personId","initializationId","outboundEligible","permission","send","imported"])
("rejects client-supplied admission or effect %s",field=>{
 expect(academyCrmCommandSchema.safeParse({action:"create",operationId,expectedEpoch:1,fields,[field]:"untrusted"}).success).toBe(false);
});
it("keeps source origin internally consistent and administrative mutations separate",()=>{
 const origin={kind:"manual",program:"sunday_fishing_academy",initializationId:operationId,sourceApplicationId:null,sourceDigest:null,
  language:"en",phone:null,email:"synthetic@example.invalid",createdAt:"2026-10-28T12:00:00.000Z"};
 expect(academyContactOriginSchema.safeParse(origin).success).toBe(true);
 expect(academyContactOriginSchema.safeParse({...origin,kind:"inquiry"}).success).toBe(false);
 expect(academyCrmCommandSchema.safeParse({action:"update",operationId,expectedEpoch:1,personId:operationId,expectedVersion:1,
  fields:{stage:"New inquiry",notes:"",nextAction:null,followUpDate:null,academyOrigin:origin}}).success).toBe(false);
});
