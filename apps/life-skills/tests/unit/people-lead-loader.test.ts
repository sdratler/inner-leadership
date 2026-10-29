import {expect,it} from "vitest";
import {loadLeadSource,LeadReadError,type LeadRead} from "../../src/features/people/lead-loader.ts";

it("reads Fishing follow-up before presenting a row and preserves the source cursor",async()=>{
 const paths:string[]=[];
 const read=(async(path:string)=>{paths.push(path);if(path==="/api/private/group-applications?cursor=opaque")return {items:[{id:"one"}],nextCursor:"older"};
  if(path==="/api/private/group-applications/followups?id=one")return {application:{id:"one",receivedAt:"2026-10-28T12:00:00Z",fields:{programId:"sunday_fishing_academy",parentName:"Synthetic parent"}},attribution:null,followup:{status:"waiting",nextAction:null,dueDate:null,waitingCondition:"Await reply"}};
  throw Error("unexpected");}) as LeadRead;
 const page=await loadLeadSource("fishing","owner","opaque",read);
 expect(paths).toEqual(["/api/private/group-applications?cursor=opaque","/api/private/group-applications/followups?id=one"]);
 expect(page.nextCursor).toBe("older");expect(page.rows[0]).toMatchObject({label:"Synthetic parent",status:"waiting",waitingCondition:"Await reply"});
});
it("does not return an incomplete or incorrectly bound Fishing page",async()=>{
 const mismatch=(async(path:string)=>path.includes("followups")?{application:{id:"other",fields:{programId:"sunday_fishing_academy",parentName:"Synthetic"}},followup:{}}:{items:[{id:"one"}],nextCursor:null}) as LeadRead;
 await expect(loadLeadSource("fishing","owner",null,mismatch)).rejects.toBeInstanceOf(LeadReadError);
 const denied=(async(path:string)=>{if(path.includes("followups"))throw new LeadReadError(403);return {items:[{id:"one"}],nextCursor:null};}) as LeadRead;
 await expect(loadLeadSource("fishing","owner",null,denied)).rejects.toMatchObject({status:403});
});
