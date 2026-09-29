import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {assertLegacyProspectSenderAvailable,projectIntakeToLegacyIfCurrent,
 projectLegacyProspectAfterSend,sendAuthoritativeProspectMessage} from "../../../src/features/contact-ops/server/authoritative-prospect-send.ts";
import type {Actor} from "../../../src/features/identity/types.ts";
import type {CutoverState,Phase} from "../../../src/features/contact-ops/core/cutover.ts";

const actor={id:"synthetic-owner",role:"practitioner",workspaceId:"synthetic-workspace"} as Actor;
const runtime={store:{},config:{workspaceId:"synthetic-workspace"}} as Parameters<typeof sendAuthoritativeProspectMessage>[1];
const state=(phase:Phase):CutoverState=>({phase,epoch:3,batchId:"synthetic",sourceFileId:"synthetic",
 sourceRevision:"synthetic",nativeWritesSinceSwitch:0});
const authority=(phase:Phase)=>({read:vi.fn().mockResolvedValue(state(phase))});
const sender=vi.fn().mockResolvedValue({success:true,receipt:{provider:"synthetic",providerMessageId:"synthetic-id",sentAt:"2026-09-29T00:00:00Z"}});
const receipt={provider:"synthetic",providerMessageId:"synthetic-id",sentAt:"2026-09-29T00:00:00Z"};
const ledger={prepare:vi.fn().mockResolvedValue("synthetic-operation"),confirm:vi.fn().mockResolvedValue(undefined),
 projected:vi.fn().mockResolvedValue(undefined)};

describe("Sheet-bound prospect send fence",()=>{
 it.each(["sheet_active","shadow_ready"] as const)("preserves the existing transport in %s",async phase=>{
  sender.mockClear();const a=authority(phase);
  ledger.prepare.mockClear();await sendAuthoritativeProspectMessage(actor,runtime,"LS-LEAD-synthetic","synthetic message",
   {stage:"Contacted"},{authority:a,sender,ledger});
  expect(a.read).toHaveBeenCalledWith(actor);expect(ledger.prepare).toHaveBeenCalledOnce();expect(sender).toHaveBeenCalledOnce();
  expect(ledger.prepare.mock.invocationCallOrder[0]).toBeLessThan(sender.mock.invocationCallOrder[0]!);
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
   "synthetic-operation",receipt,{authority:authority("native_active"),update,ledger}))
   .toEqual({projectionPending:true,receiptPersistencePending:false});
  expect(ledger.confirm).toHaveBeenCalledOnce();expect(update).not.toHaveBeenCalled();
 });
 it("does not project after an epoch change even if Sheet became active again",async()=>{
  const update=vi.fn();expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",{stage:"Contacted"},2,
   "synthetic-operation",receipt,{authority:authority("sheet_active"),update,ledger}))
   .toMatchObject({projectionPending:true});expect(update).not.toHaveBeenCalled();
 });
 it("retains current Sheet projection, but reports a real projection failure",async()=>{
  const update=vi.fn().mockResolvedValue(undefined),a=authority("sheet_active");
  ledger.projected.mockClear();
  expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",{stage:"Contacted"},3,
   "synthetic-operation",receipt,{authority:a,update,ledger})).toEqual({projectionPending:false,receiptPersistencePending:false});
  expect(ledger.confirm.mock.invocationCallOrder.at(-1)).toBeLessThan(update.mock.invocationCallOrder[0]!);
  expect(ledger.projected).toHaveBeenCalledOnce();
  expect(update).toHaveBeenCalledOnce();update.mockRejectedValue(Error("synthetic Sheet unavailable"));
  expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",{stage:"Contacted"},3,
   "synthetic-operation",receipt,{authority:a,update,ledger})).toMatchObject({projectionPending:true});
 });
 it("keeps a confirmed send visible when the post-send authority read fails",async()=>{
  const update=vi.fn(),a=authority("sheet_active");a.read.mockRejectedValue(Error("synthetic database unavailable"));
  expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",{stage:"Contacted"},3,
   "synthetic-operation",receipt,{authority:a,update,ledger})).toMatchObject({projectionPending:true});
  expect(update).not.toHaveBeenCalled();
 });
 it("does not claim a persisted receipt when its durable confirmation fails",async()=>{
  const update=vi.fn(),failed={...ledger,confirm:vi.fn().mockRejectedValue(Error("synthetic database unavailable"))};
  expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",{stage:"Contacted"},3,
   "synthetic-operation",receipt,{authority:authority("sheet_active"),update,ledger:failed}))
   .toEqual({projectionPending:true,receiptPersistencePending:true});
  expect(update).not.toHaveBeenCalled();
 });
 it.each(["frozen","native_active","retired","rollback_prepared"] as const)("does not project submitted intake to Sheet in %s",async phase=>{
  const update=vi.fn();expect(await projectIntakeToLegacyIfCurrent(runtime,"LS-LEAD-synthetic",{formSubmitted:"synthetic"},
   {read:async()=>state(phase),update})).toBe(true);expect(update).not.toHaveBeenCalled();
 });
 it("preserves a submitted form and legacy projection while Sheet is authority",async()=>{
  const update=vi.fn().mockResolvedValue(undefined);
  expect(await projectIntakeToLegacyIfCurrent(runtime,"LS-LEAD-synthetic",{formSubmitted:"synthetic"},
   {read:async()=>state("sheet_active"),update})).toBe(false);expect(update).toHaveBeenCalledOnce();
 });
});
