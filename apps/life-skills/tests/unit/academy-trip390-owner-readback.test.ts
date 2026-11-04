import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {afterEach,describe,expect,it,vi} from "vitest";
import type {Actor} from "../../src/features/identity/types.ts";
import {AppError} from "../../src/lib/errors.ts";
import {floridaGroupApplicationNotice,type GroupApplicationRecord} from "../../src/features/group-application/contract.ts";
import type {Trip390Interest} from "../../src/features/group-application/academy-trip390-contract.ts";
import {TRIP390_V1_INTEREST_VERSION,TRIP390_V1_NOTICE_VERSION,TRIP390_V1_OFFER} from "../../src/features/group-application/academy-trip390-v1.ts";
import {AcademyTrip390Readback} from "../../src/features/group-application/academy-trip390-readback.tsx";
import {emptyAcademyInquiryFilters,matchesAcademyInquiryFilters} from "../../src/features/group-application/academy-inquiry-filters.ts";
import {groupApplicationReviewHttp} from "../../src/features/group-application/review-http.ts";
import {requestGroupApplications,GroupApplicationReviewWorkspace} from "../../src/features/group-application/review-workspace.tsx";
vi.mock("server-only",()=>({}));

const origin="https://synthetic.example.invalid",path="/api/private/group-applications",ref="11111111-1111-4111-8111-111111111111";
const firstChild="22222222-2222-4222-8222-222222222222",secondChild="33333333-3333-4333-8333-333333333333";
const fields:Trip390Interest={version:TRIP390_V1_INTEREST_VERSION,offerVersion:TRIP390_V1_OFFER.version,guardianName:"Synthetic Guardian",email:"synthetic@example.invalid",city:"Custom <area>",postalCode:"01234-5678",messageLanguage:"he",instructionLanguage:"en",children:[{id:firstChild,name:"Synthetic Older",ageYears:14,experience:"some"},{id:secondChild,name:"Synthetic Younger",ageYears:9,experience:"new"}],notes:"<test note>",acknowledgment:{version:TRIP390_V1_NOTICE_VERSION,language:"en",conductExplained:true,interestPrivacySafety:true,whatsapp:false}};
const item:GroupApplicationRecord={id:ref,source:"public_group_application",state:"owner_review",receivedAt:"2026-11-02T12:00:00Z",fields};
const actor={role:"practitioner",workspaceId:"44444444-4444-4444-8444-444444444444"} as Actor;
const request=(query:string,signedIn=true)=>new Request(origin+path+query,{headers:{host:"synthetic.example.invalid","x-forwarded-host":"synthetic.example.invalid","x-forwarded-proto":"https",...(signedIn?{cookie:"__Host-ls-session="+"s".repeat(43)}:{})}});
function deps(){return {origin,actor:vi.fn(async()=>actor),store:{readForOwner:vi.fn(async()=>item),listPage:vi.fn(async()=>({items:[item],nextCursor:null})),list:vi.fn(async()=>[item])},emailSetup:vi.fn()};}
afterEach(()=>vi.unstubAllGlobals());
describe("ordinary owner Trip390 interest review",()=>{
 it("opens the exact reference via the private owner store without scanning a page or inspecting outbound setup",async()=>{
  const d=deps(),response=await groupApplicationReviewHttp(request("?reference="+ref),async()=>d);
  expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect((await response.json()).data).toEqual({items:[item],nextCursor:null,emailSetup:null});
  expect(d.store.readForOwner).toHaveBeenCalledWith(actor,ref);expect(d.store.listPage).not.toHaveBeenCalled();expect(d.emailSetup).not.toHaveBeenCalled();
 });
 it("keeps ordinary typed search paginated and returns the entire matched versioned submission",async()=>{
  const d=deps(),r=await groupApplicationReviewHttp(request("?search=01234"),async()=>d);
  expect(r.status).toBe(200);expect((await r.json()).data.items).toEqual([item]);expect(d.store.listPage).toHaveBeenCalledWith(actor,{search:"01234"});expect(d.store.readForOwner).not.toHaveBeenCalled();
 });
 it("preserves existing inquiry setup for historical Academy records after an authorized exact lookup",async()=>{
  const d=deps(),legacy:GroupApplicationRecord={...item,fields:{parentName:"Historical synthetic",contact:"prior@example.invalid",language:"en",cityArea:"Synthetic",programId:"sunday_fishing_academy",schedulePreference:["flexible"],permission:{confirmed:true,version:floridaGroupApplicationNotice.version,language:"en"}}};
  d.store.readForOwner.mockResolvedValueOnce(legacy);
  const r=await groupApplicationReviewHttp(request("?reference="+ref),async()=>d);
  expect(r.status).toBe(200);expect((await r.json()).data.items).toEqual([legacy]);expect(d.emailSetup).toHaveBeenCalledOnce();expect(d.store.listPage).not.toHaveBeenCalled();
 });
 it("uses the private exact URL only for a reference selection, and the authenticated page does not mount founder actions for that view",async()=>{
  const fetcher=vi.fn(async()=>new Response(JSON.stringify({ok:true,data:{items:[item]}})));vi.stubGlobal("fetch",fetcher);
  await requestGroupApplications(ref,null,true);await requestGroupApplications(ref,null);
  const options={credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"};
  expect(fetcher.mock.calls).toEqual([[path+"?reference="+ref,options],[path+"?search="+ref,options]]);
  const html=renderToStaticMarkup(createElement(GroupApplicationReviewWorkspace,{locale:"en",initialSearch:ref}));
  expect(html).toContain(ref);expect(html).not.toMatch(/founding.family|reservations|data-inquiry-email-setup/i);
 });
 it.each(["?reference=","?reference=bad","?reference="+ref+"&reference="+ref,"?reference="+ref+"&search=other","?reference="+ref+"&cursor="+"a".repeat(180)])("rejects ambiguous lookup %s before reading privately",async query=>{
  const d=deps(),r=await groupApplicationReviewHttp(request(query),async()=>d);expect(r.status).toBe(400);expect(d.actor).not.toHaveBeenCalled();expect(d.store.readForOwner).not.toHaveBeenCalled();
 });
 it("requires an owner session and preserves the fresh store's role/workspace and program denials",async()=>{
  const d=deps();expect((await groupApplicationReviewHttp(request("?reference="+ref,false),async()=>d)).status).toBe(401);
  d.actor.mockResolvedValueOnce({...actor,role:"parent"});expect((await groupApplicationReviewHttp(request("?reference="+ref),async()=>d)).status).toBe(403);expect(d.store.readForOwner).not.toHaveBeenCalled();
  for(const [code,status] of [["FORBIDDEN",403],["NOT_FOUND",404]] as const){d.store.readForOwner.mockRejectedValueOnce(new AppError(code));const r=await groupApplicationReviewHttp(request("?reference="+ref),async()=>d);expect(r.status).toBe(status);expect(await r.text()).not.toContain(fields.guardianName);}
 });
 it("rejects a wrong ID, invalid trip or different program before serializing any record",async()=>{
  for(const record of [{...item,id:secondChild},{...item,fields:{...fields,offerVersion:"unverified"}},{...item,fields:{programId:"morning_torah_learning",parentName:fields.guardianName}}]){
   const d=deps();d.store.readForOwner.mockResolvedValueOnce(record as GroupApplicationRecord);
   const r=await groupApplicationReviewHttp(request("?reference="+ref),async()=>d);expect(r.status).toBe(503);expect(await r.text()).not.toContain(fields.guardianName);expect(d.emailSetup).not.toHaveBeenCalled();
  }
 });
 it.each(["en","he"] as const)("renders all saved siblings, distinct language choices and consent evidence in %s without mutation controls",locale=>{
  const html=renderToStaticMarkup(createElement(AcademyTrip390Readback,{fields,reference:ref,receivedAt:item.receivedAt,locale}));
  for(const detail of [ref,firstChild,secondChild,"Synthetic Older","Synthetic Younger","01234-5678","Custom &lt;area&gt;","&lt;test note&gt;",fields.offerVersion,fields.version,fields.acknowledgment.version])expect(html).toContain(detail);
  for(const [label,value] of locale==="en"?[["Parent message language","Hebrew"],["Preferred instruction language","English"],["Acknowledgment language","English"],["WhatsApp permission","No"]]:[["שפת ההודעות להורה","עברית"],["שפת הדרכה מועדפת","אנגלית"],["שפת האישור","אנגלית"],["הסכמה להודעות WhatsApp","לא"]])expect(html).toContain("<dt>"+label+"</dt><dd>"+value+"</dd>");
  expect(html).not.toMatch(/<(button|input|form|a)\b/);
  expect(html).toContain(locale==="he"?"פנייה שמורה לטיול לקיז":"Saved Keys trip inquiry");
  expect(html).not.toMatch(/awaiting owner review|ממתינה לבדיקת המנהל/);
  expect(html).toContain("<details><summary>");
 });
 it("filters siblings and actual instruction language while leaving absent historical preferences unknown",()=>{
  const matches=(f:Partial<typeof emptyAcademyInquiryFilters>,record=item)=>matchesAcademyInquiryFilters(record,{...emptyAcademyInquiryFilters,...f});
  expect(matches({})).toBe(true);expect(matches({ageYears:"9",groupLanguage:"en"})).toBe(true);expect(matches({ageYears:"12"})).toBe(false);expect(matches({groupLanguage:"he"})).toBe(false);
  expect(matches({stageInterest:"foundation"})).toBe(false);expect(matches({day:"sunday"})).toBe(false);expect(matches({tripMinutes:"15"})).toBe(false);
  expect(matches({groupLanguage:"en"},{...item,fields:{...fields,instructionLanguage:undefined}})).toBe(false);
 });
});
