import {describe,expect,it} from "vitest";
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {buildOwnerDigest,summarizeProspects,actionText} from "../../../src/features/owner-digest/model.ts";
import {ownerDigestEmail} from '../../../src/features/owner-digest/email.ts';
import {OwnerDigestSummary} from '../../../src/ui/revamp/owner-digest-summary.tsx';
import type {MarketingSnapshot,AdReporting,CreativeVersion,Publication} from "../../../src/features/marketing-overview/contracts.ts";
const now=new Date("2026-10-02T21:30:00Z"),today="2026-10-03";
const base={leadId:"LS-LEAD-a",stage:"Prospect",outcome:"",nextAction:"Owner action",dueDate:"10/3/2026",journeyState:"prospect",paymentVerified:false,bookingConfirmed:false};
const marketing:MarketingSnapshot={source:"registry_only",fetchedAt:null,creatives:[],publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:"unbound"}};
describe("bounded private aggregate projection",()=>{
 it.each(['he','en'] as const)('flags manual publication in %s without treating it as provider verified',locale=>{
  const creative={assetId:'DEMO-status',revision:1,review:'approved',contentDigest:'a'.repeat(64),approvedDigest:'a'.repeat(64)} as CreativeVersion;
  const item:Publication={id:'DEMO-publication',assetId:creative.assetId,creativeRevision:1,creativeDigest:creative.contentDigest,channel:'whatsapp_status',destinationLabel:'DEMO Status',scheduledFor:null,timezone:'Asia/Jerusalem',state:'manually_reported',provider:'whapi',providerReceiptId:null,providerReadAt:null,postUrl:null,receiptKind:'unknown',manualReportedAt:now.toISOString(),errorCode:null};
  const inventory={files:1,concepts:1,publishablePosts:0,heStatusReady:0,heFeedReady:0,enFeedReady:0,adEligible:0,inLiveAds:null,queued:0,published:0,needsApproval:0,needsResizeOrCaption:0,heldMissing:0,partial:false,asOf:now.toISOString()};
  const counts=summarizeProspects([],today,true),input={now,locale,marketing:{...marketing,creatives:[creative],publications:[item],inventory},followups:{data:counts,asOf:now.toISOString()},tasks:{data:{due:0,overdue:0,future:0},asOf:now.toISOString()},journeysAvailable:true};
  const manual=buildOwnerDigest(input);expect(manual.actions).toContain('publication_unconfirmed');expect(manual.content.confirmedPublished).toBe(0);
  const verified=buildOwnerDigest({...input,marketing:{...input.marketing,publications:[{...item,state:'published',receiptKind:'publication',providerReceiptId:'DEMO-receipt',providerReadAt:now.toISOString()}]}});
  expect(verified.actions).not.toContain('publication_unconfirmed');expect(verified.content.confirmedPublished).toBe(1);
  const unavailable=buildOwnerDigest({...input,followups:null,tasks:null,journeysAvailable:false,marketing:{...marketing,creatives:[creative],publications:[item]}});
  expect(unavailable.actions).toEqual(['crm_unavailable','tasks_unavailable','journeys_unavailable','content_unavailable','meta_unavailable','publication_unconfirmed']);
  const html=renderToStaticMarkup(React.createElement(OwnerDigestSummary,{digest:unavailable,locale})),email=ownerDigestEmail(unavailable,'https://life-skills.bneineviimacademy.org',locale);
  for(const code of unavailable.actions){expect(html).toContain(actionText[locale][code]);expect(email.text).toContain(actionText[locale][code]);expect(email.html).toContain(actionText[locale][code]);}
 });
 it.each(['opt out','opted-out','OPT_OUT','do_not_contact','Do-Not-Contact'])('excludes suppressed %s from every operational count without altering stored text',value=>{
  const rows=[{...base,leadId:'LS-LEAD-suppressed-stage',stage:value,journeyState:'awaiting_payment'},{...base,leadId:'LS-LEAD-suppressed-outcome',outcome:value,paymentVerified:true}];
  expect(summarizeProspects(rows,today,true)).toEqual({due:0,overdue:0,future:0,missingDate:0,invalidDate:0,prospects:0,otherStages:0,awaitingForm:0,awaitingPayment:0,awaitingBooking:0});
  expect(rows[0]!.stage).toBe(value);expect(rows[1]!.outcome).toBe(value);
 });
 it("keeps Prospect valid, preserves missing dates and trusts actual journey proof only",()=>{
  const rows=[base,{...base,leadId:"LS-LEAD-b",dueDate:"2026-10-02",stage:"constructor",journeyState:"awaiting_payment"},{...base,leadId:"LS-LEAD-c",dueDate:"",paymentVerified:true},{...base,leadId:"LS-LEAD-d",dueDate:"2/30/2026"},{...base,leadId:"LS-LEAD-e",stage:"Archived",dueDate:"2020-01-01"}];
  expect(summarizeProspects(rows,today,true)).toMatchObject({due:1,overdue:1,missingDate:1,invalidDate:1,prospects:4,otherStages:1,awaitingPayment:1,awaitingBooking:1});
  expect(summarizeProspects(rows,today,false)).toMatchObject({awaitingPayment:null,awaitingBooking:null});expect(rows[1]?.stage).toBe("constructor");
  expect(()=>summarizeProspects([base,base],today,true)).toThrow("INVALID_DIGEST_PROSPECTS");
 });
 it("never exports notes/identities, treats unavailable independently and enables no sender",()=>{
  const d=buildOwnerDigest({now,marketing,followups:null,tasks:{data:{due:0,overdue:0,future:1},asOf:now.toISOString()},journeysAvailable:false,locale:"he"});
  expect(d.reportDate).toBe(today);expect(d.followups).toBeNull();expect(d.tasks?.data.due).toBe(0);expect(d.content.heStatusReady).toBeNull();expect(d.ads.currency).toBeNull();expect(d.actions).toEqual(['crm_unavailable','journeys_unavailable','content_unavailable','meta_unavailable']);expect(d.delivery.enabled).toBe(false);
  expect(JSON.stringify(d)).not.toMatch(/notes|phone|clinical|emailCiphertext|token/);
 });
 it("compares exact complete account-local periods without inventing zeros or mixed currencies",()=>{
  const report:AdReporting={accountId:"act_101",currency:"ILS",timezone:"America/New_York",fetchedAt:now.toISOString(),attribution:"provider_default",previous:{since:"2026-09-18",until:"2026-09-24"},current:{since:"2026-09-25",until:"2026-10-01"},days:Array.from({length:14},(_,i)=>({date:new Date(Date.UTC(2026,8,18+i)).toISOString().slice(0,10),spendMinor:100,linkClicks:2,providerResults:i===0?null:1}))};
  const d=buildOwnerDigest({now,marketing:{...marketing,adReporting:report},followups:null,tasks:null,journeysAvailable:false,locale:"en"});
  expect(d.ads.periods).toEqual([{name:"yesterday",since:"2026-10-01",until:"2026-10-01",spendMinor:100,linkClicks:2,providerResults:1},{name:"last_seven",since:"2026-09-25",until:"2026-10-01",spendMinor:700,linkClicks:14,providerResults:7},{name:"preceding_seven",since:"2026-09-18",until:"2026-09-24",spendMinor:700,linkClicks:14,providerResults:null}]);
  expect(d.ads.currency).toBe("ILS");expect(d.ads.timezone).toBe("America/New_York");expect(d.ads.days).toHaveLength(7);
 });
});
