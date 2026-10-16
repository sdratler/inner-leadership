import {expect,type Page,type Response,type Route} from "@playwright/test";

/** Invoked only by MAIN's admitted synthetic fixture/test. No test registration,
 * login implementation, context creation, setup, runner, environment or DB work. */
export type FishingClassroomJourneyPorts={
 page:Page;
 ordinaryParentLogin(page:Page,target:string,locale:"en"|"he"):Promise<void>;
 /** MAIN creates and closes a separate, initially unauthenticated context. */
 withFreshParentContext(work:(page:Page)=>Promise<void>):Promise<void>;
};
export type FishingClassroomJourneyInput={
 origin:string;locale:"en"|"he";learnerId:string;enrollmentId:string;moduleId:string;version:string;
 questions:readonly {id:string;prompt:string;answer:string}[];
 /** Actual synthetic teacher/unrelated-family canaries supplied by MAIN. */
 forbiddenContent:readonly string[];
};
export type FishingClassroomJourneyReceipt={
 lessonHref:string;operationId:string;revisionId:string;questionCount:number;postCount:2;
 freshContextRead:true;backContextRead:true;
};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const lessonPath="/api/resources/education/lesson",contextPath="/api/calendar/fishing/context",planPath="/api/calendar/fishing/plan";
const timeout=30000;
function requireFact(value:unknown,code:string):asserts value{if(!value)throw Error("FISHING_CLASSROOM_JOURNEY_"+code);}
function object(value:unknown,code:string):Record<string,unknown>{requireFact(value!==null&&typeof value==="object"&&!Array.isArray(value),code);return value as Record<string,unknown>;}
function array(value:unknown,code:string):unknown[]{requireFact(Array.isArray(value),code);return value;}
function exactQuery(url:URL,entries:readonly (readonly [string,string])[]){
 return !url.hash&&url.searchParams.size===entries.length&&entries.every(([key,value])=>url.searchParams.getAll(key).length===1&&url.searchParams.get(key)===value);
}
function ownGet(response:Response,page:Page,origin:string,path:string,entries?:readonly (readonly [string,string])[]){
 try{const request=response.request(),url=new URL(response.url());
  return request.method()==="GET"&&request.frame()===page.mainFrame()&&url.origin===origin&&url.pathname===path&&(!entries||exactQuery(url,entries));
 }catch{return false;}
}
/** Attach before the UI action. Observe only the page's own GET, never page.request. */
function waitForRead(page:Page,origin:string,path:string,entries?:readonly (readonly [string,string])[]){
 const pending=page.waitForResponse(response=>ownGet(response,page,origin,path,entries),{timeout});
 void pending.catch(()=>undefined);return pending;
}
async function readData(pending:Promise<Response>){
 const response=await pending;requireFact(response.status()===200,"READ_STATUS");requireFact(await response.finished()===null,"READ_INCOMPLETE");
 const envelope=object(await response.json() as unknown,"READ_ENVELOPE");requireFact(envelope.ok===true,"READ_NOT_OK");return object(envelope.data,"READ_DATA");
}
function verifyInput(input:FishingClassroomJourneyInput){
 const origin=new URL(input.origin);requireFact(origin.origin===input.origin&&origin.protocol==="https:"&&["localhost","127.0.0.1"].includes(origin.hostname)&&Number(origin.port)>=1024&&!origin.username&&!origin.password,"SYNTHETIC_HTTPS_ORIGIN");
 requireFact(["en","he"].includes(input.locale)&&uuid.test(input.learnerId)&&uuid.test(input.enrollmentId)&&/^RM-[1-4](?:0[1-9]|1[0-2])$/.test(input.moduleId),"EXACT_CONTEXT");
 requireFact(input.version.trim()===input.version&&input.version.length>0&&input.version.length<=100&&!/[\u0000-\u001f\u007f]/.test(input.version),"EXACT_VERSION");
 requireFact(input.questions.length>=1&&input.questions.length<=3&&new Set(input.questions.map(q=>q.id)).size===input.questions.length&&new Set(input.questions.map(q=>q.prompt)).size===input.questions.length,"EXACT_QUESTION_SET");
 const session=(Number(input.moduleId[3])-1)*12+Number(input.moduleId.slice(4));
 for(const question of input.questions)requireFact(/^Q\d{2}-[1-3]$/.test(question.id)&&Number(question.id.slice(1,3))===session&&question.prompt.trim().length>0&&question.prompt.length<=2000&&question.answer.trim().length>0&&question.answer.length<=2000,"QUESTION_AND_ANSWER");
 requireFact(input.forbiddenContent.length>0&&input.forbiddenContent.length<=20&&input.forbiddenContent.every(value=>value.trim().length>0&&value.length<=2000),"PRIVACY_CANARIES_REQUIRED");
}
function contextData(data:Record<string,unknown>,learnerId:string|null,input:FishingClassroomJourneyInput){
 requireFact(data.role==="parent"&&data.availability==="ready"&&data.selectedLearnerId===learnerId,"CURRENT_PARENT_CONTEXT");
 requireFact(array(data.children,"CHILDREN").some(value=>object(value,"CHILD").learnerId===input.learnerId),"OWN_LEARNER_CHOICE");
 const stages=array(data.stages,"STAGES");
 if(learnerId===null)requireFact(stages.length===0,"NO_IMPLICIT_STAGE");
 else requireFact(stages.some(value=>{const stage=object(value,"STAGE");return stage.learnerId===input.learnerId&&stage.enrollmentId===input.enrollmentId;}),"OWN_ENROLLMENT_CHOICE");
}
function planHref(data:Record<string,unknown>,input:FishingClassroomJourneyInput){
 const selection=object(data.selection,"PLAN_SELECTION"),view=object(data.view,"PLAN_VIEW");
 requireFact(selection.learnerId===input.learnerId&&selection.enrollmentId===input.enrollmentId&&data.lessonLearnerId===input.learnerId&&view.role==="parent"&&view.enrollmentId===input.enrollmentId,"PLAN_CONTEXT");
 const references=array(view.lessonReferences,"LESSON_REFERENCES").map(value=>object(value,"LESSON_REFERENCE")).filter(ref=>ref.moduleId===input.moduleId&&ref.version===input.version);
 requireFact(references.length===1,"EXACT_LESSON_REFERENCE");
 const links=array(data.lessonLinks,"LESSON_LINKS").map(value=>object(value,"LESSON_LINK")).filter(link=>link.occurrenceId===references[0]!.occurrenceId);
 requireFact(links.length===1&&typeof links[0]!.href==="string","ACTUAL_SERVER_LINK");const href=links[0]!.href;
 requireFact(href.startsWith(`/${input.locale}/family/resources?`)&&!/[\\\u0000-\u0020]/.test(href),"LOCAL_LESSON_LINK");
 const url=new URL(href,input.origin);
 requireFact(url.origin===input.origin&&url.pathname===`/${input.locale}/family/resources`&&exactQuery(url,[["education","lesson"],["learnerId",input.learnerId],["moduleId",input.moduleId],["version",input.version],["section","lesson"]]),"EXACT_LESSON_LINK");
 return href;
}
function verifyAnswers(value:unknown,input:FishingClassroomJourneyInput,saved:boolean){
 const answers=array(value,"SAVED_ANSWERS").map(value=>object(value,"ANSWER"));requireFact(answers.length===input.questions.length,"COMPLETE_ANSWERS");
 for(const [index,question]of input.questions.entries())requireFact(answers[index]!.questionId===question.id&&answers[index]!.value===(saved?question.answer.trim():question.answer),"EXACT_ANSWER");
}
async function verifyLesson(page:Page,data:Record<string,unknown>,input:FishingClassroomJourneyInput,revisionId:string|null){
 const lesson=object(data.lesson,"LEARNER_LESSON");requireFact(lesson.moduleId===input.moduleId&&lesson.version===input.version,"LESSON_CONTEXT");
 const questions=array(lesson.questions,"LESSON_QUESTIONS").map(value=>object(value,"QUESTION"));requireFact(questions.length===input.questions.length,"ALL_QUESTIONS");
 for(const [index,question]of input.questions.entries())requireFact(questions[index]!.id===question.id&&questions[index]!.prompt===question.prompt,"EXACT_QUESTION");
 requireFact(!["observations","summaryRecipients","teacher","teacherKey","privateNote"].some(key=>key in data||key in lesson),"PRIVATE_FIELDS");
 const payload=JSON.stringify(data);for(const marker of input.forbiddenContent)requireFact(!payload.includes(marker),"PRIVATE_RESPONSE_CONTENT");
 const panel=page.locator("#education-panel");await expect(panel).toBeVisible({timeout});await expect(panel.locator("textarea")).toHaveCount(input.questions.length);
 for(const question of input.questions){const field=panel.getByLabel(question.prompt,{exact:true});await expect(field).toHaveAttribute("id",`lesson-${input.moduleId}-${question.id}`);
  if(revisionId!==null)await expect(field).toHaveValue(question.answer.trim());
 }
 if(revisionId!==null){const submission=object(data.submission,"SAVED_SUBMISSION");requireFact(submission.revisionId===revisionId&&data.revisionId===revisionId,"SAVED_REVISION");verifyAnswers(submission.answers,input,true);}
 const body=await page.locator("body").innerText();for(const marker of input.forbiddenContent)requireFact(!body.includes(marker),"PRIVATE_VISIBLE_CONTENT");
}

export async function runFishingClassroomJourney(ports:FishingClassroomJourneyPorts,input:FishingClassroomJourneyInput):Promise<FishingClassroomJourneyReceipt>{
 verifyInput(input);const {page}=ports,t=(en:string,he:string)=>input.locale==="he"?he:en;
 const materials=`/${input.locale}/family/resources`,readQuery=[["learnerId",input.learnerId],["moduleId",input.moduleId],["version",input.version],["view","learner"]]as const;
 const initialRead=waitForRead(page,input.origin,contextPath,[]);
 await ports.ordinaryParentLogin(page,materials,input.locale);await expect(page).toHaveURL(input.origin+materials,{timeout});contextData(await readData(initialRead),null,input);
 const chooser=page.getByRole("region",{name:t("Course lessons","שיעורי הקורס"),exact:true});await expect(chooser).toBeVisible();
 const learner=chooser.getByLabel(t("Learner","משתתף"),{exact:true});await expect(learner).toHaveValue("");
 await expect(chooser.getByLabel(t("Stage enrollment","רישום לשלב"),{exact:true})).toHaveCount(0);await expect(chooser.getByRole("link")).toHaveCount(0);
 const selectedRead=waitForRead(page,input.origin,contextPath,[["learnerId",input.learnerId]]);
 await learner.selectOption(input.learnerId);contextData(await readData(selectedRead),input.learnerId,input);
 const stage=chooser.getByLabel(t("Stage enrollment","רישום לשלב"),{exact:true});await expect(stage).toHaveValue("");
 const selectedPlan=waitForRead(page,input.origin,planPath);
 await stage.selectOption(input.enrollmentId);const lessonHref=planHref(await readData(selectedPlan),input);
 const link=chooser.getByRole("link",{name:`${t("Open lesson","פתיחת שיעור")} · ${t("Session","מפגש")} ${Number(input.moduleId.slice(4))}`,exact:true});
 await expect(link).toHaveAttribute("href",lessonHref);const chooserUrl=page.url();
 const firstLesson=waitForRead(page,input.origin,lessonPath,readQuery);await link.click();await expect(page).toHaveURL(input.origin+lessonHref,{timeout});
 const firstData=await readData(firstLesson),predecessor=firstData.revisionId;
 requireFact(predecessor===null||typeof predecessor==="string"&&uuid.test(predecessor),"INITIAL_REVISION");await verifyLesson(page,firstData,input,null);
 for(const question of input.questions)await page.locator("#education-panel").getByLabel(question.prompt,{exact:true}).fill(question.answer);
 const submit=()=>page.getByRole("button",{name:t("Submit my work","שליחת העבודה שלי"),exact:true});await expect(submit()).toBeEnabled();

 const exactPostUrl=(url:URL)=>url.origin===input.origin&&url.pathname===lessonPath&&!url.search&&!url.hash;
 const bodies:string[]=[],operations:string[]=[];let revisionId="",completed=0,handlerError:Error|null=null;
 const pending=new Set<Promise<void>>();
 const handle=async(route:Route)=>{
  const request=route.request();let own=false;try{own=request.method()==="POST"&&request.frame()===page.mainFrame();}catch{/* No frame means this is not this page's submission. */}
  if(!own)return route.fallback();
  try{
   requireFact(bodies.length<2,"UNEXPECTED_EXTRA_POST");const body=request.postData();requireFact(body!==null,"POST_BODY");
   const payload=object(JSON.parse(body)as unknown,"POST_PAYLOAD"),reference=object(payload.reference,"POST_REFERENCE"),command=object(payload.command,"POST_COMMAND");
   requireFact(reference.learnerId===input.learnerId&&reference.moduleId===input.moduleId&&reference.version===input.version&&command.action==="submit"&&typeof command.operationId==="string"&&uuid.test(command.operationId),"POST_CONTEXT");
   requireFact(command.expectedRevisionId===predecessor,"SUBMISSION_PREDECESSOR");verifyAnswers(command.answers,input,false);
   if(bodies.length)requireFact(body===bodies[0]&&command.operationId===operations[0],"IDENTICAL_RETRY_REQUIRED");
   bodies.push(body);operations.push(command.operationId);
   // Forward the untouched actual UI request. Abort only AFTER native success.
   const response=await route.fetch({maxRedirects:0,timeout});requireFact(response.status()===200&&exactPostUrl(new URL(response.url())),"REAL_POST_STATUS");
   const envelope=object(await response.json()as unknown,"POST_ENVELOPE"),data=object(envelope.data,"POST_RESULT");
   requireFact(envelope.ok===true&&typeof data.revisionId==="string"&&uuid.test(data.revisionId),"REAL_POST_RESULT");
   if(bodies.length===1){requireFact(data.duplicate===false,"INITIAL_POST_NOT_NEW");revisionId=data.revisionId;await route.abort("failed");}
   else{requireFact(data.duplicate===true&&data.revisionId===revisionId,"REAL_REPLAY_REQUIRED");await route.fulfill({response});}
  }catch(error){handlerError=error instanceof Error?error:Error("FISHING_CLASSROOM_JOURNEY_INTERCEPT_FAILED");await route.abort("failed").catch(()=>undefined);}
  finally{completed++;}
 };
 // Retain settled work until cleanup so failures during removal are not lost.
 const handler=(route:Route)=>{const work=handle(route);pending.add(work);void work.catch(()=>undefined);return work;};
 const intercepted=async(count:number)=>{await expect.poll(()=>completed,{timeout}).toBe(count);if(handlerError)throw handlerError;};
 await page.route(exactPostUrl,handler);
 let primaryFailure=false;
 try{
  await submit().click();await intercepted(1);
  await expect(page.locator(".lsw-feature-page").getByRole("alert")).toContainText(t("save result is unknown","תוצאת השמירה אינה ידועה"));
  const replayRead=waitForRead(page,input.origin,lessonPath,readQuery);
  await page.getByRole("button",{name:t("Retry the same operation","ניסיון נוסף לאותה פעולה"),exact:true}).click();await intercepted(2);
  await expect(page.getByRole("status").filter({hasText:t("previously saved operation is confirmed","הפעולה שנשמרה אומתה")})).toBeVisible();
  await verifyLesson(page,await readData(replayRead),input,revisionId);await expect(submit()).toBeDisabled();
 }catch(error){primaryFailure=true;throw error;}finally{
  // Remove only this exact interception; MAIN's observers/routes remain owned.
  let cleanupFailures=0;
  try{await page.unroute(exactPostUrl,handler);}catch{cleanupFailures++;}
  while(pending.size){
   const work=[...pending];for(const item of work)pending.delete(item);
   const results=await Promise.allSettled(work);cleanupFailures+=results.filter(result=>result.status==="rejected").length;
  }
  if(cleanupFailures){
   try{console.error({code:"FISHING_CLASSROOM_JOURNEY_CLEANUP_FAILED",count:cleanupFailures,primaryFailure});}catch{/* Reporting must not replace the primary failure. */}
   if(!primaryFailure)throw Error("FISHING_CLASSROOM_JOURNEY_CLEANUP_FAILED");
  }
 }
 requireFact(bodies.length===2&&bodies[0]===bodies[1]&&operations[0]===operations[1],"EXACT_TWO_ATTEMPTS");
 const reloadRead=waitForRead(page,input.origin,lessonPath,readQuery);await page.reload();await expect(page).toHaveURL(input.origin+lessonHref,{timeout});
 await verifyLesson(page,await readData(reloadRead),input,revisionId);await expect(submit()).toBeDisabled();

 let freshCalls=0;
 await ports.withFreshParentContext(async fresh=>{
  requireFact(++freshCalls===1&&fresh!==page&&fresh.context()!==page.context(),"SEPARATE_PARENT_CONTEXT");
  const freshRead=waitForRead(fresh,input.origin,lessonPath,readQuery);
  await ports.ordinaryParentLogin(fresh,lessonHref,input.locale);await expect(fresh).toHaveURL(input.origin+lessonHref,{timeout});
  await verifyLesson(fresh,await readData(freshRead),input,revisionId);
  await expect(fresh.getByRole("button",{name:t("Submit my work","שליחת העבודה שלי"),exact:true})).toBeDisabled();
 });
 requireFact(freshCalls===1,"FRESH_PARENT_READ_REQUIRED");
 // Do not repair lost Back state by selecting the learner/stage again.
 const backContext=waitForRead(page,input.origin,contextPath),backPlan=waitForRead(page,input.origin,planPath);
 await page.goBack();await expect(page).toHaveURL(chooserUrl,{timeout});contextData(await readData(backContext),input.learnerId,input);
 requireFact(planHref(await readData(backPlan),input)===lessonHref,"BACK_LESSON_CONTEXT");
 await expect(learner).toHaveValue(input.learnerId);await expect(stage).toHaveValue(input.enrollmentId);await expect(link).toHaveAttribute("href",lessonHref);
 return {lessonHref,operationId:operations[0]!,revisionId,questionCount:input.questions.length,postCount:2,freshContextRead:true,backContextRead:true};
}
