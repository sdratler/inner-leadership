import {describe,expect,it} from "vitest";
import {normalizeEmail,normalizePhone,resolveEndpoint} from "../../../src/features/contact-ops/core/contact-resolution.ts";
import {advanceCutover,canTrashWholeWorkbook,writeDestination,type CutoverProof,type CutoverState} from "../../../src/features/contact-ops/core/cutover.ts";
import {journeyStage,projectPeople,selectPeople} from "../../../src/features/contact-ops/core/people.ts";
import type {AdministrativePerson,JourneyFacts} from "../../../src/features/contact-ops/core/types.ts";

const person=(personId="synthetic-person",changes:Partial<AdministrativePerson>={}):AdministrativePerson=>({personId,workspaceId:"synthetic-workspace",displayName:"DEMO — Synthetic adult",kind:"guardian",locale:"he",endpoints:[],legacyLeadIds:[],caseIds:[],mode:"demo",demoBatchId:"synthetic-batch",archivedAt:null,doNotContact:false,version:1,...changes});
const journey=(changes:Partial<JourneyFacts>={}):JourneyFacts=>({personId:"synthetic-person",enrollmentId:"synthetic-enrollment",caseId:null,formSubmittedAt:null,formSentAt:null,contactedAt:null,paymentAllocationId:null,paymentReversedAt:null,confirmedAppointmentId:null,activeCase:false,suspended:false,...changes});
const query=(changes:Partial<Parameters<typeof selectPeople>[1]>={})=>({view:"all" as const,search:"",today:"2026-09-25",page:1,pageSize:12,...changes});
const proof=(changes:Partial<CutoverProof>={}):CutoverProof=>({backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true,...changes});
const state=(phase:CutoverState["phase"]="sheet_active"):CutoverState=>({phase,epoch:4,batchId:phase==="sheet_active"?null:"synthetic-batch",nativeWritesSinceSwitch:0});

describe("native CRM candidate integrated into the existing app",()=>{
 it("keeps contact normalization separate from login identity",()=>{
  expect(normalizeEmail("demo+parent@EXAMPLE.INVALID")).toBe("demo+parent@example.invalid");
  expect(normalizeEmail("uK@EXAMPLE.INVALID")).toBe("uK@example.invalid");
  expect(normalizeEmail("uK@EXAMPLE.INVALID")).toBe("uK@example.invalid");
  expect(normalizeEmail("a@example..com")).toBeNull();
  expect(normalizeEmail("a@-example.com")).toBeNull();
  expect(normalizeEmail("a@example-.com")).toBeNull();
  expect(normalizeEmail("a..b@example.com")).toBeNull();
  expect(normalizeEmail(".a@example.com")).toBeNull();
  expect(normalizeEmail("a.@example.com")).toBeNull();
  expect(normalizeEmail(`${"a".repeat(65)}@example.com`)).toBeNull();
  expect(normalizeEmail(`${"é".repeat(32)}@${["a".repeat(54),"b".repeat(54),"c".repeat(54),"d".repeat(55)].join(".")}`)).toBeNull();
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
  expect(selectPeople(rows,query()).items.map(row=>row.id)).toEqual(["a"]);
  expect(selectPeople(rows,query({search:"+alpha"})).items.map(row=>row.id)).toEqual(["a"]);
  expect(selectPeople(rows,query({view:"archived"})).items.map(row=>row.id)).toEqual(["b"]);
  expect(selectPeople(rows,query({page:99})).page).toBe(1);
 });
 it("keeps missed follow-ups in Today without mixing archived people into All open",()=>{
  const rows=projectPeople("synthetic-workspace",[person("overdue"),person("today"),person("future"),person("archived",{archivedAt:"2026-09-24T10:00:00Z"})],[],[
   {personId:"overdue",nextAction:"Follow up",followUpDate:"2026-09-24",nextAppointmentAt:null,unreadCount:0},
   {personId:"today",nextAction:"Follow up",followUpDate:"2026-09-25",nextAppointmentAt:null,unreadCount:0},
   {personId:"future",nextAction:"Follow up",followUpDate:"2026-09-26",nextAppointmentAt:null,unreadCount:0},
   {personId:"archived",nextAction:"Follow up",followUpDate:"2026-09-24",nextAppointmentAt:null,unreadCount:0},
  ]);
  expect(selectPeople(rows,query({due:"today"})).items.map(row=>row.id).sort()).toEqual(["overdue","today"]);
  expect(selectPeople(rows,query({view:"archived"})).items.map(row=>row.id)).toEqual(["archived"]);
 });
 it("keeps a sibling's unfinished intake visible when another case is active",()=>{
  const rows=projectPeople("synthetic-workspace",[person("family")],[
   journey({personId:"family",enrollmentId:"child-active",activeCase:true,confirmedAppointmentId:"booked"}),
   journey({personId:"family",enrollmentId:"child-new",formSentAt:"2026-09-25T10:00:00Z"}),
  ],[]);
  expect(rows[0]).toMatchObject({active:true,openProspect:true});
  expect(selectPeople(rows,query({view:"prospects"})).items.map(row=>row.id)).toEqual(["family"]);
  expect(selectPeople(rows,query({view:"prospects",stage:"form_sent"})).items.map(row=>row.id)).toEqual(["family"]);
 });
 it("requires restored backups, reconciled rows and a writer fence before native authority",()=>{
  expect(()=>advanceCutover(state(),"prepare",proof({backupRestored:false}),"synthetic-batch")).toThrow("IMPORT_NOT_RECONCILED");
  expect(()=>advanceCutover(state("frozen"),"switch_native",proof({writersFenced:false}),"synthetic-batch")).toThrow("UNSAFE_CUTOVER");
  expect(()=>advanceCutover(state("frozen"),"switch_native",proof({identityConflicts:1}),"synthetic-batch")).toThrow("UNSAFE_CUTOVER");
  expect(writeDestination("frozen")).toBe("durable_queue_only");
  expect(()=>advanceCutover(state("native_active"),"retire_sheet",proof({writersFenced:false}),"synthetic-batch")).toThrow("UNSAFE_RETIREMENT");
  expect(()=>advanceCutover(state("native_active"),"retire_sheet",proof({sourceFrozen:false}),"synthetic-batch")).toThrow("UNSAFE_RETIREMENT");
  expect(()=>advanceCutover(state("rollback_prepared"),"finish_rollback",proof({sheetConsumersRepointed:false}),"synthetic-batch")).toThrow("ROLLBACK_DELTA_UNVERIFIED");
  expect(writeDestination("rollback_prepared")).toBe("durable_queue_only");
 });
 it("cannot retire a workbook still used by marketing, even when Leads is migrated",()=>{
  const names=Array.from({length:16},(_,i)=>`Synthetic tab ${i+1}`),inventory={sourceFileId:"synthetic-workbook",revision:"synthetic-revision",completeSourceReadback:true,tabNames:names,tabCount:16};
  const safe=names.map(name=>({name,kind:"crm" as const,activeReader:false,activeWriter:false,preserved:true}));
  expect(canTrashWholeWorkbook(safe,true,inventory)).toBe(true);
  expect(canTrashWholeWorkbook(safe.slice(0,-1),true,inventory)).toBe(false);
  expect(canTrashWholeWorkbook(safe,true,{...inventory,completeSourceReadback:false})).toBe(false);
  expect(canTrashWholeWorkbook(safe.map((d,i)=>i===3?{...d,activeReader:true}:d),true,inventory)).toBe(false);
  expect(canTrashWholeWorkbook([{name:"Leads",kind:"crm",activeReader:false,activeWriter:false,preserved:true},{name:"Asset Registry",kind:"marketing",activeReader:true,activeWriter:false,preserved:true}],true)).toBe(false);
  expect(canTrashWholeWorkbook([{name:"Leads",kind:"crm",activeReader:false,activeWriter:false,preserved:true}],false)).toBe(false);
 });
});
