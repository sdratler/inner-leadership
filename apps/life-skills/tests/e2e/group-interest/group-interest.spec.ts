/** Mounted authenticated synthetic browser acceptance. No request interception or API mocking. */
import {expect,test} from "@playwright/test";
import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {promisify} from "node:util";
type Runtime={origin:string;workspaceId:string;practitioner:string;parent:string};
const runtimePath=process.env.LS_GROUP_INTEREST_FIXTURE_PATH;
if(!runtimePath){
 if(process.env.LS_GROUP_INTEREST_TEST_RUNNER_ACTIVE==="true")throw new Error("ISOLATED_GROUP_INTEREST_FIXTURE_REQUIRED");
 test("isolated Group Intake authenticated journeys for the current browser project",async({},info)=>{
  const project=info.project.name==="mobile"?"mobile390":info.project.name;
  test.setTimeout(240_000);if(!["desktop","mobile390","mobile340"].includes(project))throw new Error("GROUP_INTEREST_BROWSER_PROJECT_NOT_SUPPORTED");
  const result=await promisify(execFile)(process.execPath,["--import","tsx","tests/e2e/group-interest/run.ts"],{timeout:210_000,maxBuffer:2*1024*1024,
   env:{...process.env,LS_GROUP_INTEREST_TEST_PROJECT:project,LS_GROUP_INTEREST_TEST_ALLOW:"true",LS_CALENDAR_TEST_ALLOW:"true"}});
  expect(result.stdout).toContain(`GROUP_INTEREST_ACCEPTANCE_PASS project=${project}`);console.log(result.stdout);
 });
}else{
 const data=JSON.parse(readFileSync(runtimePath,"utf8")) as Runtime;
 if(!["https://localhost:3105","https://localhost:3106","https://localhost:3107"].includes(data.origin))throw new Error("GROUP_INTEREST_BROWSER_ORIGIN_NOT_ISOLATED");
 const selected=process.env.LS_GROUP_INTEREST_TEST_PROJECT;
 const ports:Record<string,number>={desktop:3105,mobile390:3106,mobile340:3107};if(selected!==undefined&&data.origin!==`https://localhost:${ports[selected]}`)throw new Error("GROUP_INTEREST_BROWSER_PROJECT_ORIGIN_MISMATCH");
 test.use({baseURL:data.origin});
 for(const locale of ["en","he"] as const)test(`practitioner ${locale}: save, exact replay, rejection, reload and responsive readback`,async({page,context},info)=>{
  await context.addCookies([{name:"__Host-ls-session",value:data.practitioner,url:data.origin,httpOnly:true,secure:true,sameSite:"Lax"}]);
  const initialRead=page.waitForResponse(response=>response.request().method()==="GET"&&new URL(response.url()).pathname==="/api/private/group-interest");
  const response=await page.goto(`/${locale}/app/group-interest`);expect(response?.status()).toBe(200);expect((await initialRead).status()).toBe(200);
  const main=page.locator("main");await expect(main).toHaveAttribute("dir",locale==="he"?"rtl":"ltr");
  await expect(page.getByRole("heading",{name:locale==="he"?"התעניינות בקבוצה ובתגבור":"Group and tutoring interest",exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const skip=page.locator(".lsu-skip"),skipState=async()=>skip.evaluate(element=>{const rect=element.getBoundingClientRect();return {active:document.activeElement===element,top:rect.top,bottom:rect.bottom,scrollY,intersects:rect.bottom>0&&rect.top<innerHeight};});
  const resting=await skipState();expect(resting.active).toBe(false);expect(resting.intersects).toBe(false);expect(resting.bottom).toBeLessThanOrEqual(0);
  await page.keyboard.press("Tab");await expect(skip).toBeFocused();const focused=await skipState();expect(focused.intersects).toBe(true);expect(focused.top).toBeGreaterThanOrEqual(0);await page.screenshot({path:info.outputPath(`group-interest-skip-focused-${locale}-${info.project.name}.png`)});
  await page.keyboard.press("Enter");await expect(page.locator("#lsw-main")).toBeFocused();
  const inquiryForm=page.locator("form").first(),suffix=`${info.project.name}-${locale}`,parentName=`Synthetic ${suffix} Parent`,childLabel=`Synthetic ${suffix} Child`;
  await inquiryForm.locator('[name="serviceType"]').selectOption(locale==="he"?"group":"group_and_tutoring");
  await inquiryForm.locator('[name="parentName"]').fill(parentName);await inquiryForm.locator('[name="parentPhone"]').fill(locale==="he"?"+972500001111":"+15550001111");
  await inquiryForm.locator('[name="language"]').selectOption(locale);await inquiryForm.locator('[name="childLabel"]').fill(childLabel);await inquiryForm.locator('[name="childAge"]').fill(locale==="he"?"9":"11");
  await inquiryForm.locator('[name="area"]').fill(locale==="he"?"אזור בדיקה סינתטי":"Synthetic test area");await inquiryForm.locator('[name="availability"]').fill(locale==="he"?"יום ראשון אחר הצהריים":"Sunday afternoon");
  await inquiryForm.locator('[name="groupPreference"]').fill(locale==="he"?"קבוצה קטנה":"Small group");await inquiryForm.locator('[name="permissionSource"]').selectOption("spoken");
  await inquiryForm.locator('[name="permissionLanguage"]').selectOption(locale);await expect(inquiryForm.locator('[name="permission"]')).toBeEnabled();await inquiryForm.locator('[name="permission"]').check();
  const postRequest=page.waitForRequest(request=>request.method()==="POST"&&new URL(request.url()).pathname==="/api/private/group-interest");
  const postResponse=page.waitForResponse(response=>response.request().method()==="POST"&&new URL(response.url()).pathname==="/api/private/group-interest");
  await inquiryForm.getByRole("button",{name:locale==="he"?"שמירת התעניינות":"Save interest",exact:true}).click();
  const sent=await postRequest,saved=await postResponse;expect(saved.status()).toBe(200);const savedBody=await saved.json();expect(savedBody).toMatchObject({ok:true,data:{saved:true,replayed:false,item:{fields:{parentName,childLabel}}}});
  await expect(page.getByRole("status")).toHaveText(locale==="he"?"הפנייה נשמרה ונקראה בחזרה ממסד הנתונים של האפליקציה.":"Inquiry saved and read back from the app database.");
  await expect(page.getByRole("heading",{name:`${parentName} — ${childLabel}`,exact:true})).toHaveCount(1);
  const phoneToken=page.locator("article").filter({hasText:parentName}).locator("bdi");await expect(phoneToken).toHaveText(locale==="he"?"+972500001111":"+15550001111");await expect(phoneToken).toHaveAttribute("dir","ltr");expect(await phoneToken.evaluate(element=>({direction:getComputedStyle(element).direction,bidi:getComputedStyle(element).unicodeBidi}))).toEqual({direction:"ltr",bidi:"isolate"});
  const body=sent.postDataJSON(),csrf=sent.headers()["x-csrf-token"];expect(csrf).toBeTruthy();
  const replay=await page.request.post(`${data.origin}/api/private/group-interest`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:body});
  expect(replay.status()).toBe(200);expect(await replay.json()).toMatchObject({ok:true,data:{saved:true,replayed:true,duplicate:true,item:{id:savedBody.data.item.id}}});
  const stale=structuredClone(body);stale.operationId=randomUUID();stale.fields.parentName=`Stale ${parentName}`;stale.fields.permission.version="stale-version";
  const rejected=await page.request.post(`${data.origin}/api/private/group-interest`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:stale});expect(rejected.status()).toBe(400);
  const record=page.locator("article").filter({has:page.getByRole("heading",{name:`${parentName} — ${childLabel}`,exact:true})});
  const member=record.locator('[name="member"]');await member.selectOption({index:1});await record.locator('[name="serviceType"]').selectOption("group");
  const serviceRequest=page.waitForRequest(request=>request.method()==="POST"&&request.postData()?.includes('"action":"record_service_interest"')===true);
  const serviceResponse=page.waitForResponse(response=>response.request().method()==="POST"&&response.request().postData()?.includes('"action":"record_service_interest"')===true);
  await record.getByRole("button",{name:locale==="he"?"רישום התעניינות בשירות":"Record service interest",exact:true}).click();
  const serviceSent=await serviceRequest,serviceSaved=await serviceResponse,serviceBody=serviceSent.postDataJSON();expect(serviceSaved.status()).toBe(200);
  const serviceSavedBody=await serviceSaved.json();expect(serviceSavedBody).toMatchObject({ok:true,data:{saved:true,replayed:false,duplicate:false,item:{sourceInquiryId:savedBody.data.item.id,serviceType:"group"}}});
  await expect(record.getByRole("status")).toContainText(locale==="he"?"ההתעניינות בשירות נשמרה":"Service interest saved");
  const serviceReplay=await page.request.post(`${data.origin}/api/private/group-interest`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:serviceBody});
  expect(serviceReplay.status()).toBe(200);expect(await serviceReplay.json()).toMatchObject({ok:true,data:{saved:true,replayed:true,duplicate:true,item:{id:serviceSavedBody.data.item.id}}});
  if(locale==="en"){
   const duplicate={...serviceBody,operationId:randomUUID()},serviceDuplicate=await page.request.post(`${data.origin}/api/private/group-interest`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:duplicate});
   expect(serviceDuplicate.status()).toBe(200);expect(await serviceDuplicate.json()).toMatchObject({ok:true,data:{saved:true,replayed:false,duplicate:true,item:{id:serviceSavedBody.data.item.id}}});
   await member.selectOption({index:1});await record.locator('[name="serviceType"]').selectOption("tutoring");
   const tutoringResponse=page.waitForResponse(response=>response.request().method()==="POST"&&response.request().postData()?.includes('"serviceType":"tutoring"')===true);
   await record.getByRole("button",{name:"Record service interest",exact:true}).click();expect((await tutoringResponse).status()).toBe(200);
  }
  const planning=page.locator("section").filter({has:page.getByRole("heading",{name:locale==="he"?"קבוצות טיוטה והצעות שיבוץ":"Draft groups and proposed placements",exact:true})});
  const addDraft=planning.locator("details").filter({has:page.getByText(locale==="he"?"הוספת קבוצת טיוטה":"Add draft group",{exact:true})});await addDraft.locator("summary").click();
  const groupLabel=locale==="he"?`קבוצת טיוטה ${info.project.name}`:`Synthetic draft ${info.project.name}`;await addDraft.locator('[name="label"]').fill(groupLabel);
  const draftRequest=page.waitForRequest(request=>request.method()==="POST"&&request.postData()?.includes('"action":"create_draft_group"')===true),draftResponse=page.waitForResponse(response=>response.request().method()==="POST"&&response.request().postData()?.includes('"action":"create_draft_group"')===true);
  await addDraft.getByRole("button",{name:locale==="he"?"שמירת קבוצת טיוטה":"Save draft group",exact:true}).click();const draftSent=await draftRequest,draftSaved=await draftResponse;expect(draftSaved.status()).toBe(200);
  const draftSavedBody=await draftSaved.json();expect(draftSavedBody).toMatchObject({ok:true,data:{saved:true,replayed:false,item:{state:"draft_group",label:groupLabel}}});
  const draftReplay=await page.request.post(`${data.origin}/api/private/group-placement`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:draftSent.postDataJSON()});expect(draftReplay.status()).toBe(200);expect(await draftReplay.json()).toMatchObject({ok:true,data:{saved:true,replayed:true,item:{id:draftSavedBody.data.item.id}}});
  const groupCard=planning.locator("article").filter({has:page.getByRole("heading",{name:groupLabel,exact:true})});await expect(groupCard.getByText(locale==="he"?"קבוצת טיוטה":"Draft group",{exact:true})).toBeVisible();
  await expect(groupCard.getByText(locale==="he"?"לוח זמנים, מקום, קיבולת, תשלום והשתתפות: לא מוגדרים.":"Schedule, venue, capacity, fees and participation: Unset.",{exact:true})).toBeVisible();
  const propose=groupCard.locator("details");await propose.locator("summary").click();await propose.locator('[name="serviceInterestId"]').selectOption(serviceSavedBody.data.item.id);
  const placementRequest=page.waitForRequest(request=>request.method()==="POST"&&request.postData()?.includes('"action":"propose_group_placement"')===true),placementResponse=page.waitForResponse(response=>response.request().method()==="POST"&&response.request().postData()?.includes('"action":"propose_group_placement"')===true);
  await propose.getByRole("button",{name:locale==="he"?"שמירת הצעת שיבוץ":"Save proposed placement",exact:true}).click();const placementSent=await placementRequest,placementSaved=await placementResponse;expect(placementSaved.status()).toBe(200);
  const placementSavedBody=await placementSaved.json();expect(placementSavedBody).toMatchObject({ok:true,data:{saved:true,replayed:false,duplicate:false,item:{state:"proposed_placement",draftGroupId:draftSavedBody.data.item.id,serviceInterestId:serviceSavedBody.data.item.id}}});
  await expect(groupCard.getByText(locale==="he"?"הצעת שיבוץ — לא ניסיון ולא הרשמה":"Proposed placement — not a trial or enrollment",{exact:true})).toBeVisible();
  const placementReplay=await page.request.post(`${data.origin}/api/private/group-placement`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:placementSent.postDataJSON()});expect(placementReplay.status()).toBe(200);expect(await placementReplay.json()).toMatchObject({ok:true,data:{saved:true,replayed:true,duplicate:true,item:{id:placementSavedBody.data.item.id}}});
  if(locale==="en"){const duplicate={...placementSent.postDataJSON(),operationId:randomUUID()},placementDuplicate=await page.request.post(`${data.origin}/api/private/group-placement`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:duplicate});expect(placementDuplicate.status()).toBe(200);expect(await placementDuplicate.json()).toMatchObject({ok:true,data:{saved:true,replayed:false,duplicate:true,item:{id:placementSavedBody.data.item.id}}});}
  await page.reload();await expect(page.getByRole("heading",{name:`${parentName} — ${childLabel}`,exact:true})).toHaveCount(1);await expect(page.getByText(`Stale ${parentName}`,{exact:false})).toHaveCount(0);
  const reopened=page.locator("article").filter({has:page.getByRole("heading",{name:`${parentName} — ${childLabel}`,exact:true})});
  await expect(reopened.getByText(locale==="he"?"התעניינויות בשירות שנרשמו":"Recorded service interests",{exact:true})).toBeVisible();
  await expect(reopened.getByRole("listitem")).toHaveCount(locale==="en"?2:1);
  const unsaved=`Unsaved ${parentName}`;await inquiryForm.locator('[name="parentName"]').fill(unsaved);await inquiryForm.locator('[name="childLabel"]').fill(`Unsaved ${childLabel}`);await inquiryForm.locator('[name="childAge"]').fill("8");
  await inquiryForm.locator('[name="parentPhone"]').fill("+15550002222");await inquiryForm.locator('[name="permissionSource"]').selectOption("written");await inquiryForm.locator('[name="permissionLanguage"]').selectOption(locale);
  await inquiryForm.getByRole("button",{name:locale==="he"?"שמירת התעניינות":"Save interest",exact:true}).click();
  await expect(inquiryForm.locator('[name="permission"]')).not.toBeChecked();await expect(inquiryForm.locator('[name="parentName"]')).toHaveValue(unsaved);
  const afterInvalid=await skipState();expect(afterInvalid.active).toBe(false);expect(afterInvalid.intersects).toBe(false);expect(afterInvalid.bottom).toBeLessThanOrEqual(0);expect(await page.evaluate(()=>document.activeElement?.getAttribute("name"))).toBe("permission");
  await page.screenshot({path:info.outputPath(`group-interest-and-placement-${locale}-${info.project.name}.png`),fullPage:true});
 });
 test("parent is denied the owner-only page and API without disclosure",async({page,context},info)=>{
  await context.addCookies([{name:"__Host-ls-session",value:data.parent,url:data.origin,httpOnly:true,secure:true,sameSite:"Lax"}]);
  for(const locale of ["en","he"]){const denied=await page.goto(`/${locale}/app/group-interest`);expect([200,404]).toContain(denied?.status());await expect(page.getByRole("heading",{name:locale==="he"?"העמוד אינו זמין":"Page unavailable",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:/Group and tutoring interest|התעניינות בקבוצה ובתגבור/})).toHaveCount(0);await expect(page.locator('form')).toHaveCount(0);expect(await page.locator("body").innerText()).not.toContain(`Synthetic ${info.project.name}-${locale} Parent`);}
  const api=await page.request.get(`${data.origin}/api/private/group-interest`);expect(api.status()).toBe(403);expect(await api.text()).not.toContain("Synthetic");
  const placementApi=await page.request.get(`${data.origin}/api/private/group-placement`);expect(placementApi.status()).toBe(403);expect(await placementApi.text()).not.toContain("Synthetic");
 });
}
