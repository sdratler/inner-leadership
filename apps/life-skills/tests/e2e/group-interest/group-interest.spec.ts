/** Mounted authenticated synthetic browser acceptance. One response-loss fault follows a real upstream commit; no data API is mocked. */
import {expect,test} from "@playwright/test";
import type {Request as PlaywrightRequest} from "@playwright/test";
import {execFile} from "node:child_process";
import {randomUUID} from "node:crypto";
import {readFileSync} from "node:fs";
import {promisify} from "node:util";
type Runtime={origin:string;workspaceId:string;practitioner:string;parent:string;adult:string;child:string;revoked:string;otherWorkspace:string};
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
  const mobile=(page.viewportSize()?.width??1440)<=600;
  if(!mobile)await expect(page.locator(".lsu-sidebar").getByRole("link",{name:locale==="he"?"אנשים":"People",exact:true})).toHaveAttribute("aria-current","page");
  const groupsTab=page.getByRole("navigation",{name:locale==="he"?"תצוגות הדף הנוכחי":"Current page views"}).getByRole("link",{name:locale==="he"?"קבוצות":"Groups",exact:true});
  await expect(groupsTab).toHaveAttribute("aria-current","page");
  await expect(page.getByRole("navigation",{name:locale==="he"?"המיקום שלכם":"You are here"}).getByText(locale==="he"?"קבוצות":"Groups",{exact:true})).toHaveAttribute("aria-current","page");
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  const skip=page.locator(".lsu-skip"),skipState=async()=>skip.evaluate(element=>{const rect=element.getBoundingClientRect();return {active:document.activeElement===element,top:rect.top,bottom:rect.bottom,scrollY,intersects:rect.bottom>0&&rect.top<innerHeight};});
  const resting=await skipState();expect(resting.active).toBe(false);expect(resting.intersects).toBe(false);expect(resting.bottom).toBeLessThanOrEqual(0);
  await page.keyboard.press("Tab");await expect(skip).toBeFocused();const focused=await skipState();expect(focused.intersects).toBe(true);expect(focused.top).toBeGreaterThanOrEqual(0);await page.screenshot({path:info.outputPath(`group-interest-skip-focused-${locale}-${info.project.name}.png`)});
  await page.keyboard.press("Enter");await expect(page.locator("#lsw-main")).toBeFocused();
  if(mobile){await page.getByRole("button",{name:locale==="he"?"פתיחת התפריט":"Open navigation",exact:true}).click();const drawer=page.getByRole("dialog");await expect(drawer.getByRole("link",{name:locale==="he"?"אנשים":"People",exact:true})).toHaveAttribute("aria-current","page");await drawer.getByRole("button",{name:locale==="he"?"סגירת התפריט":"Close navigation",exact:true}).click();}
  await page.goto(`/${locale}/app/clients`);await page.getByRole("navigation",{name:locale==="he"?"תצוגות הדף הנוכחי":"Current page views"}).getByRole("link",{name:locale==="he"?"קבוצות":"Groups",exact:true}).click();
  await expect(page).toHaveURL(new RegExp(`/${locale}/app/group-interest$`));await page.goBack();await expect(page).toHaveURL(new RegExp(`/${locale}/app/clients`));await page.goForward();await expect(page).toHaveURL(new RegExp(`/${locale}/app/group-interest$`));
  const planningHeading=page.getByRole("heading",{name:locale==="he"?"קבוצות טיוטה והצעות שיבוץ":"Draft groups and proposed placements",exact:true});await expect(planningHeading).toBeVisible();
  const addInquiry=page.locator("details").filter({has:page.getByText(locale==="he"?"רישום פנייה":"Record an inquiry",{exact:true})});await expect(addInquiry).not.toHaveAttribute("open","");
  expect((await planningHeading.boundingBox())!.y).toBeLessThan((await addInquiry.boundingBox())!.y);await addInquiry.locator("summary").click();
  const inquiryForm=addInquiry.locator("form"),suffix=`${info.project.name}-${locale}`,parentName=`Synthetic ${suffix} Parent`,childLabel=`Synthetic ${suffix} Child`;
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
  let secondGroupInterest:{id:string;sourceInquiryId:string}|null=null;
  if(locale==="en"){
   const duplicate={...serviceBody,operationId:randomUUID()},serviceDuplicate=await page.request.post(`${data.origin}/api/private/group-interest`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:duplicate});
   expect(serviceDuplicate.status()).toBe(200);expect(await serviceDuplicate.json()).toMatchObject({ok:true,data:{saved:true,replayed:false,duplicate:true,item:{id:serviceSavedBody.data.item.id}}});
   const secondInquiry={...structuredClone(body),operationId:randomUUID(),fields:{...body.fields,parentName:`Follow-up ${parentName}`,area:"Distinct synthetic follow-up"}};
   const secondInquiryResponse=await page.request.post(`${data.origin}/api/private/group-interest`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:secondInquiry});expect(secondInquiryResponse.status()).toBe(200);
   const secondInquiryBody=await secondInquiryResponse.json();expect(secondInquiryBody).toMatchObject({ok:true,data:{item:{fields:{childLabel}}}});
   const secondService={...serviceBody,operationId:randomUUID(),inquiryId:secondInquiryBody.data.item.id,serviceType:"group"};
   const secondServiceResponse=await page.request.post(`${data.origin}/api/private/group-interest`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:secondService});expect(secondServiceResponse.status()).toBe(200);
   const secondServiceBody=await secondServiceResponse.json();secondGroupInterest=secondServiceBody.data.item;
   expect(secondGroupInterest).toMatchObject({sourceInquiryId:secondInquiryBody.data.item.id,personId:serviceSavedBody.data.item.personId,familyId:serviceSavedBody.data.item.familyId,serviceType:"group"});
   expect(secondGroupInterest!.id).not.toBe(serviceSavedBody.data.item.id);
   await member.selectOption({index:1});await record.locator('[name="serviceType"]').selectOption("tutoring");
   const tutoringResponse=page.waitForResponse(response=>response.request().method()==="POST"&&response.request().postData()?.includes('"serviceType":"tutoring"')===true);
   await record.getByRole("button",{name:"Record service interest",exact:true}).click();expect((await tutoringResponse).status()).toBe(200);
  }
  const planning=page.locator("section").filter({has:page.getByRole("heading",{name:locale==="he"?"קבוצות טיוטה והצעות שיבוץ":"Draft groups and proposed placements",exact:true})});
  const addDraft=planning.locator("details").filter({has:page.getByText(locale==="he"?"הוספת קבוצת טיוטה":"Add draft group",{exact:true})});await addDraft.locator("summary").click();
  const groupLabel=locale==="he"?`קבוצת טיוטה ${info.project.name}`:`Synthetic draft ${info.project.name}`;await addDraft.locator('[name="label"]').fill(groupLabel);
  let draftSent:PlaywrightRequest,draftSavedBody:{ok:boolean;data:{saved:boolean;replayed:boolean;item:{id:string;state:string;label:string}}};
  if(locale==="en"){
   let interrupted:Record<string,unknown>|null=null;await page.route("**/api/private/group-placement",async route=>{if(route.request().method()==="POST"&&route.request().postData()?.includes('"action":"create_draft_group"')){interrupted=route.request().postDataJSON();const upstream=await route.fetch();expect(upstream.status()).toBe(200);await route.abort("failed");}else await route.continue();},{times:1});
   await addDraft.getByRole("button",{name:"Save draft group",exact:true}).click();await expect(addDraft.locator('[name="label"]')).toHaveValue(groupLabel);await expect(planning.getByRole("alert")).toContainText("Save is unconfirmed");
   const retryRequest=page.waitForRequest(request=>request.method()==="POST"&&request.postData()?.includes('"action":"create_draft_group"')===true),retryResponse=page.waitForResponse(response=>response.request().method()==="POST"&&response.request().postData()?.includes('"action":"create_draft_group"')===true);
   await addDraft.getByRole("button",{name:"Retry same draft group",exact:true}).click();draftSent=await retryRequest;const saved=await retryResponse;expect(saved.status()).toBe(200);draftSavedBody=await saved.json();
   expect(draftSent.postDataJSON()).toEqual(interrupted);expect(draftSavedBody).toMatchObject({ok:true,data:{saved:true,replayed:true,item:{state:"draft_group",label:groupLabel}}});
  }else{
   const draftRequest=page.waitForRequest(request=>request.method()==="POST"&&request.postData()?.includes('"action":"create_draft_group"')===true),draftResponse=page.waitForResponse(response=>response.request().method()==="POST"&&response.request().postData()?.includes('"action":"create_draft_group"')===true);
   await addDraft.getByRole("button",{name:"שמירת קבוצת טיוטה",exact:true}).click();draftSent=await draftRequest;const saved=await draftResponse;expect(saved.status()).toBe(200);draftSavedBody=await saved.json();expect(draftSavedBody).toMatchObject({ok:true,data:{saved:true,replayed:false,item:{state:"draft_group",label:groupLabel}}});
  }
  const draftReplay=await page.request.post(`${data.origin}/api/private/group-placement`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:draftSent.postDataJSON()});expect(draftReplay.status()).toBe(200);expect(await draftReplay.json()).toMatchObject({ok:true,data:{saved:true,replayed:true,item:{id:draftSavedBody.data.item.id}}});
  const draftConflict=await page.request.post(`${data.origin}/api/private/group-placement`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:{...draftSent.postDataJSON(),label:`Changed ${groupLabel}`}});expect(draftConflict.status()).toBe(409);
  const groupCard=planning.locator("article").filter({has:page.getByRole("heading",{name:groupLabel,exact:true})});await expect(groupCard.getByText(locale==="he"?"קבוצת טיוטה":"Draft group",{exact:true})).toBeVisible();
  await expect(groupCard.getByText(locale==="he"?"לוח זמנים, מקום, קיבולת, תשלום והשתתפות: לא מוגדרים.":"Schedule, venue, capacity, fees and participation: Unset.",{exact:true})).toBeVisible();
  const missingPlacement=await page.request.post(`${data.origin}/api/private/group-placement`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:{action:"propose_group_placement",operationId:randomUUID(),draftGroupId:randomUUID(),serviceInterestId:serviceSavedBody.data.item.id}});expect(missingPlacement.status()).toBe(404);
  const propose=groupCard.locator("details");await propose.locator("summary").click();const proposalSelect=propose.locator('[name="serviceInterestId"]');
  await expect(proposalSelect.locator(`option[value="${serviceSavedBody.data.item.id}"]`)).toContainText(serviceSavedBody.data.item.sourceInquiryId.slice(0,8));
  if(secondGroupInterest)await expect(proposalSelect.locator(`option[value="${secondGroupInterest.id}"]`)).toContainText(secondGroupInterest.sourceInquiryId.slice(0,8));
  await proposalSelect.selectOption(serviceSavedBody.data.item.id);
  const placementRequest=page.waitForRequest(request=>request.method()==="POST"&&request.postData()?.includes('"action":"propose_group_placement"')===true),placementResponse=page.waitForResponse(response=>response.request().method()==="POST"&&response.request().postData()?.includes('"action":"propose_group_placement"')===true);
  await propose.getByRole("button",{name:locale==="he"?"שמירת הצעת שיבוץ":"Save proposed placement",exact:true}).click();const placementSent=await placementRequest,placementSaved=await placementResponse;expect(placementSaved.status()).toBe(200);
  const placementSavedBody=await placementSaved.json();expect(placementSavedBody).toMatchObject({ok:true,data:{saved:true,replayed:false,duplicate:false,item:{state:"proposed_placement",draftGroupId:draftSavedBody.data.item.id,serviceInterestId:serviceSavedBody.data.item.id}}});
  await expect(groupCard.getByText(locale==="he"?"הצעת שיבוץ נוכחית — לא ניסיון ולא הרשמה":"Current proposed placement — not a trial or enrollment",{exact:true})).toBeVisible();
  const placementReplay=await page.request.post(`${data.origin}/api/private/group-placement`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:placementSent.postDataJSON()});expect(placementReplay.status()).toBe(200);expect(await placementReplay.json()).toMatchObject({ok:true,data:{saved:true,replayed:true,duplicate:true,item:{id:placementSavedBody.data.item.id}}});
  const placementConflict=await page.request.post(`${data.origin}/api/private/group-placement`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:{...placementSent.postDataJSON(),serviceInterestId:randomUUID()}});expect(placementConflict.status()).toBe(409);
  if(locale==="en"){const duplicate={...placementSent.postDataJSON(),operationId:randomUUID()},placementDuplicate=await page.request.post(`${data.origin}/api/private/group-placement`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:duplicate});expect(placementDuplicate.status()).toBe(200);expect(await placementDuplicate.json()).toMatchObject({ok:true,data:{saved:true,replayed:false,duplicate:true,item:{id:placementSavedBody.data.item.id}}});}
  const apiDraft=async(label:string)=>{const response=await page.request.post(`${data.origin}/api/private/group-placement`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:{action:"create_draft_group",operationId:randomUUID(),label}});expect(response.status()).toBe(200);return (await response.json()).data.item as {id:string;label:string};};
  const groupB=await apiDraft(locale==="he"?`יעד ב ${info.project.name}`:`Destination B ${info.project.name}`),groupC=await apiDraft(locale==="he"?`יעד ג ${info.project.name}`:`Destination C ${info.project.name}`);
  await page.reload();
  const sourceCard=planning.locator("article").filter({has:page.getByRole("heading",{name:groupLabel,exact:true})}),moveSummary=locale==="he"?"העברת הצעה":"Move proposal";
  const firstMove=sourceCard.locator("details").filter({has:page.getByText(moveSummary,{exact:true})});await firstMove.locator("summary").click();
  const firstMoveSelect=firstMove.locator('[name="destinationDraftGroupId"]');await expect(firstMoveSelect.locator(`option[value="${groupB.id}"]`)).toHaveCount(1);await expect(firstMoveSelect.locator(`option[value="${groupC.id}"]`)).toHaveCount(1);await firstMoveSelect.selectOption(groupB.id);
  let firstMoveRequest:PlaywrightRequest,firstMoveSavedBody:{ok:boolean;data:{saved:boolean;replayed:boolean;item:{id:string;draftGroupId:string};movement:{id:string}}};
  if(locale==="en"){
   let interrupted:Record<string,unknown>|null=null;await page.route("**/api/private/group-placement",async route=>{if(route.request().method()==="POST"&&route.request().postData()?.includes('"action":"move_group_placement"')){interrupted=route.request().postDataJSON();const upstream=await route.fetch();expect(upstream.status()).toBe(200);await route.abort("failed");}else await route.continue();},{times:1});
   await firstMove.getByRole("button",{name:"Move proposal",exact:true}).click();await expect(firstMoveSelect).toHaveValue(groupB.id);await expect(sourceCard.getByRole("alert")).toContainText("Save is unconfirmed");
   const retryRequest=page.waitForRequest(request=>request.method()==="POST"&&request.postData()?.includes('"action":"move_group_placement"')===true),retryResponse=page.waitForResponse(response=>response.request().method()==="POST"&&response.request().postData()?.includes('"action":"move_group_placement"')===true);
   await firstMove.getByRole("button",{name:"Retry exact same move",exact:true}).click();firstMoveRequest=await retryRequest;const response=await retryResponse;expect(response.status()).toBe(200);firstMoveSavedBody=await response.json();expect(firstMoveRequest.postDataJSON()).toEqual(interrupted);expect(firstMoveSavedBody).toMatchObject({ok:true,data:{saved:true,replayed:true,item:{draftGroupId:groupB.id}}});
  }else{
   const request=page.waitForRequest(value=>value.method()==="POST"&&value.postData()?.includes('"action":"move_group_placement"')===true),response=page.waitForResponse(value=>value.request().method()==="POST"&&value.request().postData()?.includes('"action":"move_group_placement"')===true);
   await firstMove.getByRole("button",{name:"העברת הצעה",exact:true}).click();firstMoveRequest=await request;const saved=await response;expect(saved.status()).toBe(200);firstMoveSavedBody=await saved.json();expect(firstMoveSavedBody).toMatchObject({ok:true,data:{saved:true,replayed:false,item:{draftGroupId:groupB.id}}});
  }
  await expect(sourceCard.getByText(locale==="he"?"הצעה שהועברה — אינה נוכחית, ניסיון או הרשמה":"Moved proposal — not current, trial, or enrollment",{exact:true})).toBeVisible();
  const groupBCard=planning.locator("article").filter({has:page.getByRole("heading",{name:groupB.label,exact:true})}),secondMove=groupBCard.locator("details").filter({has:page.getByText(moveSummary,{exact:true})});await secondMove.locator("summary").click();
  await expect(secondMove.locator(`option[value="${draftSavedBody.data.item.id}"]`)).toHaveCount(0);await secondMove.locator('[name="destinationDraftGroupId"]').selectOption(groupC.id);
  const secondMoveRequest=page.waitForRequest(request=>request.method()==="POST"&&request.postData()?.includes('"action":"move_group_placement"')===true),secondMoveResponse=page.waitForResponse(response=>response.request().method()==="POST"&&response.request().postData()?.includes('"action":"move_group_placement"')===true);
  await secondMove.getByRole("button",{name:moveSummary,exact:true}).click();await secondMoveRequest;const secondSaved=await secondMoveResponse;expect(secondSaved.status()).toBe(200);const secondSavedBody=await secondSaved.json();expect(secondSavedBody).toMatchObject({ok:true,data:{saved:true,replayed:false,item:{draftGroupId:groupC.id}}});
  const replayAfterSuccessor=await page.request.post(`${data.origin}/api/private/group-placement`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:firstMoveRequest.postDataJSON()});expect(replayAfterSuccessor.status()).toBe(200);expect(await replayAfterSuccessor.json()).toMatchObject({ok:true,data:{saved:true,replayed:true,item:{id:firstMoveSavedBody.data.item.id},movement:{id:firstMoveSavedBody.data.movement.id}}});
  const ordinaryAfterMove=await page.request.post(`${data.origin}/api/private/group-placement`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:{action:"propose_group_placement",operationId:randomUUID(),draftGroupId:groupC.id,serviceInterestId:serviceSavedBody.data.item.id}});expect(ordinaryAfterMove.status()).toBe(200);expect(await ordinaryAfterMove.json()).toMatchObject({ok:true,data:{saved:true,replayed:false,duplicate:true,item:{id:secondSavedBody.data.item.id}}});
  const returnToA=await page.request.post(`${data.origin}/api/private/group-placement`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:{action:"move_group_placement",operationId:randomUUID(),sourceProposedPlacementId:secondSavedBody.data.item.id,destinationDraftGroupId:draftSavedBody.data.item.id}});expect(returnToA.status()).toBe(409);
  const supersededSource=await page.request.post(`${data.origin}/api/private/group-placement`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:{action:"move_group_placement",operationId:randomUUID(),sourceProposedPlacementId:placementSavedBody.data.item.id,destinationDraftGroupId:groupC.id}});expect(supersededSource.status()).toBe(409);
  const groupD=await apiDraft(locale==="he"?`יעד תפוס ${info.project.name}`:`Occupied destination ${info.project.name}`);await page.reload();
  const groupCCard=planning.locator("article").filter({has:page.getByRole("heading",{name:groupC.label,exact:true})}),staleMove=groupCCard.locator("details").filter({has:page.getByText(moveSummary,{exact:true})});await staleMove.locator("summary").click();await staleMove.locator('[name="destinationDraftGroupId"]').selectOption(groupD.id);
  await page.route("**/api/private/group-placement",route=>route.request().method()==="POST"&&route.request().postData()?.includes('"action":"move_group_placement"')?route.abort("failed"):route.continue(),{times:1});
  const lostMoveRequest=page.waitForRequest(request=>request.method()==="POST"&&request.postData()?.includes('"action":"move_group_placement"')===true);await staleMove.getByRole("button",{name:moveSummary,exact:true}).click();const lostMoveBody=(await lostMoveRequest).postDataJSON();
  const retryMoveLabel=locale==="he"?"ניסיון חוזר לאותה העברה בדיוק":"Retry exact same move";await expect(staleMove.getByRole("button",{name:retryMoveLabel,exact:true})).toBeVisible();
  await page.route("**/api/identity/session",route=>route.fulfill({status:401,contentType:"application/json",body:JSON.stringify({ok:false,error:{code:"UNAUTHENTICATED"}})}),{times:1});const expiredSessionRequest=page.waitForRequest("**/api/identity/session");await staleMove.getByRole("button",{name:retryMoveLabel,exact:true}).click();await expiredSessionRequest;await expect(groupCCard.getByRole("alert")).toContainText(locale==="he"?"יש להתחבר מחדש בכרטיסייה אחרת":"Sign in again in another tab");await expect(staleMove.getByRole("button",{name:retryMoveLabel,exact:true})).toBeEnabled();
  await page.route("**/api/identity/session",route=>route.abort("failed"),{times:1});const lostSessionRequest=page.waitForRequest("**/api/identity/session");await staleMove.getByRole("button",{name:retryMoveLabel,exact:true}).click();await lostSessionRequest;await expect(staleMove.getByRole("button",{name:retryMoveLabel,exact:true})).toBeEnabled();
  const ordinaryFirst=await page.request.post(`${data.origin}/api/private/group-placement`,{headers:{Origin:data.origin,"X-CSRF-Token":csrf!},data:{action:"propose_group_placement",operationId:randomUUID(),draftGroupId:groupD.id,serviceInterestId:serviceSavedBody.data.item.id}});expect(ordinaryFirst.status()).toBe(200);expect(await ordinaryFirst.json()).toMatchObject({ok:true,data:{saved:true,replayed:false,duplicate:false}});
  const staleRequest=page.waitForRequest(request=>request.method()==="POST"&&request.postData()?.includes('"action":"move_group_placement"')===true),staleResponse=page.waitForResponse(response=>response.request().method()==="POST"&&response.request().postData()?.includes('"action":"move_group_placement"')===true);await staleMove.getByRole("button",{name:retryMoveLabel,exact:true}).click();expect((await staleRequest).postDataJSON()).toEqual(lostMoveBody);expect((await staleResponse).status()).toBe(409);
  await expect(groupCCard.getByRole("alert")).toContainText(locale==="he"?"ההצעה השתנתה או שקבוצת היעד אינה זמינה עוד":"This proposal changed or the destination is no longer available");
  await page.reload();const finalC=planning.locator("article").filter({has:page.getByRole("heading",{name:groupC.label,exact:true})});
  const finalMove=finalC.locator("details").filter({has:page.getByText(moveSummary,{exact:true})});
  if(await finalMove.count()){
   await finalMove.locator("summary").click();const options=await finalMove.locator('[name="destinationDraftGroupId"] option').evaluateAll(nodes=>nodes.map(node=>(node as HTMLOptionElement).value).filter(Boolean));
   expect(options).not.toContain(draftSavedBody.data.item.id);expect(options).not.toContain(groupB.id);expect(options).not.toContain(groupC.id);expect(options).not.toContain(groupD.id);
  }else await expect(finalC.getByText(locale==="he"?"אין קבוצת טיוטה פנויה להתעניינות זו. לא ניתן להשתמש מחדש בהצעות היסטוריות כיעד.":"No unused draft group is available for this interest. Historical proposals cannot be reused as destinations.",{exact:true})).toBeVisible();
  await expect(groupBCard.getByText(locale==="he"?"הועברה מתוך":"Moved from",{exact:false})).toHaveCount(1);await expect(finalC.getByText(locale==="he"?"הועברה מתוך":"Moved from",{exact:false})).toHaveCount(1);expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await page.reload();await expect(page.getByRole("heading",{name:`${parentName} — ${childLabel}`,exact:true})).toHaveCount(1);await expect(page.getByText(`Stale ${parentName}`,{exact:false})).toHaveCount(0);
  const reopened=page.locator("article").filter({has:page.getByRole("heading",{name:`${parentName} — ${childLabel}`,exact:true})});
  await expect(reopened.getByText(locale==="he"?"התעניינויות בשירות שנרשמו":"Recorded service interests",{exact:true})).toBeVisible();
  await expect(reopened.getByRole("listitem")).toHaveCount(locale==="en"?2:1);
  await addInquiry.locator("summary").click();const unsaved=`Unsaved ${parentName}`;await inquiryForm.locator('[name="parentName"]').fill(unsaved);await inquiryForm.locator('[name="childLabel"]').fill(`Unsaved ${childLabel}`);await inquiryForm.locator('[name="childAge"]').fill("8");
  await inquiryForm.locator('[name="parentPhone"]').fill("+15550002222");await inquiryForm.locator('[name="permissionSource"]').selectOption("written");await inquiryForm.locator('[name="permissionLanguage"]').selectOption(locale);
  await inquiryForm.getByRole("button",{name:locale==="he"?"שמירת התעניינות":"Save interest",exact:true}).click();
  await expect(inquiryForm.locator('[name="permission"]')).not.toBeChecked();await expect(inquiryForm.locator('[name="parentName"]')).toHaveValue(unsaved);
  const afterInvalid=await skipState();expect(afterInvalid.active).toBe(false);expect(afterInvalid.intersects).toBe(false);expect(afterInvalid.bottom).toBeLessThanOrEqual(0);expect(await page.evaluate(()=>document.activeElement?.getAttribute("name"))).toBe("permission");
  await addInquiry.locator("summary").click();await expect(addInquiry).not.toHaveAttribute("open","");await addInquiry.locator("summary").click();await expect(inquiryForm.locator('[name="parentName"]')).toHaveValue(unsaved);await addInquiry.locator("summary").click();
  await page.locator("#lsw-main").focus();await page.evaluate(()=>scrollTo(0,0));await page.screenshot({path:info.outputPath(`group-interest-and-placement-${locale}-${info.project.name}.png`)});
 });
 test("parent is denied the owner-only page and API without disclosure",async({page,context},info)=>{
  await context.addCookies([{name:"__Host-ls-session",value:data.parent,url:data.origin,httpOnly:true,secure:true,sameSite:"Lax"}]);
  for(const locale of ["en","he"]){const denied=await page.goto(`/${locale}/app/group-interest`);expect([200,404]).toContain(denied?.status());await expect(page.getByRole("heading",{name:locale==="he"?"העמוד אינו זמין":"Page unavailable",exact:true})).toBeVisible();await expect(page.getByRole("heading",{name:/Group and tutoring interest|התעניינות בקבוצה ובתגבור/})).toHaveCount(0);await expect(page.locator('form')).toHaveCount(0);expect(await page.locator("body").innerText()).not.toContain(`Synthetic ${info.project.name}-${locale} Parent`);}
  const api=await page.request.get(`${data.origin}/api/private/group-interest`);expect(api.status()).toBe(403);expect(await api.text()).not.toContain("Synthetic");
  const placementApi=await page.request.get(`${data.origin}/api/private/group-placement`);expect(placementApi.status()).toBe(403);expect(await placementApi.text()).not.toContain("Synthetic");
 });
 test("adult, child, revoked and other-workspace sessions cannot open or read owner planning",async({page,context})=>{
  for(const [kind,token] of Object.entries({adult:data.adult,child:data.child,revoked:data.revoked,otherWorkspace:data.otherWorkspace})){
   await context.clearCookies();await context.addCookies([{name:"__Host-ls-session",value:token,url:data.origin,httpOnly:true,secure:true,sameSite:"Lax"}]);
   const response=await page.goto("/en/app/group-interest");expect([200,404]).toContain(response?.status());await expect(page.getByRole("heading",{name:"Group and tutoring interest",exact:true})).toHaveCount(0);
   expect(page.url().includes("/en/login")||await page.getByRole("heading",{name:"Page unavailable",exact:true}).count()===1,kind).toBe(true);expect(await page.locator("body").innerText()).not.toContain("Synthetic draft");
   const interest=await page.request.get(`${data.origin}/api/private/group-interest`),placement=await page.request.get(`${data.origin}/api/private/group-placement`);
   expect([401,403],kind).toContain(interest.status());expect([401,403],kind).toContain(placement.status());expect(await interest.text()).not.toContain("Synthetic draft");expect(await placement.text()).not.toContain("Synthetic draft");
  }
 });
 test("an unauthenticated Groups deep link keeps its exact ordinary-login return",async({page,context})=>{
  await context.clearCookies();await page.goto("/en/app/group-interest");await expect(page.getByRole("region",{name:"Sign in to Life Skills",exact:true})).toBeVisible();const login=new URL(page.url());expect(login.pathname).toBe("/en/login");expect(login.searchParams.get("next")).toBe("/en/app/group-interest");
  await context.addCookies([{name:"__Host-ls-session",value:data.practitioner,url:data.origin,httpOnly:true,secure:true,sameSite:"Lax"}]);await page.reload();await expect(page.getByRole("heading",{name:"Group and tutoring interest",exact:true})).toBeVisible();
 });
}
