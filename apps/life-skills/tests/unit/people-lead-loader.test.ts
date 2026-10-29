import {expect,it} from "vitest";
import {loadLeadSource,LeadReadError,type LeadRead} from "../../src/features/people/lead-loader.ts";

it("reads Fishing follow-up before presenting a row and preserves the source cursor",async()=>{
 const paths:string[]=[];
 const read=(async(path:string)=>{paths.push(path);if(path==="/api/private/group-applications/followups/batch?cursor=opaque")return {items:[{application:{id:"one",receivedAt:"2026-10-28T12:00:00Z",fields:{programId:"sunday_fishing_academy",parentName:"Synthetic parent"}},attribution:null,followup:{status:"waiting",nextAction:null,dueDate:null,waitingCondition:"Await reply"}}],nextCursor:"older"};
  throw Error("unexpected");}) as LeadRead;
 const page=await loadLeadSource("fishing","owner","opaque",read);
 expect(paths).toEqual(["/api/private/group-applications/followups/batch?cursor=opaque"]);
 expect(page.nextCursor).toBe("older");expect(page.rows[0]).toMatchObject({label:"Synthetic parent",status:"waiting",waitingCondition:"Await reply"});
});
it("does not return a Fishing page containing an out-of-scope program",async()=>{
 const mismatch=(async()=>({items:[{application:{id:"one",fields:{programId:"morning_torah_learning",parentName:"Synthetic"}},followup:{}}],nextCursor:null})) as LeadRead;
 await expect(loadLeadSource("fishing","owner",null,mismatch)).rejects.toBeInstanceOf(LeadReadError);
 const denied=(async()=>{throw new LeadReadError(403);}) as LeadRead;
 await expect(loadLeadSource("fishing","owner",null,denied)).rejects.toMatchObject({status:403});
});
