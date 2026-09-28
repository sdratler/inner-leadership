import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {authoritativeProspects} from "../../../src/features/contact-ops/server/authoritative-prospects.ts";
import type {Actor} from "../../../src/features/identity/types.ts";
import type {CutoverState,Phase} from "../../../src/features/contact-ops/core/cutover.ts";
const actor={role:"practitioner"} as Actor;
function deps(phase:Phase){const state:CutoverState={phase,epoch:3,batchId:"synthetic",sourceFileId:"synthetic",sourceRevision:"synthetic",nativeWritesSinceSwitch:0};
 return {authority:{read:vi.fn().mockResolvedValue(state)},native:{prospects:vi.fn().mockResolvedValue([])},sheet:{list:vi.fn().mockResolvedValue([])}};}
describe("one authoritative operational prospect read",()=>{
 it.each(["sheet_active","shadow_ready"] as const)("preserves the genuine Sheet reader in %s",async phase=>{
  const d=deps(phase);expect(await authoritativeProspects(actor,d)).toEqual([]);expect(d.sheet.list).toHaveBeenCalledOnce();expect(d.native.prospects).not.toHaveBeenCalled();
 });
 it.each(["native_active","retired"] as const)("uses only the epoch-fenced native read in %s",async phase=>{
  const d=deps(phase);expect(await authoritativeProspects(actor,d)).toEqual([]);expect(d.native.prospects).toHaveBeenCalledWith(actor,3);expect(d.sheet.list).not.toHaveBeenCalled();
 });
 it.each(["frozen","rollback_prepared"] as const)("rejects %s without either fallback",async phase=>{
  const d=deps(phase);await expect(authoritativeProspects(actor,d)).rejects.toMatchObject({code:"CONFLICT"});expect(d.sheet.list).not.toHaveBeenCalled();expect(d.native.prospects).not.toHaveBeenCalled();
 });
 it("never falls back to Sheet on a failed native read or stale epoch",async()=>{
  const d=deps("native_active");d.native.prospects.mockRejectedValue(Error("Synthetic native unavailable"));await expect(authoritativeProspects(actor,d)).rejects.toThrow("Synthetic native unavailable");expect(d.sheet.list).not.toHaveBeenCalled();
 });
 it("denies other roles before any authority or provider read",async()=>{
  for(const role of ["parent","child","adult_client"] as const){const d=deps("sheet_active");await expect(authoritativeProspects({...actor,role},d)).rejects.toMatchObject({code:"FORBIDDEN"});expect(d.authority.read).not.toHaveBeenCalled();expect(d.sheet.list).not.toHaveBeenCalled();}
 });
 it("preserves failed authority as a failure, never an empty successful directory",async()=>{
  const d=deps("sheet_active");d.authority.read.mockRejectedValue(Error("Synthetic authority unavailable"));await expect(authoritativeProspects(actor,d)).rejects.toThrow("Synthetic authority unavailable");expect(d.sheet.list).not.toHaveBeenCalled();expect(d.native.prospects).not.toHaveBeenCalled();
 });
});
