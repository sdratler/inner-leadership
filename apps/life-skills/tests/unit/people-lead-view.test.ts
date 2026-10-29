import {expect,it} from "vitest";
import {bnaLeadRow,conversationLeadRow,fishingLeadRow,needsFollowup} from "../../src/features/people/lead-view.ts";

const followup={status:"waiting",nextAction:null,dueDate:null,waitingCondition:"Await reply",recordedAt:"2026-10-29T12:00:00.000Z"};
it("keeps BNA and Fishing inquiries separate and uses saved follow-up state",()=>{
 const bna=bnaLeadRow({id:"a",ownerAccountId:"owner",receivedAt:"2026-10-28T12:00:00.000Z",fields:{name:"Synthetic parent"},attribution:{source:"bna_site"},followup});
 const fishing=fishingLeadRow({application:{id:"a",receivedAt:"2026-10-28T12:00:00.000Z",fields:{programId:"sunday_fishing_academy",parentName:"Synthetic parent"}},attribution:null,followup},"owner");
 expect(bna.key).not.toBe(fishing.key);expect(bna.purposes).toEqual(["bna"]);expect(fishing.purposes).toEqual(["fishing"]);
 expect(fishing).toMatchObject({status:"waiting",waitingCondition:"Await reply",latestActivity:followup.recordedAt});
 expect(needsFollowup(bna)).toBe(true);expect(needsFollowup({...fishing,status:"closed"})).toBe(false);
 expect(()=>fishingLeadRow({application:{id:"b",receivedAt:"",fields:{programId:"morning_torah_learning",parentName:"Synthetic"}},attribution:null,followup},"owner")).toThrow();
});
it("preserves mixed and ambiguous 305 purposes without guessing a relationship",()=>{
 const item={id:"a",ownerAccountId:"owner",contactHint:"Synthetic caller",createdAt:"2026-10-28T12:00:00.000Z",followup:{classification:"both",recordedAt:"2026-10-29T12:00:00.000Z",nextAction:null,dueDate:null,waitingCondition:"Await reply"}};
 expect(conversationLeadRow(item).purposes).toEqual(["bna","fishing"]);
 const ambiguous=conversationLeadRow({...item,followup:{...item.followup,classification:"support_provider"}});
 expect(ambiguous.purposes).toEqual(["unclassified"]);expect(needsFollowup(ambiguous)).toBe(true);
 expect(conversationLeadRow({...item,followup:{...item.followup,classification:"provider"}}).purposes).toEqual(["provider"]);
});
