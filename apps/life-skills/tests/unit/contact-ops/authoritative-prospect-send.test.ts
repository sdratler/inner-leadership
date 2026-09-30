import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {assertLegacyProspectSenderAvailable,projectIntakeToLegacyIfCurrent,
 projectLegacyProspectAfterSend,reconcileLegacyProspectProjection,resolvePreparedProspectSend,sendAuthoritativeProspectMessage} from "../../../src/features/contact-ops/server/authoritative-prospect-send.ts";
import type {Actor} from "../../../src/features/identity/types.ts";
import type {CutoverState,Phase} from "../../../src/features/contact-ops/core/cutover.ts";
import type {SqlSession} from "../../../src/features/identity/store.ts";

const actor={id:"synthetic-owner",role:"practitioner",workspaceId:"synthetic-workspace"} as Actor;
const intakeQueries=vi.fn(async(sql:string)=>sql.includes("to_regclass")?[{available:true}]:[]);
const runtime={store:{transaction:<T>(work:(tx:SqlSession)=>Promise<T>)=>work({query:intakeQueries} as unknown as SqlSession)},
 config:{workspaceId:"synthetic-workspace"},clock:{now:()=>new Date("2026-09-29T01:00:00Z")}} as Parameters<typeof sendAuthoritativeProspectMessage>[1];
const state=(phase:Phase):CutoverState=>({phase,epoch:3,batchId:"synthetic",sourceFileId:"synthetic",
 sourceRevision:"synthetic",nativeWritesSinceSwitch:0});
const authority=(phase:Phase)=>({read:vi.fn().mockResolvedValue(state(phase))});
const sender=vi.fn().mockResolvedValue({success:true,receipt:{provider:"synthetic",providerMessageId:"synthetic-id",sentAt:"2026-09-29T00:00:00Z"}});
const receipt={provider:"synthetic",providerMessageId:"synthetic-id",sentAt:"2026-09-29T00:00:00Z"};
const ledger={prepare:vi.fn().mockResolvedValue("synthetic-operation"),confirm:vi.fn().mockResolvedValue(undefined),read:vi.fn().mockResolvedValue(null),
 projected:vi.fn().mockResolvedValue(undefined)};
const projectedRow=(fields:Record<string,string>)=>[{leadId:"LS-LEAD-synthetic",...fields}] as unknown as Awaited<ReturnType<typeof import("../../../src/features/prospects/bridge.ts").listProspects>>;
const list=(fields:Record<string,string>)=>vi.fn().mockResolvedValue(projectedRow(fields));

describe("Sheet-bound prospect send fence",()=>{
 it.each(["sheet_active","shadow_ready"] as const)("preserves the existing transport in %s",async phase=>{
  sender.mockClear();const a=authority(phase);
  ledger.prepare.mockClear();await sendAuthoritativeProspectMessage(actor,runtime,"LS-LEAD-synthetic","synthetic message",
   {stage:"Contacted"},{authority:a,sender,ledger});
  expect(a.read).toHaveBeenCalledWith(actor);expect(ledger.prepare).toHaveBeenCalledOnce();expect(sender).toHaveBeenCalledOnce();
  expect(ledger.prepare.mock.invocationCallOrder[0]).toBeLessThan(sender.mock.invocationCallOrder[0]!);
 });
 it("pauses before provider contact when the outbound ledger migration is pending",async()=>{
  const a=authority("sheet_active");sender.mockClear();ledger.prepare.mockClear();
  intakeQueries.mockImplementation(async(sql:string)=>sql.includes("to_regclass")?[{available:false}]:[]);
  try{
   await expect(sendAuthoritativeProspectMessage(actor,runtime,"LS-LEAD-synthetic","synthetic message",
    {stage:"Contacted"},{authority:a,sender,ledger})).rejects.toMatchObject({code:"UNAVAILABLE"});
   expect(ledger.prepare).not.toHaveBeenCalled();expect(sender).not.toHaveBeenCalled();
  }finally{intakeQueries.mockImplementation(async(sql:string)=>sql.includes("to_regclass")?[{available:true}]:[]);}
 });
 it.each(["frozen","native_active","retired","rollback_prepared"] as const)("does not send through Sheet in %s",async phase=>{
  sender.mockClear();const a=authority(phase);
  ledger.prepare.mockClear();await expect(sendAuthoritativeProspectMessage(actor,runtime,"LS-LEAD-synthetic","synthetic message",
   {stage:"Contacted"},{authority:a,sender,ledger})).rejects.toMatchObject({code:"CONFLICT"});
  expect(ledger.prepare).not.toHaveBeenCalled();expect(sender).not.toHaveBeenCalled();
 });
 it("denies a non-practitioner before authority or transport",async()=>{
  sender.mockClear();const a=authority("sheet_active");
  await expect(sendAuthoritativeProspectMessage({...actor,role:"parent"},runtime,"LS-LEAD-synthetic","synthetic message",
   {stage:"Contacted"},{authority:a,sender,ledger}))
   .rejects.toMatchObject({code:"FORBIDDEN"});expect(a.read).not.toHaveBeenCalled();expect(sender).not.toHaveBeenCalled();
 });
 it("does not issue a form token if the pre-issue check sees frozen authority",async()=>{
  const a=authority("frozen");await expect(assertLegacyProspectSenderAvailable(actor,runtime,a)).rejects.toMatchObject({code:"CONFLICT"});
 });
 it("rejects an intake token's stale authority epoch before transport",async()=>{
  sender.mockClear();const a=authority("sheet_active");
  await expect(sendAuthoritativeProspectMessage(actor,runtime,"LS-LEAD-synthetic","synthetic message",
   {stage:"Contacted"},{authority:a,sender,ledger},2))
   .rejects.toMatchObject({code:"CONFLICT"});expect(sender).not.toHaveBeenCalled();
 });
 it("does not fall back to transport if the authority read fails",async()=>{
  sender.mockClear();const a=authority("sheet_active");a.read.mockRejectedValue(Error("synthetic authority unavailable"));
  await expect(sendAuthoritativeProspectMessage(actor,runtime,"LS-LEAD-synthetic","synthetic message",
   {stage:"Contacted"},{authority:a,sender,ledger}))
   .rejects.toThrow("synthetic authority unavailable");expect(sender).not.toHaveBeenCalled();
 });
 it("never calls the provider when the durable pre-send intent cannot be committed",async()=>{
  sender.mockClear();const failed={...ledger,prepare:vi.fn().mockRejectedValue(Error("synthetic database unavailable"))};
  await expect(sendAuthoritativeProspectMessage(actor,runtime,"LS-LEAD-synthetic","synthetic message",
   {stage:"Contacted"},{authority:authority("sheet_active"),sender,ledger:failed}))
   .rejects.toThrow("synthetic database unavailable");
  expect(sender).not.toHaveBeenCalled();
 });
});

describe("post-effect legacy projection fence",()=>{
 it("keeps the provider receipt pending after an in-flight native switch",async()=>{
  const update=vi.fn();ledger.confirm.mockClear();
  expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",{stage:"Contacted"},3,
   "synthetic-operation",receipt,{authority:authority("native_active"),update,list:list({stage:"Contacted"}),ledger}))
   .toEqual({projectionPending:true});
  expect(ledger.confirm).toHaveBeenCalledOnce();expect(update).not.toHaveBeenCalled();
 });
 it("does not project after an epoch change even if Sheet became active again",async()=>{
  const update=vi.fn();expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",{stage:"Contacted"},2,
   "synthetic-operation",receipt,{authority:authority("sheet_active"),update,list:list({stage:"Contacted"}),ledger}))
   .toMatchObject({projectionPending:true});expect(update).not.toHaveBeenCalled();
 });
 it("retains current Sheet projection, but reports a real projection failure",async()=>{
  const update=vi.fn().mockResolvedValue(undefined),a=authority("sheet_active");
  ledger.projected.mockClear();
  expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",{stage:"Contacted"},3,
   "synthetic-operation",receipt,{authority:a,update,list:list({stage:"Contacted"}),ledger})).toEqual({projectionPending:false});
  expect(ledger.confirm.mock.invocationCallOrder.at(-1)).toBeLessThan(update.mock.invocationCallOrder[0]!);
  expect(ledger.projected).toHaveBeenCalledOnce();
  expect(update).toHaveBeenCalledOnce();update.mockRejectedValue(Error("synthetic Sheet unavailable"));
  expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",{stage:"Contacted"},3,
   "synthetic-operation",receipt,{authority:a,update,list:list({stage:"Contacted"}),ledger})).toMatchObject({projectionPending:true});
 });
 it("keeps a confirmed send visible when the post-send authority read fails",async()=>{
  const update=vi.fn(),a=authority("sheet_active");a.read.mockRejectedValue(Error("synthetic database unavailable"));
  expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",{stage:"Contacted"},3,
   "synthetic-operation",receipt,{authority:a,update,list:list({stage:"Contacted"}),ledger})).toMatchObject({projectionPending:true});
  expect(update).not.toHaveBeenCalled();
 });
 it("does not claim a persisted receipt when its durable confirmation fails",async()=>{
  const update=vi.fn(),failed={...ledger,confirm:vi.fn().mockRejectedValue(Error("synthetic database unavailable")),read:vi.fn().mockRejectedValue(Error("synthetic database unavailable"))};
  await expect(projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",{stage:"Contacted"},3,
   "synthetic-operation",receipt,{authority:authority("sheet_active"),update,list:list({stage:"Contacted"}),ledger:failed}))
   .rejects.toMatchObject({code:"UNAVAILABLE"});
  expect(failed.confirm).toHaveBeenCalledTimes(3);expect(update).not.toHaveBeenCalled();
 });
 it("accepts a lost confirmation response only after reading back the durable receipt",async()=>{
  const fields={stage:"Contacted"},update=vi.fn().mockResolvedValue(undefined);
  const saved={state:"sent_pending",fields,receipt},uncertain={...ledger,confirm:vi.fn().mockRejectedValue(Error("response lost")),read:vi.fn().mockResolvedValue(saved)};
  expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",fields,3,
   "synthetic-operation",receipt,{authority:authority("sheet_active"),update,list:list(fields),ledger:uncertain}))
   .toEqual({projectionPending:false});
  expect(uncertain.confirm).toHaveBeenCalledOnce();expect(update).toHaveBeenCalledOnce();
 });
 it("keeps projection pending until the Sheet update is visible on readback",async()=>{
  const fields={stage:"Contacted"},update=vi.fn().mockResolvedValue(undefined),unreadable=list({stage:"New"});
  ledger.projected.mockClear();
  expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",fields,3,
   "synthetic-operation",receipt,{authority:authority("sheet_active"),update,list:unreadable,ledger}))
   .toEqual({projectionPending:true});
  expect(update).toHaveBeenCalledOnce();expect(ledger.projected).not.toHaveBeenCalled();
 });
 it.each(["frozen","native_active","retired","rollback_prepared"] as const)("does not project submitted intake to Sheet in %s",async phase=>{
  const update=vi.fn();expect(await projectIntakeToLegacyIfCurrent(runtime,"LS-LEAD-synthetic",{formSubmitted:"synthetic"},
   {read:async()=>state(phase),update})).toBe(true);expect(update).not.toHaveBeenCalled();
 });
 it("preserves a submitted form and legacy projection while Sheet is authority",async()=>{
  const update=vi.fn().mockResolvedValue(undefined);
  intakeQueries.mockClear();
  expect(await projectIntakeToLegacyIfCurrent(runtime,"LS-LEAD-synthetic",{formSubmitted:"synthetic"},
   {read:async()=>state("sheet_active"),update})).toBe(false);expect(update).toHaveBeenCalledOnce();
  expect(intakeQueries).toHaveBeenNthCalledWith(1,"SET TRANSACTION READ ONLY");
  expect(intakeQueries).toHaveBeenNthCalledWith(2,"SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
   ["synthetic-workspace:contact-authority"]);
 });
});

describe("confirmed-send reconciliation without provider resend",()=>{
 const fields={stage:"Contacted",nextAction:"Synthetic follow-up"};
 const record={operationId:"synthetic-operation",leadId:"LS-LEAD-synthetic",authorityEpoch:3,state:"sent_pending" as const,
  message:"Synthetic message",fields,receipt};
 it("reapplies the exact confirmed fields and verifies their Sheet readback",async()=>{
  sender.mockClear();
  const update=vi.fn().mockResolvedValue(undefined),listed=list(fields),saved={...ledger,read:vi.fn().mockResolvedValue(record),projected:vi.fn().mockResolvedValue(undefined)};
  expect(await reconcileLegacyProspectProjection(actor,runtime,record.operationId,
   {authority:authority("sheet_active"),update,list:listed,ledger:saved})).toEqual({projected:true});
  expect(update).toHaveBeenCalledWith(record.leadId,fields);expect(listed).toHaveBeenCalledOnce();
  expect(saved.projected).toHaveBeenCalledOnce();expect(sender).not.toHaveBeenCalled();
 });
 it("refuses an uncertain prepared send or a changed authority",async()=>{
  const update=vi.fn(),saved={...ledger,read:vi.fn().mockResolvedValue({...record,state:"prepared"})};
  await expect(reconcileLegacyProspectProjection(actor,runtime,record.operationId,
   {authority:authority("sheet_active"),update,list:list(fields),ledger:saved})).rejects.toMatchObject({code:"CONFLICT"});
  saved.read.mockResolvedValue(record);
  await expect(reconcileLegacyProspectProjection(actor,runtime,record.operationId,
   {authority:authority("native_active"),update,list:list(fields),ledger:saved})).rejects.toMatchObject({code:"CONFLICT"});
  expect(update).not.toHaveBeenCalled();
 });
 it("does not drain the fence when the Sheet readback is stale",async()=>{
  const update=vi.fn().mockResolvedValue(undefined),saved={...ledger,read:vi.fn().mockResolvedValue(record),projected:vi.fn()};
  await expect(reconcileLegacyProspectProjection(actor,runtime,record.operationId,
   {authority:authority("sheet_active"),update,list:list({stage:"New"}),ledger:saved})).rejects.toMatchObject({code:"UNAVAILABLE"});
  expect(saved.projected).not.toHaveBeenCalled();
 });
 it("denies a parent before reading the receipt",async()=>{
  const saved={...ledger,read:vi.fn()};
  await expect(reconcileLegacyProspectProjection({...actor,role:"parent"},runtime,record.operationId,
   {authority:authority("sheet_active"),update:vi.fn(),list:list(fields),ledger:saved})).rejects.toMatchObject({code:"FORBIDDEN"});
  expect(saved.read).not.toHaveBeenCalled();
 });
});

describe("manual provider-evidence resolution of an ambiguous prepared send",()=>{
 const prepared={operationId:"synthetic-operation",leadId:"LS-LEAD-synthetic",authorityEpoch:3,
  createdAt:"2026-09-29T00:00:00Z",state:"prepared" as const,message:"Synthetic exact message",
  fields:{stage:"Intake sent",updateProvenance:"private-app:intake-sent"},receipt:null,resolution:null};
 const verification={outcome:"delivered" as const,source:"provider_delivery_log" as const,
  reference:"synthetic-provider-id",providerMessageId:"synthetic-provider-id",
  sentAt:"2026-09-29T00:15:00Z",checkedAt:"2026-09-29T00:20:00Z",verifiedExactMessage:true as const};
 it("records exact provider receipt and derived intake fields before CRM readback, never resending",async()=>{
  sender.mockClear();
  const final={...prepared.fields,formSent:verification.sentAt,messageReceipt:verification.providerMessageId};
  const update=vi.fn().mockResolvedValue(undefined),saved={...ledger,read:vi.fn().mockResolvedValue(prepared),confirm:vi.fn().mockResolvedValue(undefined),projected:vi.fn().mockResolvedValue(undefined),notDelivered:vi.fn()};
  expect(await resolvePreparedProspectSend(actor,runtime,prepared.operationId,verification,
   {authority:authority("sheet_active"),update,list:list(final),ledger:saved})).toMatchObject({outcome:"delivered",providerSend:false,projectionPending:false});
  expect(saved.confirm).toHaveBeenCalledWith(actor,prepared.operationId,expect.objectContaining({provider:"whapi",providerMessageId:verification.providerMessageId,
   manualVerification:{source:verification.source,reference:verification.reference,checkedAt:verification.checkedAt}}),final);
  expect(update).toHaveBeenCalledWith(prepared.leadId,final);expect(sender).not.toHaveBeenCalled();
 });
 it("accepts a whole-second provider time within the intent's subsecond precision only",async()=>{
  const subsecond={...prepared,createdAt:"2026-09-29T00:15:00.850Z"};
  const wholeSecond={...verification,sentAt:"2026-09-29T00:15:00Z"};
  const final={...prepared.fields,formSent:wholeSecond.sentAt,messageReceipt:wholeSecond.providerMessageId};
  const saved={...ledger,read:vi.fn().mockResolvedValue(subsecond),confirm:vi.fn().mockResolvedValue(undefined),
   projected:vi.fn().mockResolvedValue(undefined),notDelivered:vi.fn()};
  expect(await resolvePreparedProspectSend(actor,runtime,prepared.operationId,wholeSecond,
   {authority:authority("sheet_active"),update:vi.fn(),list:list(final),ledger:saved})).toMatchObject({outcome:"delivered",projectionPending:false});
  expect(saved.confirm).toHaveBeenCalledOnce();
  await expect(resolvePreparedProspectSend(actor,runtime,prepared.operationId,
   {...wholeSecond,sentAt:"2026-09-29T00:14:59Z"},
   {authority:authority("sheet_active"),update:vi.fn(),list:list(final),ledger:saved})).rejects.toMatchObject({code:"INVALID_REQUEST"});
  await expect(resolvePreparedProspectSend(actor,runtime,prepared.operationId,
   {...wholeSecond,sentAt:"2026-09-29T00:15:00.849Z"},
   {authority:authority("sheet_active"),update:vi.fn(),list:list(final),ledger:saved})).rejects.toMatchObject({code:"INVALID_REQUEST"});
 });
 it("records a negative provider attestation without a send or Sheet write",async()=>{
  sender.mockClear();const update=vi.fn(),saved={...ledger,read:vi.fn().mockResolvedValue(prepared),notDelivered:vi.fn().mockResolvedValue(undefined)};
  const input={outcome:"not_delivered" as const,source:"provider_support_case" as const,reference:"WHAPI-SUPPORT-12345",
   checkedAt:"2026-09-29T00:20:00Z",verifiedExactMessage:true as const};
  expect(await resolvePreparedProspectSend(actor,runtime,prepared.operationId,input,
   {authority:authority("sheet_active"),update,list:list({}),ledger:saved})).toEqual({outcome:"not_delivered",providerSend:false});
  expect(saved.notDelivered).toHaveBeenCalledOnce();expect(update).not.toHaveBeenCalled();expect(sender).not.toHaveBeenCalled();
 });
 it("rejects a stale authority or unverified negative claim without changing the ledger",async()=>{
  const saved={...ledger,read:vi.fn().mockResolvedValue(prepared),notDelivered:vi.fn()};
  await expect(resolvePreparedProspectSend(actor,runtime,prepared.operationId,
   {...verification,outcome:"not_delivered"},
   {authority:authority("native_active"),update:vi.fn(),list:list({}),ledger:saved})).rejects.toMatchObject({code:"CONFLICT"});
  await expect(resolvePreparedProspectSend(actor,runtime,prepared.operationId,
   {...verification,verifiedExactMessage:false as never},
   {authority:authority("sheet_active"),update:vi.fn(),list:list({}),ledger:saved})).rejects.toMatchObject({code:"INVALID_REQUEST"});
  expect(saved.notDelivered).not.toHaveBeenCalled();
 });
});
