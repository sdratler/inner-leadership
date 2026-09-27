import {readFileSync} from "node:fs";
import {describe,expect,it,vi} from "vitest";
import {visibleClientCases,workflowDestination} from "../../src/features/prospects/client.tsx";
import {activeProspect,paidAwaitingBooking} from "../../src/features/prospects/view-state.ts";
import {sendProspectMessage} from "../../src/features/prospects/bridge.ts";
import type {IdentityStore} from "../../src/features/identity/store.ts";
vi.mock("server-only",()=>({}));
const read=(path:string)=>readFileSync(new URL(`../../src/${path}`,import.meta.url),"utf8");
describe("live intake follow-up contract",()=>{
 it("does not mistake a lead's linked child case for that same person",()=>{
  const minor={id:"case-a",kind:"minor" as const,state:"active",displayName:"Synthetic Child Case"},adult={id:"case-b",kind:"adult" as const,state:"active",displayName:"Synthetic Adult Case"},cases=[minor,adult];
  expect(visibleClientCases(cases,[{caseId:"case-a"},{caseId:"case-b"}],"")).toEqual([minor]);
  expect(visibleClientCases(cases,[],"")).toEqual(cases);
  expect(visibleClientCases(cases,[{caseId:"case-b"}],"child")).toEqual([minor]);
  expect(visibleClientCases(cases,[],"unrelated")).toEqual([]);
 });
 it("exposes exact intake queues in the single toolbar with canonical Back/deep links",()=>{
  expect(workflowDestination("en","new")).toBe("/en/app/clients?section=prospects&filter=new");
  expect(workflowDestination("he","payment")).toBe("/he/app/clients?section=prospects&filter=payment");
  expect(workflowDestination("en","booking")).toBe("/en/app/clients?section=paid");
  const ui=read("features/prospects/client.tsx");
  for(const value of ["today","new","intake","payment","booking"])expect(ui).toContain(`<option value="${value}">`);
 });
 it("keeps provider access server-side and practitioner-only",()=>{const route=read("app/api/prospects/route.ts"),bridge=read("features/prospects/bridge.ts");expect(route).toContain('actor.role!=="practitioner"');expect(route).toContain("verifyCsrfToken");expect(bridge).toContain('import "server-only"');expect(bridge).toContain("LIFE_SKILLS_APP_BRIDGE_SECRET");});
 it("uses the approved editable first-contact and intake copy and cleanly omits a missing name",()=>{const ui=read("features/prospects/client.tsx"),route=read("app/api/prospects/route.ts");expect(ui).toContain("this is Shlomo Dratler from Life Skills, following up on your inquiry. When is a convenient time for a brief call?");expect(ui).toContain("זה שלמה דרטלר. ניסיתי לחזור כפי שסיכמנו. מתי נוח לדבר?");expect(ui).toContain('name?`Hi ${name},`:`Hi,`');expect(route).toContain("After submitting it, you can continue to payment for the first session.");});
 it("requires a non-reversed database allocation and no confirmed appointment before a booking-link send",()=>{const route=read("app/api/prospects/route.ts"),journey=read("features/prospects/journey-read.ts"),ui=read("features/prospects/client.tsx");expect(route).toContain("readProspectJourneys");expect(journey).toContain("ls_onboarding.payment_allocations");expect(journey).toContain("ls_onboarding.payment_reversals");expect(journey).toContain("confirmed_appointment_id IS NOT NULL");expect(route).toContain("!paidAwaitingBooking(journey)");expect(route).not.toContain("input.paymentState");expect(ui).toContain("row.paymentVerified===true");expect(route).toContain("The appointment is booked once the time is confirmed.");});
 it("drives intake counts and filters from real journey facts",()=>{const ui=read("features/prospects/client.tsx"),summary=read("features/prospects/summary-card.tsx"),route=read("app/api/prospects/route.ts");expect(ui).toContain('preset==="payment"&&(!row.formSubmitted||row.paymentVerified)');expect(ui).toContain('preset==="booking"&&!paidAwaitingBooking(row)');expect(summary).toContain("row.formSubmitted&&!row.paymentVerified");expect(summary).toContain("open.filter(paidAwaitingBooking)");expect(route).toContain("bookingConfirmed:false");});
 it("never treats administrative booking text as confirmed appointment evidence",()=>{
  const noteOnly={journeyState:"payment_verified",paymentVerified:true,bookingConfirmed:false,bookingStatus:"Confirmed? Still awaiting calendar booking"};
  expect(activeProspect(noteOnly)).toBe(false);
  expect(paidAwaitingBooking(noteOnly)).toBe(true);
  expect(paidAwaitingBooking({...noteOnly,bookingConfirmed:true})).toBe(false);
  expect(paidAwaitingBooking({...noteOnly,journeyState:"active"})).toBe(false);
  expect(paidAwaitingBooking({...noteOnly,paymentVerified:false})).toBe(false);
 });
 it("keeps manual add separate from all sends",()=>{const route=read("app/api/prospects/route.ts");const add=route.slice(route.indexOf('if(input.action==="add")'),route.indexOf('if(input.action==="update")'));expect(add).toContain("createProspect");expect(add).not.toContain("sendProspectMessage");});
 it("does not expose import or history-scan actions",()=>{const route=read("app/api/prospects/route.ts");expect(route).not.toMatch(/history.scan|backfill|bulk.import/i);});
 it("rejects a marked demo prospect at the final WhatsApp bridge without calling the provider",async()=>{
  const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
  const store:IdentityStore={transaction:async work=>work({query:async<T extends object>()=>[{batchId:"test-batch"}] as unknown as T[]})};
  try{
   await expect(sendProspectMessage("LS-LEAD-demo","synthetic message",{store,workspaceId:"workspace"})).rejects.toMatchObject({code:"FORBIDDEN"});
   expect(fetchMock).not.toHaveBeenCalled();
  }finally{vi.unstubAllGlobals();}
 });
 it("fails closed before WhatsApp when provenance storage is unavailable",async()=>{
  const fetchMock=vi.fn();vi.stubGlobal("fetch",fetchMock);
  const store:IdentityStore={transaction:async()=>{throw new Error("database unavailable");}};
  try{
   await expect(sendProspectMessage("LS-LEAD-unknown","test message",{store,workspaceId:"workspace"})).rejects.toThrow("database unavailable");
   expect(fetchMock).not.toHaveBeenCalled();
  }finally{vi.unstubAllGlobals();}
 });
 it("permits the existing real-prospect bridge only after a fresh unmarked lookup",async()=>{
  const queries:unknown[][]=[];
  const store:IdentityStore={transaction:async work=>work({query:async(_sql,values)=>{queries.push([...values??[]]);return [];}})};
  const fetchMock=vi.fn().mockResolvedValue({ok:true,status:200,json:async()=>({success:true,receipt:{provider:"test",providerMessageId:"test-id",sentAt:"2026-09-26T00:00:00Z"}})});
  vi.stubGlobal("fetch",fetchMock);vi.stubEnv("LIFE_SKILLS_CRM_BRIDGE_ORIGIN","https://crm.test");vi.stubEnv("LIFE_SKILLS_APP_BRIDGE_SECRET","test-secret-32-characters-long-only");
  try{
   const result=await sendProspectMessage("LS-LEAD-real","test message",{store,workspaceId:"workspace"});
   expect(queries).toEqual([["workspace","prospect","LS-LEAD-real"]]);
   expect(fetchMock).toHaveBeenCalledOnce();
   expect(result.receipt.providerMessageId).toBe("test-id");
  }finally{vi.unstubAllGlobals();vi.unstubAllEnvs();}
 });
});
