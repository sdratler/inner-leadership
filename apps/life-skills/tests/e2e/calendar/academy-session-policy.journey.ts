/** Authored helper, not registered in a runner and not executed under CAL1136.
 * Root must admit the exact browser/runtime recipe, mount the required authority
 * and declare the summary field path in the existing native plan response.
 * No response mocks, synthetic login cookies, DB discovery or app startup. */
import {expect,type Browser,type BrowserContext,type Page,type Request,type Response} from "@playwright/test";
import type {Locale} from "../../../src/lib/locale.ts";
import {fishingCalendarSearch,type FishingCalendarSelection} from "../../../src/features/fishing/program-calendar-contract.ts";
import {academySessionPolicyNativeVersion,type AcademySessionCreditRecord} from "../../../src/features/fishing/academy-session-policy-native-contract.ts";
import {academySessionCreditPublicVersion,academySessionCreditPublicSummarySchema,type AcademySessionCreditPublicSummary} from '../../../src/features/fishing/academy-session-credit-public-contract.ts';

export type AcademySessionPolicyJourneyInput=Readonly<{
 admission:"ROOT_REVIEWED_CAL1136_BROWSER_ONLY";fixture:"SYNTHETIC_CAL1136_ONLY";origin:string;href:string;locale:Locale;
 selection:FishingCalendarSelection;deniedSelection:FishingCalendarSelection;
 /** Exact Root-declared field path including "data"; no assumed HTTP extension. */
 summaryFieldPath:readonly string[];expectedCredit:AcademySessionCreditRecord;forbiddenContent:readonly string[];
}>;
export type AcademySessionPolicyJourneyPorts=Readonly<{
 browser:Browser;
 ordinaryParentLogin(page:Page,destination:string,locale:Locale):Promise<void>;
 /** Must run the admitted native service against the SAME disposable fixture.
  * No browser-supplied eligibility or fabricated successful API response. */
 advanceSyntheticAcademyChange():Promise<AcademySessionCreditRecord>;
 revokeSyntheticParentAccess():Promise<void>;
}>;
function loopbackOrigin(value:string):string{
 const url=new URL(value);
 if(!["http:","https:"].includes(url.protocol)||!["127.0.0.1","localhost"].includes(url.hostname)||!url.port||url.username||url.password||url.pathname!=="/"||url.search||url.hash)
  throw Error("CAL1136_EXACT_LOCAL_ORIGIN_REQUIRED");return url.origin;
}
function extract(body:unknown,path:readonly string[]):AcademySessionCreditPublicSummary{
 let value=body;
 for(const key of path){
  if(!value||typeof value!=="object"||Array.isArray(value)||!Object.hasOwn(value,key))throw Error("CAL1136_ROOT_SUMMARY_MOUNT_REQUIRED");
  value=(value as Record<string,unknown>)[key];
 }
 if(!value||typeof value!=="object"||Array.isArray(value))throw Error("CAL1136_ROOT_SUMMARY_MOUNT_REQUIRED");
 return academySessionCreditPublicSummarySchema.parse(value);
}
function pageRead(response:Response,page:Page,origin:string,selection:FishingCalendarSelection):boolean{
 const request=response.request(),url=new URL(response.url());
 return url.origin===origin&&url.pathname==="/api/calendar/fishing/plan"&&request.method()==="GET"&&request.resourceType()==="fetch"&&
  request.frame()===page.mainFrame()&&url.searchParams.get("enrollmentId")===selection.enrollmentId&&url.searchParams.get("learnerId")===selection.learnerId;
}

export async function runAcademySessionPolicyJourney(ports:AcademySessionPolicyJourneyPorts,input:AcademySessionPolicyJourneyInput){
 if(input.admission!=="ROOT_REVIEWED_CAL1136_BROWSER_ONLY"||input.fixture!=="SYNTHETIC_CAL1136_ONLY")throw Error("CAL1136_BROWSER_EXECUTION_NOT_ADMITTED");
 const origin=loopbackOrigin(input.origin),destination=new URL(input.href,origin),selection=structuredClone(input.selection),expected=structuredClone(input.expectedCredit);
 if(destination.origin!==origin||destination.username||destination.password||!selection.enrollmentId||!selection.learnerId||
  expected.enrollmentId!==selection.enrollmentId||expected.anchor.learnerId!==selection.learnerId||expected.state==="delivered"||
  !input.deniedSelection.enrollmentId||!input.deniedSelection.learnerId||input.deniedSelection.learnerId===selection.learnerId||
  input.summaryFieldPath.length<2||input.summaryFieldPath.length>6||input.summaryFieldPath[0]!=="data"||
  input.summaryFieldPath.some(key=>!/^[A-Za-z][A-Za-z0-9]*$/.test(key))||input.forbiddenContent.length===0||input.forbiddenContent.some(value=>!value))
  throw Error("CAL1136_EXACT_SELECTION_AND_ROOT_READBACK_BINDING_REQUIRED");
 const contexts:BrowserContext[]=[],writes:string[]=[];let selectedReadbacks=0,primaryError:unknown;
 const watch=(request:Request)=>{
  const url=new URL(request.url());if(url.origin===origin&&url.pathname.startsWith("/api/calendar/fishing/")&&!["GET","HEAD","OPTIONS"].includes(request.method()))writes.push(request.method()+" "+url.pathname);
 };
 async function fresh(){
  const context=await ports.browser.newContext({serviceWorkers:"block",viewport:{width:1280,height:900}});contexts.push(context);
  expect(await context.cookies()).toEqual([]);const page=await context.newPage();page.on("request",watch);return page;
 }
 async function assertRead(page:Page,response:Response){
  expect(response.status()).toBe(200);expect(response.fromServiceWorker()).toBe(false);expect(await response.finished()).toBeNull();
  const body:unknown=await response.json(),summary=extract(body,input.summaryFieldPath);
  expect(summary).toEqual({version:academySessionCreditPublicVersion,enrollmentId:selection.enrollmentId,learnerId:selection.learnerId,credits:[{id:expected.id,originalOccurrenceId:expected.anchor.occurrenceId,originalOrdinal:expected.anchor.ordinal,state:expected.state}]});
  const section=page.locator("[data-academy-session-credit-summary]");await expect(section).toHaveCount(1);await expect(section).toBeVisible();
  await expect(section).toHaveAttribute("lang",input.locale);await expect(section).toHaveAttribute("dir",input.locale==="he"?"rtl":"ltr");
  const item=section.locator("[data-academy-credit-id]");await expect(item).toHaveCount(1);await expect(item).toHaveAttribute("data-academy-credit-id",expected.id);
  await expect(item).toHaveAttribute("data-academy-credit-state",expected.state);
  await expect(item.getByRole("heading",{name:(input.locale==="he"?"המפגש המקורי":"Original session")+" "+expected.anchor.ordinal,exact:true})).toBeVisible();
  await expect(section).toContainText(input.locale==="he"?"אין הבטחה לתאריך מסוים או למקום במפגש.":"A particular date or seat is not guaranteed.");
  if(expected.state==="replacement_reserved")await expect(section).toContainText(input.locale==="he"?"המפגש טרם סופק.":"The session remains undelivered.");
  const html=await section.innerHTML(),text=await page.locator("body").innerText(),json=JSON.stringify(body);
  for(const secret of input.forbiddenContent){expect(html).not.toContain(secret);expect(text).not.toContain(secret);expect(json).not.toContain(secret);}
  for(const privateId of [expected.purchaseId,expected.purchaseLineId,expected.replacementReservationId,expected.anchor.workspaceId,expected.anchor.cohortId,expected.anchor.stageId,expected.anchor.moduleId,expected.anchor.moduleVersion,expected.anchor.activityId].filter((v):v is string=>v!==null)){expect(html).not.toContain(privateId);expect(JSON.stringify(summary)).not.toContain(privateId);}
  for(const privateField of ['purchaseId','purchaseLineId','replacementReservationId','anchor','householdId','guardianBindingId','inquiry','sourceEvidenceId','activityId'])expect(Object.hasOwn(summary,privateField)||summary.credits.some(c=>Object.hasOwn(c,privateField))).toBe(false);
  expect(writes).toEqual([]);selectedReadbacks++;
 }
 async function reload(page:Page){
  const observed=page.waitForResponse(response=>pageRead(response,page,origin,selection));void observed.catch(()=>undefined);
  await page.reload();await assertRead(page,await observed);
 }
 async function login(page:Page){
  const observed=page.waitForResponse(response=>pageRead(response,page,origin,selection));void observed.catch(()=>undefined);
  await ports.ordinaryParentLogin(page,destination.href,input.locale);await assertRead(page,await observed);
 }
 try{
  const first=await fresh();await login(first);await reload(first);
  // Root's admitted native change must return the same entire original record,
  // including reservation and nine-field anchor, before a new parent read.
  expect(await ports.advanceSyntheticAcademyChange()).toEqual(expected);await reload(first);
  const second=await fresh();await login(second);
  const denied=await second.request.get(origin+"/api/calendar/fishing/plan?"+fishingCalendarSearch(input.deniedSelection));
  expect([403,404]).toContain(denied.status());expect(await denied.text()).not.toContain(expected.id);
  await ports.revokeSyntheticParentAccess();
  const revoked=await second.request.get(origin+"/api/calendar/fishing/plan?"+fishingCalendarSearch(selection));
  expect([401,403,404]).toContain(revoked.status());expect(await revoked.text()).not.toContain(expected.id);
  await second.reload();await expect(second.locator("[data-academy-session-credit-summary]")).toHaveCount(0);expect(writes).toEqual([]);
  return {version:academySessionPolicyNativeVersion,creditId:expected.id,originalAnchor:expected.anchor,freshParentContexts:2,selectedReadbacks,
   repeatedChangeRetained:true,unrelatedDenied:true,revokedDenied:true,observedCalendarWrites:writes.length} as const;
 }catch(error){primaryError=error;throw error;}finally{
  const closed=await Promise.allSettled(contexts.map(context=>context.close()));
  const failures=closed.flatMap(result=>result.status==="rejected"?[result.reason]:[]);
  if(failures.length)throw new AggregateError(primaryError===undefined?failures:[primaryError,...failures],"CAL1136_BROWSER_CONTEXT_CLEANUP_FAILED");
 }
}
