import {describe,expect,it} from "vitest";
import {buildOwnerDigest,summarizeProspects} from "../../../src/features/owner-digest/model.ts";
import type {MarketingSnapshot,AdReporting} from "../../../src/features/marketing-overview/contracts.ts";
const now=new Date("2026-10-02T21:30:00Z"),today="2026-10-03";
const base={leadId:"LS-LEAD-a",stage:"Prospect",outcome:"",nextAction:"Owner action",dueDate:"10/3/2026",journeyState:"prospect",paymentVerified:false,bookingConfirmed:false};
const marketing:MarketingSnapshot={source:"registry_only",fetchedAt:null,creatives:[],publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:"unbound"}};
describe("bounded private aggregate projection",()=>{
 it("keeps Prospect valid, preserves missing dates and trusts actual journey proof only",()=>{
  const rows=[base,{...base,leadId:"LS-LEAD-b",dueDate:"2026-10-02",stage:"constructor",journeyState:"awaiting_payment"},{...base,leadId:"LS-LEAD-c",dueDate:"",paymentVerified:true},{...base,leadId:"LS-LEAD-d",dueDate:"2/30/2026"},{...base,leadId:"LS-LEAD-e",stage:"Archived",dueDate:"2020-01-01"}];
  expect(summarizeProspects(rows,today,true)).toMatchObject({due:1,overdue:1,missingDate:1,invalidDate:1,prospects:4,otherStages:1,awaitingPayment:1,awaitingBooking:1});
  expect(summarizeProspects(rows,today,false)).toMatchObject({awaitingPayment:null,awaitingBooking:null});expect(rows[1]?.stage).toBe("constructor");
  expect(()=>summarizeProspects([base,base],today,true)).toThrow("INVALID_DIGEST_PROSPECTS");
 });
 it("never exports notes/identities, treats unavailable independently and enables no sender",()=>{
  const d=buildOwnerDigest({now,marketing,followups:null,tasks:{data:{due:0,overdue:0,future:1},asOf:now.toISOString()},journeysAvailable:false,locale:"he"});
  expect(d.reportDate).toBe(today);expect(d.followups).toBeNull();expect(d.tasks?.data.due).toBe(0);expect(d.content.heStatusReady).toBeNull();expect(d.ads.currency).toBeNull();expect(d.actions).toHaveLength(3);expect(d.delivery.enabled).toBe(false);
  expect(JSON.stringify(d)).not.toMatch(/notes|phone|clinical|emailCiphertext|token/);
 });
 it("compares exact complete account-local periods without inventing zeros or mixed currencies",()=>{
  const report:AdReporting={accountId:"act_101",currency:"ILS",timezone:"America/New_York",fetchedAt:now.toISOString(),attribution:"provider_default",previous:{since:"2026-09-18",until:"2026-09-24"},current:{since:"2026-09-25",until:"2026-10-01"},days:Array.from({length:14},(_,i)=>({date:new Date(Date.UTC(2026,8,18+i)).toISOString().slice(0,10),spendMinor:100,linkClicks:2,providerResults:i===0?null:1}))};
  const d=buildOwnerDigest({now,marketing:{...marketing,adReporting:report},followups:null,tasks:null,journeysAvailable:false,locale:"en"});
  expect(d.ads.periods).toEqual([{name:"yesterday",since:"2026-10-01",until:"2026-10-01",spendMinor:100,linkClicks:2,providerResults:1},{name:"last_seven",since:"2026-09-25",until:"2026-10-01",spendMinor:700,linkClicks:14,providerResults:7},{name:"preceding_seven",since:"2026-09-18",until:"2026-09-24",spendMinor:700,linkClicks:14,providerResults:null}]);
  expect(d.ads.currency).toBe("ILS");expect(d.ads.timezone).toBe("America/New_York");expect(d.ads.days).toHaveLength(7);
 });
});
