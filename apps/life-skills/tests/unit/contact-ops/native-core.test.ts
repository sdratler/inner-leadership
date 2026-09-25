import {describe,expect,it} from "vitest";
import {normalizeEmail,normalizePhone,resolveEndpoint} from "../../../src/features/contact-ops/core/contact-resolution.ts";
import {advanceCutover,canTrashWholeWorkbook,writeDestination,type CutoverProof,type CutoverState} from "../../../src/features/contact-ops/core/cutover.ts";
import {journeyStage,projectPeople,selectPeople} from "../../../src/features/contact-ops/core/people.ts";
import type {AdministrativePerson,JourneyFacts} from "../../../src/features/contact-ops/core/types.ts";

const person=(personId="synthetic-person",changes:Partial<AdministrativePerson>={}):AdministrativePerson=>({personId,workspaceId:"synthetic-workspace",displayName:"DEMO — Synthetic adult",kind:"guardian",locale:"he",endpoints:[],legacyLeadIds:[],caseIds:[],mode:"demo",demoBatchId:"synthetic-batch",archivedAt:null,doNotContact:false,version:1,...changes});
const journey=(changes:Partial<JourneyFacts>={}):JourneyFacts=>({personId:"synthetic-person",enrollmentId:"synthetic-enrollment",caseId:null,formSubmittedAt:null,formSentAt:null,contactedAt:null,paymentAllocationId:null,paymentReversedAt:null,confirmedAppointmentId:null,activeCase:false,suspended:false,...changes});
const query=(changes:Partial<Parameters<typeof selectPeople>[1]>={})=>({view:"all" as const,search:"",today:"2026-09-25",page:1,pageSize:12,...changes});
const proof=(changes:Partial<CutoverProof>={}):CutoverProof=>({backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true,...changes});
const state=(phase:CutoverState["phase"]="sheet_active"):CutoverState=>({phase,epoch:4,batchId:phase==="sheet_active"?null:"synthetic-batch",nativeWritesSinceSwitch:0});

describe("native CRM candidate integrated into the existing app",()=>{
 it("keeps contact normalization separate from login identity",()=>{
  expect(normalizeEmail("demo+parent@EXAMPLE.INVALID")).toBe("demo+parent@example.invalid");
  expect(normalizePhone("052-000-0001")).toBe("+972520000001");
  expect(normalizePhone("name@phone")).toBeNull();
 });
 it("never treats a shared endpoint as proof of one person or guardian permission",()=>{
  expect(resolveEndpoint("synthetic-workspace","blind",[{workspaceId:"synthetic-workspace",personId:"a",endpointKey:"blind",verified:true,shared:true,revoked:false}])).toEqual({kind:"ambiguous",candidateIds:["a"]});
  expect(resolveEndpoint("synthetic-workspace","blind",[{workspaceId:"other",personId:"a",endpointKey:"blind",verified:true,shared:false,revoked:false}])).toEqual({kind:"new"});
 });
 it("refuses duplicate or cross-workspace people and unmarked demo records",()=>{
  expect(()=>projectPeople("synthetic-workspace",[person(),person()],[],[])).toThrow("DUPLICATE_PERSON");
  expect(()=>projectPeople("synthetic-workspace",[person("other",{workspaceId:"other"})],[],[])).toThrow("CROSS_WORKSPACE");
  expect(()=>projectPeople("synthetic-workspace",[person("other",{demoBatchId:null})],[],[])).toThrow("UNMARKED_DEMO");
 });
 it("requires an actual non-reversed allocation and preserves independent child journeys",()=>{
  expect(journeyStage(journey({formSubmittedAt:"2026-09-24T10:00:00Z"}))).toBe("payment_pending");
  expect(journeyStage(journey({paymentAllocationId:"allocation",paymentReversedAt:"2026-09-25T10:00:00Z"}))).toBe("new");
  const row=projectPeople("synthetic-workspace",[person()],[journey({enrollmentId:"child-a",activeCase:true,confirmedAppointmentId:"appointment"}),journey({enrollmentId:"child-b",paymentAllocationId:"allocation"})],[])[0];
  expect(row).toMatchObject({active:true,paidAwaitingBooking:true});
 });
 it("returns one sortable, searchable, paginated person projection",()=>{
  const rows=projectPeople("synthetic-workspace",[person("a",{displayName:"DEMO — Alpha",endpoints:[{channel:"email",value:"demo+alpha@example.invalid",verified:true,shared:false}]}),person("b",{displayName:"DEMO — Beta",archivedAt:"2026-09-24T10:00:00Z"})],[],[]);
  expect(selectPeople(rows,query()).total).toBe(2);
  expect(selectPeople(rows,query({search:"+alpha"})).items.map(row=>row.id)).toEqual(["a"]);
  expect(selectPeople(rows,query({view:"archived"})).items.map(row=>row.id)).toEqual(["b"]);
  expect(selectPeople(rows,query({page:99})).page).toBe(1);
 });
 it("requires restored backups, reconciled rows and a writer fence before native authority",()=>{
  expect(()=>advanceCutover(state(),"prepare",proof({backupRestored:false}),"synthetic-batch")).toThrow("IMPORT_NOT_RECONCILED");
  expect(()=>advanceCutover(state("frozen"),"switch_native",proof({writersFenced:false}),"synthetic-batch")).toThrow("UNSAFE_CUTOVER");
  expect(()=>advanceCutover(state("frozen"),"switch_native",proof({identityConflicts:1}),"synthetic-batch")).toThrow("UNSAFE_CUTOVER");
  expect(writeDestination("frozen")).toBe("durable_queue_only");
 });
 it("cannot retire a workbook still used by marketing, even when Leads is migrated",()=>{
  expect(canTrashWholeWorkbook([{name:"Leads",kind:"crm",activeReader:false,activeWriter:false,preserved:true},{name:"Asset Registry",kind:"marketing",activeReader:true,activeWriter:false,preserved:true}],true)).toBe(false);
  expect(canTrashWholeWorkbook([{name:"Leads",kind:"crm",activeReader:false,activeWriter:false,preserved:true}],false)).toBe(false);
 });
});
