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

describe("Sheet-bound prospect send fence",()=>{
 it.each(["sheet_active","shadow_ready"] as const)("preserves the existing transport in %s",async phase=>{
  sender.mockClear();const a=authority(phase);
  await sendAuthoritativeProspectMessage(actor,runtime,"LS-LEAD-synthetic","synthetic message",{authority:a,sender});
  expect(a.read).toHaveBeenCalledWith(actor);expect(sender).toHaveBeenCalledOnce();
 });
 it.each(["frozen","native_active","retired","rollback_prepared"] as const)("does not send through Sheet in %s",async phase=>{
  sender.mockClear();const a=authority(phase);
  await expect(sendAuthoritativeProspectMessage(actor,runtime,"LS-LEAD-synthetic","synthetic message",{authority:a,sender}))
   .rejects.toMatchObject({code:"CONFLICT"});expect(sender).not.toHaveBeenCalled();
 });
 it("denies a non-practitioner before authority or transport",async()=>{
  sender.mockClear();const a=authority("sheet_active");
  await expect(sendAuthoritativeProspectMessage({...actor,role:"parent"},runtime,"LS-LEAD-synthetic","synthetic message",{authority:a,sender}))
   .rejects.toMatchObject({code:"FORBIDDEN"});expect(a.read).not.toHaveBeenCalled();expect(sender).not.toHaveBeenCalled();
 });
 it("does not issue a form token if the pre-issue check sees frozen authority",async()=>{
  const a=authority("frozen");await expect(assertLegacyProspectSenderAvailable(actor,runtime,a)).rejects.toMatchObject({code:"CONFLICT"});
 });
 it("rejects an intake token's stale authority epoch before transport",async()=>{
  sender.mockClear();const a=authority("sheet_active");
  await expect(sendAuthoritativeProspectMessage(actor,runtime,"LS-LEAD-synthetic","synthetic message",{authority:a,sender},2))
   .rejects.toMatchObject({code:"CONFLICT"});expect(sender).not.toHaveBeenCalled();
 });
 it("does not fall back to transport if the authority read fails",async()=>{
  sender.mockClear();const a=authority("sheet_active");a.read.mockRejectedValue(Error("synthetic authority unavailable"));
  await expect(sendAuthoritativeProspectMessage(actor,runtime,"LS-LEAD-synthetic","synthetic message",{authority:a,sender}))
   .rejects.toThrow("synthetic authority unavailable");expect(sender).not.toHaveBeenCalled();
 });
});

describe("post-effect legacy projection fence",()=>{
 it("keeps the provider receipt pending after an in-flight native switch",async()=>{
  const update=vi.fn();expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",{stage:"Contacted"},3,
   {authority:authority("native_active"),update})).toBe(true);expect(update).not.toHaveBeenCalled();
 });
 it("does not project after an epoch change even if Sheet became active again",async()=>{
  const update=vi.fn();expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",{stage:"Contacted"},2,
   {authority:authority("sheet_active"),update})).toBe(true);expect(update).not.toHaveBeenCalled();
 });
 it("retains current Sheet projection, but reports a real projection failure",async()=>{
  const update=vi.fn().mockResolvedValue(undefined),a=authority("sheet_active");
  expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",{stage:"Contacted"},3,{authority:a,update})).toBe(false);
  expect(update).toHaveBeenCalledOnce();update.mockRejectedValue(Error("synthetic Sheet unavailable"));
  expect(await projectLegacyProspectAfterSend(actor,runtime,"LS-LEAD-synthetic",{stage:"Contacted"},3,{authority:a,update})).toBe(true);
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
