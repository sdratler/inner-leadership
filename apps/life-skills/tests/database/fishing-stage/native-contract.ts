/** Executable suite factory for MAIN's FUTURE authorized native harness.
 * Deliberately not auto-discovered: no fixture/database/schema execution is
 * authorized for this helper. Import and invoke only after MAIN admits a fresh
 * ls_calendar_test_rm_stage_<unique>_test target and its native adapter. */
import {describe,it,expect} from "vitest";
import type {Actor,FishingStageRef,StageCommand} from "../../../src/features/fishing-stage/contract.ts";
import type {FishingStageService} from "../../../src/features/fishing-stage/service.ts";

export interface NativeStageHarness {
 service():FishingStageService;
 instructor:Actor;parent:Actor;child:Actor;otherParent:Actor;ref:FishingStageRef;
 create:Extract<StageCommand,{action:"create"}>;
 publish:Extract<StageCommand,{action:"publish"}>;
 /** Separate native read/connection, not state cached by the service. */
 counts():Promise<{canonicalOccurrences:number;revisions:number;operations:number;clinicalCasesCreated:number;paymentsCreated:number}>;
 revokeParent():Promise<void>;
 close():Promise<void>;
}
export function defineNativeFishingStageTests(open:()=>Promise<NativeStageHarness>){
 describe("MAIN-admitted native fishing stage",()=>{
  it("persists one twelve-item stage, reopens through a new service and deduplicates the operation",async()=>{
   const h=await open();try{const a=await h.service().execute(h.instructor,h.ref,h.create),b=await h.service().execute(h.instructor,h.ref,h.create);
    expect(b).toEqual({...a,replayed:true});expect(await h.counts()).toMatchObject({canonicalOccurrences:12,operations:1,clinicalCasesCreated:0,paymentsCreated:0});
    await h.service().execute(h.instructor,h.ref,h.publish);expect((await h.service().read(h.parent,h.ref))!.occurrences).toHaveLength(12);
   }finally{await h.close();}
  });
  it("reloads guardian authority on every native transaction and hides another household",async()=>{
   const h=await open();try{await h.service().execute(h.instructor,h.ref,h.create);await h.service().execute(h.instructor,h.ref,h.publish);
    expect(await h.service().read(h.otherParent,h.ref)).toBeNull();expect(await h.service().read(h.parent,h.ref)).not.toBeNull();await h.revokeParent();expect(await h.service().read(h.parent,h.ref)).toBeNull();
   }finally{await h.close();}
  });
  it("uses native unique constraints/CAS for concurrent same-operation creation",async()=>{
   const h=await open();try{const result=await Promise.allSettled([h.service().execute(h.instructor,h.ref,h.create),h.service().execute(h.instructor,h.ref,h.create)]);
    expect(result.some(r=>r.status==="fulfilled")).toBe(true);expect(await h.counts()).toMatchObject({canonicalOccurrences:12,operations:1,clinicalCasesCreated:0,paymentsCreated:0});
   }finally{await h.close();}
  });
 });
}
