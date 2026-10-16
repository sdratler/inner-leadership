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

/** Deferred synthetic mechanics only; no curriculum/public-classroom approval. */
export type FishingFollowupCheckpoint="calendar-final"|"portfolio-before"|"instructor-review"|"portfolio-unpublished"|"portfolio-published";
export type FishingFollowupPorts=Pick<FishingClassroomJourneyPorts,"page"|"ordinaryParentLogin">&{
 ordinaryInstructorLogin:FishingClassroomJourneyPorts["ordinaryParentLogin"];
 /** ROOT creates/closes a distinct initially unauthenticated context each time,
  * awaits work, propagates failures, and owns checkpoint-specific evidence. */
 withFreshContext(role:"parent"|"practitioner",checkpoint:FishingFollowupCheckpoint,work:(page:Page)=>Promise<void>):Promise<void>;
};
type FishingFollowupCommon=Pick<FishingClassroomJourneyInput,"origin"|"locale"|"learnerId"|"enrollmentId"|"forbiddenContent">&{
 fixture:"SYNTHETIC_DEFERRED_MECHANICS_ONLY";
};
type FishingFollowupOccurrence={occurrenceId:string;moduleId:string;version:string;ordinal:number};
export type FishingCalendarFinalParentReadbackInput=FishingFollowupCommon&{
 scheduleHref:string;reference:{cohortId:string;stageId:string;stage:1|2|3|4};expectedStageRevision:number;
 completed:FishingFollowupOccurrence;cancelled:FishingFollowupOccurrence;
 attendance:{occurrenceId:string;state:"present"|"late"|"absent"|"no_show"};
};
export type FishingCalendarFinalParentReadbackReceipt={stageRevision:number;completedOccurrenceId:string;cancelledOccurrenceId:string;
 freshParentRead:true;attendanceEvidence:"PAGE_GET_ONLY_NO_VISIBLE_ATTENDANCE_UI"};
export type FishingClassroomPublishedProgressInput={
 fixture:"SYNTHETIC_DEFERRED_MECHANICS_ONLY";lesson:FishingClassroomJourneyInput;submission:FishingClassroomJourneyReceipt;
 instructorAccountId:string;parentAccountId:string;sourceSha256:string;
 observation:{task:string;assistance:"not_observed"|"with_guidance"|"independent";privateNote:string};summary:string;
};
export type FishingClassroomPublishedProgressReceipt={submissionId:string;observationId:string;publicationId:string;
 sourceSha256:string;questionCount:3;observedUiWrites:2;unpublishedAfterObservation:true;freshParentRead:true};
function followupRequire(value:unknown,code:string):asserts value{if(!value)throw Error("FISHING_FOLLOWUP_"+code);}
function followupObject(value:unknown,keys:readonly string[],code:string):Record<string,unknown>{
 followupRequire(value!==null&&typeof value==="object"&&!Array.isArray(value),code);const result=value as Record<string,unknown>;
 followupRequire(Object.keys(result).length===keys.length&&keys.every(key=>Object.hasOwn(result,key)),code);return result;
}
function followupArray(value:unknown,code:string,max=1000):unknown[]{followupRequire(Array.isArray(value)&&value.length<=max,code);return value;}
function followupText(value:unknown,code:string):asserts value is string{followupRequire(typeof value==="string"&&value.trim()===value&&value.length>0&&value.length<=2000,code);}
function followupDate(value:unknown){return typeof value==="string"&&/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));}
function followupCommon(input:FishingFollowupCommon){
 followupRequire(input.fixture==="SYNTHETIC_DEFERRED_MECHANICS_ONLY","SYNTHETIC_FIXTURE_REQUIRED");
 let url:URL;try{url=new URL(input.origin);}catch{throw Error("FISHING_FOLLOWUP_ORIGIN");}
 followupRequire(url.origin===input.origin&&url.protocol==="https:"&&["localhost","127.0.0.1"].includes(url.hostname)&&Number(url.port)>=1024&&!url.username&&!url.password,"ORIGIN");
 followupRequire(["en","he"].includes(input.locale)&&uuid.test(input.learnerId)&&uuid.test(input.enrollmentId),"CONTEXT_INPUT");
 followupRequire(Array.isArray(input.forbiddenContent)&&input.forbiddenContent.length>0&&input.forbiddenContent.length<=20,"CANARIES_REQUIRED");
 for(const value of input.forbiddenContent)followupText(value,"CANARY_INPUT");
}
function followupSafe(value:unknown,canaries:readonly string[]){
 if(typeof value==="string")followupRequire(canaries.every(marker=>!value.includes(marker)),"PRIVATE_RESPONSE");
 else if(Array.isArray(value))for(const item of value)followupSafe(item,canaries);
 else if(value!==null&&typeof value==="object")for(const [key,item]of Object.entries(value)){followupSafe(key,canaries);followupSafe(item,canaries);}
}
function followupCalendarPrivacy(value:unknown){
 if(Array.isArray(value))for(const item of value)followupCalendarPrivacy(item);
 else if(value!==null&&typeof value==="object")for(const [key,item]of Object.entries(value)){
  followupRequire(!["privateNote","teacher","teacherKey","observations","summaryRecipients","answers","emailCiphertext","ciphertext","paidCents","termsAcceptanceId"].includes(key),"CALENDAR_PRIVATE_FIELDS");followupCalendarPrivacy(item);
 }
}
async function followupVisibleSafe(page:Page,canaries:readonly string[]){const text=await page.locator("body").innerText();followupRequire(canaries.every(marker=>!text.includes(marker)),"PRIVATE_VISIBLE_CONTENT");}
/** Own listener only. Attach before action, settle on failure, and preserve the
 * primary thrown value if removing this listener also fails. No route rewriting. */
async function followupResponse(page:Page,origin:string,path:string,method:"GET"|"POST",entries:readonly (readonly [string,string])[],action:()=>Promise<unknown>){
 let resolve!:(response:Response)=>void,reject!:(error:Error)=>void,settled=false,primary=false;
 const pending=new Promise<Response>((yes,no)=>{resolve=yes;reject=no;});void pending.catch(()=>undefined);
 const listener=(response:Response)=>{
  try{const request=response.request(),url=new URL(response.url());
   if(!settled&&request.method()===method&&request.frame()===page.mainFrame()&&url.origin===origin&&url.pathname===path&&exactQuery(url,entries)){
    settled=true;resolve(response);
   }
  }catch{/* Other frames and unrelated responses do not satisfy readiness. */}
 };
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{page.on("response",listener);timer=setTimeout(()=>{if(!settled){settled=true;reject(Error("FISHING_FOLLOWUP_RESPONSE_TIMEOUT"));}},timeout);
  await action();return await pending;
 }catch(error){primary=true;throw error;}finally{
  clearTimeout(timer);if(!settled){settled=true;reject(Error("FISHING_FOLLOWUP_RESPONSE_CANCELLED"));}
  try{page.off("response",listener);}catch{
   try{console.error({code:"FISHING_FOLLOWUP_LISTENER_CLEANUP_FAILED",count:1,primaryFailure:primary});}catch{/* Preserve the primary value. */}
   if(!primary)throw Error("FISHING_FOLLOWUP_LISTENER_CLEANUP_FAILED");
  }
 }
}
async function followupData(response:Response){
 followupRequire(response.status()===200&&await response.finished()===null,"REAL_RESPONSE_REQUIRED");
 let json:unknown;try{json=await response.json();}catch{throw Error("FISHING_FOLLOWUP_RESPONSE_JSON");}
 const envelope=followupObject(json,["ok","data","requestId"],"ENVELOPE");followupRequire(envelope.ok===true&&typeof envelope.requestId==="string"&&uuid.test(envelope.requestId),"ENVELOPE");
 followupRequire(envelope.data!==null&&typeof envelope.data==="object"&&!Array.isArray(envelope.data),"DATA");return envelope.data as Record<string,unknown>;
}
async function followupRead(page:Page,origin:string,path:string,entries:readonly (readonly [string,string])[],action:()=>Promise<unknown>){return followupData(await followupResponse(page,origin,path,"GET",entries,action));}
async function followupContext<T>(ports:FishingFollowupPorts,seen:Set<object>,role:"parent"|"practitioner",checkpoint:FishingFollowupCheckpoint,work:(page:Page)=>Promise<T>):Promise<T>{
 let calls=0,completed=false,failed=false,primary:unknown,result:T|undefined;
 try{await ports.withFreshContext(role,checkpoint,async page=>{
  try{followupRequire(++calls===1&&page!==ports.page&&!seen.has(page.context())&&page.url()==="about:blank","FRESH_CONTEXT_REQUIRED");seen.add(page.context());
   result=await work(page);completed=true;
  }catch(error){failed=true;primary=error;throw error;}
 });}catch(error){if(failed)throw primary;throw error;}
 if(failed)throw primary;followupRequire(calls===1&&completed,"CONTEXT_CALLBACK_REQUIRED");return result as T;
}
function followupCalendarInput(input:FishingCalendarFinalParentReadbackInput){
 followupObject(input,["fixture","origin","locale","learnerId","enrollmentId","forbiddenContent","scheduleHref","reference","expectedStageRevision","completed","cancelled","attendance"],"CALENDAR_INPUT");followupCommon(input);
 followupObject(input.reference,["cohortId","stageId","stage"],"STAGE_INPUT");
 followupRequire(uuid.test(input.reference.cohortId)&&uuid.test(input.reference.stageId)&&[1,2,3,4].includes(input.reference.stage)&&Number.isSafeInteger(input.expectedStageRevision)&&input.expectedStageRevision>0,"STAGE_INPUT");
 for(const occurrence of[input.completed,input.cancelled]){
  followupObject(occurrence,["occurrenceId","moduleId","version","ordinal"],"OCCURRENCE_INPUT");followupText(occurrence.version,"VERSION_INPUT");
  followupRequire(uuid.test(occurrence.occurrenceId)&&Number.isInteger(occurrence.ordinal)&&occurrence.ordinal>=1&&occurrence.ordinal<=12&&occurrence.moduleId===`RM-${input.reference.stage}${String(occurrence.ordinal).padStart(2,"0")}`,"OCCURRENCE_INPUT");
 }
 followupRequire(input.completed.occurrenceId!==input.cancelled.occurrenceId&&input.completed.ordinal!==input.cancelled.ordinal,"SEPARATE_OCCURRENCES");
 followupObject(input.attendance,["occurrenceId","state"],"ATTENDANCE_INPUT");followupRequire(input.attendance.occurrenceId===input.completed.occurrenceId&&["present","late","absent","no_show"].includes(input.attendance.state),"ATTENDANCE_INPUT");
 const entries=[["cohortId",input.reference.cohortId],["stageId",input.reference.stageId],["stage",String(input.reference.stage)],["learnerId",input.learnerId],["enrollmentId",input.enrollmentId]]as const;
 followupRequire(typeof input.scheduleHref==="string"&&input.scheduleHref.startsWith(`/${input.locale}/family/schedule?`)&&!/[\\\u0000-\u0020]/.test(input.scheduleHref),"SCHEDULE_HREF");
 const url=new URL(input.scheduleHref,input.origin),date=url.searchParams.get("date")??"",view=url.searchParams.get("view");
 followupRequire(url.origin===input.origin&&url.pathname===`/${input.locale}/family/schedule`&&!url.hash&&/^\d{4}-\d{2}-\d{2}$/.test(date)&&Number.isFinite(Date.parse(date+"T12:00:00Z"))&&new Date(date+"T12:00:00Z").toISOString().slice(0,10)===date&&["day","week","month","agenda"].includes(view??""),"SCHEDULE_HREF");
 followupRequire(exactQuery(url,[...entries,["date",date],["view",view!],...(url.searchParams.has("fishing")?[["fishing","1"]as const]:[])]),"EXACT_SCHEDULE_CONTEXT");return entries;
}
export async function verifyFishingCalendarFinalParentReadback(ports:FishingFollowupPorts,input:FishingCalendarFinalParentReadbackInput):Promise<FishingCalendarFinalParentReadbackReceipt>{
 const entries=followupCalendarInput(input),seen=new Set<object>([ports.page.context()]),t=(en:string,he:string)=>input.locale==="he"?he:en;
 return followupContext(ports,seen,"parent","calendar-final",async page=>{
  let context:Record<string,unknown>|undefined;
  const plan=await followupRead(page,input.origin,planPath,entries,async()=>{context=await followupRead(page,input.origin,contextPath,[["learnerId",input.learnerId]],()=>ports.ordinaryParentLogin(page,input.scheduleHref,input.locale));});
  const expectedUrl=new URL(input.origin+input.scheduleHref);
  const queryEntries=(url:URL)=>[...url.searchParams.entries()].sort(([keyA,valueA],[keyB,valueB])=>keyA.localeCompare(keyB)||valueA.localeCompare(valueB));
  await expect(page).toHaveURL(actual=>actual.origin===expectedUrl.origin&&actual.pathname===expectedUrl.pathname&&actual.hash===expectedUrl.hash&&JSON.stringify(queryEntries(actual))===JSON.stringify(queryEntries(expectedUrl)),{timeout});
  followupObject(context,["availability","role","children","selectedLearnerId","stages"],"CALENDAR_CONTEXT");contextData(context!,input.learnerId,{...input,moduleId:input.completed.moduleId,version:input.completed.version,questions:[]});
  followupRequire(followupArray(context!.stages,"CONTEXT_STAGES").some(value=>{const stage=object(value,"CONTEXT_STAGE");return stage.enrollmentId===input.enrollmentId&&stage.learnerId===input.learnerId&&Object.entries(input.reference).every(([key,item])=>stage[key]===item);}),"CONTEXT_STAGE_BINDING");
  followupObject(plan,["selection","choice","view","operator","lessonLearnerId","lessonLinks"],"CALENDAR_PLAN");
  const selection=followupObject(plan.selection,["learnerId","enrollmentId","reference"],"CALENDAR_SELECTION"),reference=followupObject(selection.reference,["cohortId","stageId","stage"],"CALENDAR_REFERENCE");
  followupRequire(selection.learnerId===input.learnerId&&selection.enrollmentId===input.enrollmentId&&Object.entries(input.reference).every(([key,value])=>reference[key]===value)&&plan.lessonLearnerId===input.learnerId,"CALENDAR_SELECTION");
  const choice=followupObject(plan.choice,["cohortId","stageId","stage","label","enrollmentId","learnerId","templateVersion","childCapacity"],"CALENDAR_CHOICE");
  followupRequire(choice.enrollmentId===input.enrollmentId&&choice.learnerId===input.learnerId&&Object.entries(input.reference).every(([key,value])=>choice[key]===value),"CALENDAR_CHOICE");
  const view=followupObject(plan.view,["cohortId","stageId","stage","revision","role","enrollmentId","occurrences","nextOccurrenceId","notices","attendance","lessonReferences"],"CALENDAR_VIEW");
  followupRequire(view.role==="parent"&&view.enrollmentId===input.enrollmentId&&view.revision===input.expectedStageRevision&&Object.entries(input.reference).every(([key,value])=>view[key]===value),"FINAL_STAGE_REVISION");
  const operator=followupObject(plan.operator,["venues","roster","makeupNotices","makeupFits"],"OPERATOR_PROJECTION");for(const value of Object.values(operator))followupRequire(followupArray(value,"OPERATOR_PROJECTION").length===0,"OPERATOR_PROJECTION");
  const occurrences=followupArray(view.occurrences,"OCCURRENCES",12).map(value=>object(value,"OCCURRENCE"));
  followupRequire(new Set(occurrences.map(value=>value.id)).size===occurrences.length&&occurrences.every(value=>value.state!=="draft"),"OCCURRENCES");
  for(const [expected,state]of[[input.completed,"completed"],[input.cancelled,"cancelled"]]as const){
   const matches=occurrences.filter(value=>value.id===expected.occurrenceId);followupRequire(matches.length===1,"FINAL_OCCURRENCE");const actual=matches[0]!;
   followupRequire(actual.state===state&&actual.ordinal===expected.ordinal&&actual.moduleId===expected.moduleId&&actual.moduleVersion===expected.version&&Object.entries(input.reference).every(([key,value])=>actual[key]===value),"FINAL_OCCURRENCE");
   followupRequire(followupArray(actual.allowedActions,"PARENT_ACTIONS").every(value=>["read","report_absence","request_makeup"].includes(String(value))),"PARENT_ACTIONS");
  }
  const attendance=followupArray(view.attendance,"ATTENDANCE",1);followupRequire(attendance.length===1,"ATTENDANCE");
  const fact=followupObject(attendance[0],["enrollmentId","occurrenceId","state","recordedAt"],"ATTENDANCE");
  followupRequire(fact.enrollmentId===input.enrollmentId&&fact.occurrenceId===input.attendance.occurrenceId&&fact.state===input.attendance.state&&followupDate(fact.recordedAt),"ATTENDANCE");
  followupCalendarPrivacy({context,plan});followupSafe({context,plan},input.forbiddenContent);
  await expect(page.getByLabel(t("Authorized child","ילד מורשה"),{exact:true})).toHaveValue(input.learnerId);await expect(page.getByLabel(t("Stage enrollment","רישום לשלב"),{exact:true})).toHaveValue(input.enrollmentId);
  await expect(page.getByRole("button",{name:t("Manage this stage","ניהול השלב"),exact:true})).toHaveCount(0);
  const summary=page.getByText(t("Full twelve-session plan and received notices","התוכנית המלאה ל־12 מפגשים והדיווחים שהתקבלו"),{exact:true});if(await summary.locator("..").getAttribute("open")===null)await summary.click();
  const region=page.getByRole("region",{name:t("Fishing stage plan","תוכנית שלב הדיג"),exact:true});await expect(region).toBeVisible();
  for(const [expected,label]of[[input.completed,t("Session delivered","המפגש התקיים")],[input.cancelled,t("Cancelled — service remains undelivered","בוטל — השירות טרם סופק")]]as const){
   const row=region.locator("li").filter({has:page.getByRole("heading",{name:`${t("Session","מפגש")} ${expected.ordinal} · ${expected.moduleId}`,exact:true})});await expect(row).toHaveCount(1);await expect(row.getByText(label,{exact:true})).toBeVisible();
  }
  await followupVisibleSafe(page,input.forbiddenContent);
  return {stageRevision:input.expectedStageRevision,completedOccurrenceId:input.completed.occurrenceId,cancelledOccurrenceId:input.cancelled.occurrenceId,freshParentRead:true,attendanceEvidence:"PAGE_GET_ONLY_NO_VISIBLE_ATTENDANCE_UI"};
 });
}
function followupProgressInput(input:FishingClassroomPublishedProgressInput){
 followupObject(input,["fixture","lesson","submission","instructorAccountId","parentAccountId","sourceSha256","observation","summary"],"PROGRESS_INPUT");
 followupObject(input.lesson,["origin","locale","learnerId","enrollmentId","moduleId","version","questions","forbiddenContent"],"LESSON_INPUT");followupCommon({...input.lesson,fixture:input.fixture});verifyInput(input.lesson);
 followupRequire(input.lesson.moduleId==="RM-101"&&input.lesson.version==="synthetic-lesson-v1"&&input.lesson.questions.length===3,"EXISTING_SYNTHETIC_THREE_QUESTION_LESSON");
 for(const question of input.lesson.questions)followupObject(question,["id","prompt","answer"],"QUESTION_INPUT");
 followupRequire(uuid.test(input.instructorAccountId)&&uuid.test(input.parentAccountId)&&input.instructorAccountId!==input.parentAccountId&&/^[a-f0-9]{64}$/.test(input.sourceSha256),"ACTOR_SOURCE_INPUT");
 followupObject(input.submission,["lessonHref","operationId","revisionId","questionCount","postCount","freshContextRead","backContextRead"],"SUBMISSION_RECEIPT");
 const saved=input.submission,lesson=input.lesson;
 followupRequire(uuid.test(saved.operationId)&&uuid.test(saved.revisionId)&&saved.questionCount===3&&saved.postCount===2&&saved.freshContextRead===true&&saved.backContextRead===true,"SUBMISSION_RECEIPT");
 followupRequire(typeof saved.lessonHref==="string"&&saved.lessonHref.startsWith(`/${lesson.locale}/family/resources?`)&&!/[\\\u0000-\u0020]/.test(saved.lessonHref),"SAVED_LESSON_HREF");
 const url=new URL(saved.lessonHref,lesson.origin);followupRequire(url.origin===lesson.origin&&url.pathname===`/${lesson.locale}/family/resources`&&exactQuery(url,[["education","lesson"],["learnerId",lesson.learnerId],["moduleId",lesson.moduleId],["version",lesson.version],["section","lesson"]]),"SAVED_LESSON_HREF");
 followupObject(input.observation,["task","assistance","privateNote"],"OBSERVATION_INPUT");followupText(input.observation.task,"TASK_INPUT");followupText(input.observation.privateNote,"PRIVATE_NOTE_INPUT");followupText(input.summary,"SUMMARY_INPUT");
 followupRequire(["not_observed","with_guidance","independent"].includes(input.observation.assistance),"ASSISTANCE_INPUT");
 const privateValues=[...lesson.forbiddenContent,input.observation.privateNote,...lesson.questions.map(q=>q.answer.trim())];followupSafe(input.summary,privateValues);return privateValues;
}
function followupLessonQuery(input:FishingClassroomPublishedProgressInput,view:"teacher"|"parent"){const lesson=input.lesson;return [["learnerId",lesson.learnerId],["moduleId",lesson.moduleId],["version",lesson.version],["view",view]]as const;}
function followupLessonHref(input:FishingClassroomPublishedProgressInput,section:"review"|"portfolio"){const url=new URL(input.submission.lessonHref,input.lesson.origin);url.pathname=`/${input.lesson.locale}/${section==="review"?"app":"family"}/resources`;url.searchParams.set("section",section);return url.pathname+url.search;}
function followupTeacher(data:Record<string,unknown>,input:FishingClassroomPublishedProgressInput,revisionId:string,observation?:{revisionId:string;operationId:string}){
 followupObject(data,["lesson","revisionId","submission","observations","summaryRecipients"],"TEACHER_READ");
 const lesson=followupObject(data.lesson,["moduleId","version","stage","locale","title","instruction","questions","sourceSha256"],"TEACHER_LESSON");
 followupRequire(lesson.moduleId===input.lesson.moduleId&&lesson.version===input.lesson.version&&lesson.sourceSha256===input.sourceSha256&&lesson.stage===1&&["en","he"].includes(String(lesson.locale))&&data.revisionId===revisionId,"TEACHER_CONTEXT");
 const questions=followupArray(lesson.questions,"TEACHER_QUESTIONS",3);followupRequire(questions.length===3,"TEACHER_QUESTIONS");
 for(const [index,question]of input.lesson.questions.entries()){const actual=followupObject(questions[index],["id","prompt"],"TEACHER_QUESTION");followupRequire(actual.id===question.id&&actual.prompt===question.prompt,"TEACHER_QUESTION");}
 const submission=followupObject(data.submission,["revisionId","answers","submittedAt","submittedBy","assistedBy"],"TEACHER_SUBMISSION");
  followupRequire(submission.revisionId===input.submission.revisionId&&submission.submittedBy===input.parentAccountId&&submission.assistedBy===input.parentAccountId&&followupDate(submission.submittedAt),"TEACHER_SUBMISSION");
  for(const answer of followupArray(submission.answers,"TEACHER_ANSWERS",3))followupObject(answer,["questionId","value"],"TEACHER_ANSWER");verifyAnswers(submission.answers,input.lesson,true);
 const observations=followupArray(data.observations,"OBSERVATIONS",1);followupRequire(observations.length===(observation?1:0),"OBSERVATIONS");
 if(observation){const event=followupObject(observations[0],["id","operationId","digest","previousRevisionId","workspaceId","learnerId","moduleId","version","sourceSha256","actorId","actorRole","at","command"],"OBSERVATION_READ");
  followupRequire(event.id===observation.revisionId&&event.operationId===observation.operationId&&event.previousRevisionId===input.submission.revisionId&&event.actorId===input.instructorAccountId&&event.actorRole==="practitioner"&&event.learnerId===input.lesson.learnerId&&event.moduleId===input.lesson.moduleId&&event.version===input.lesson.version&&event.sourceSha256===input.sourceSha256&&typeof event.workspaceId==="string"&&uuid.test(event.workspaceId)&&typeof event.digest==="string"&&/^[a-f0-9]{64}$/.test(event.digest)&&followupDate(event.at),"OBSERVATION_READ");
  const command=followupObject(event.command,["action","operationId","expectedRevisionId","submissionId","task","assistance","privateNote"],"OBSERVATION_COMMAND");
  followupRequire(command.action==="observe"&&command.operationId===observation.operationId&&command.expectedRevisionId===input.submission.revisionId&&command.submissionId===input.submission.revisionId&&Object.entries(input.observation).every(([key,value])=>command[key]===value),"OBSERVATION_COMMAND");
 }
 const recipients=followupArray(data.summaryRecipients,"SUMMARY_RECIPIENTS",10).map(value=>followupObject(value,["accountId","label"],"SUMMARY_RECIPIENT"));
 followupRequire(new Set(recipients.map(recipient=>recipient.accountId)).size===recipients.length&&recipients.every(recipient=>typeof recipient.accountId==="string"&&uuid.test(recipient.accountId)&&typeof recipient.label==="string"&&recipient.label.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient.label)),"SUMMARY_RECIPIENTS");
 const recipient=recipients.filter(value=>value.accountId===input.parentAccountId);followupRequire(recipient.length===1,"EXACT_AUTHORIZED_RECIPIENT");
 followupSafe(data,input.lesson.forbiddenContent);return {label:recipient[0]!.label as string,recipients};
}
async function followupWrite(page:Page,input:FishingClassroomPublishedProgressInput,expected:Record<string,unknown>,action:()=>Promise<unknown>){
 const response=await followupResponse(page,input.lesson.origin,lessonPath,"POST",[],action),request=response.request();
 followupRequire(request.redirectedFrom()===null,"DIRECT_UI_WRITE_REQUIRED");const body=request.postData();followupRequire(body!==null,"UI_POST_BODY");
 let json:unknown;try{json=JSON.parse(body);}catch{throw Error("FISHING_FOLLOWUP_UI_POST_BODY");}
 const payload=followupObject(json,["reference","command"],"UI_POST_BODY"),reference=followupObject(payload.reference,["learnerId","moduleId","version"],"UI_POST_REFERENCE");
 followupRequire(reference.learnerId===input.lesson.learnerId&&reference.moduleId===input.lesson.moduleId&&reference.version===input.lesson.version,"UI_POST_REFERENCE");
 const command=followupObject(payload.command,["operationId",...Object.keys(expected)],"UI_POST_COMMAND");
 followupRequire(typeof command.operationId==="string"&&uuid.test(command.operationId)&&command.operationId!==input.submission.operationId&&Object.entries(expected).every(([key,value])=>JSON.stringify(command[key])===JSON.stringify(value)),"UI_POST_COMMAND");
 const data=followupObject(await followupData(response),["revisionId","duplicate"],"UI_POST_RESULT");
 followupRequire(typeof data.revisionId==="string"&&uuid.test(data.revisionId)&&data.duplicate===false,"UI_POST_RESULT");return {revisionId:data.revisionId,operationId:command.operationId};
}
async function followupPortfolio(ports:FishingFollowupPorts,seen:Set<object>,input:FishingClassroomPublishedProgressInput,canaries:readonly string[],checkpoint:"portfolio-before"|"portfolio-unpublished"|"portfolio-published",publicationId?:string){
 await followupContext(ports,seen,"parent",checkpoint,async page=>{
  const href=followupLessonHref(input,"portfolio"),data=await followupRead(page,input.lesson.origin,lessonPath,followupLessonQuery(input,"parent"),()=>ports.ordinaryParentLogin(page,href,input.lesson.locale));
  await expect(page).toHaveURL(input.lesson.origin+href,{timeout});followupObject(data,["moduleId","version","portfolio"],"PARENT_PROJECTION");
  followupRequire(data.moduleId===input.lesson.moduleId&&data.version===input.lesson.version,"PARENT_CONTEXT");
  const panel=page.locator("#education-panel");await expect(panel).toBeVisible();await expect(panel.locator("textarea")).toHaveCount(0);
  if(publicationId){const portfolio=followupObject(data.portfolio,["revisionId","summary","publishedAt","sourceSha256"],"PUBLISHED_PORTFOLIO");
   followupRequire(portfolio.revisionId===publicationId&&portfolio.summary===input.summary&&portfolio.sourceSha256===input.sourceSha256&&followupDate(portfolio.publishedAt),"PUBLISHED_PORTFOLIO");await expect(panel.getByText(input.summary,{exact:true})).toBeVisible();
  }else{followupRequire(data.portfolio===null,"UNPUBLISHED_PORTFOLIO");await expect(panel.getByText(input.lesson.locale==="he"?"טרם פורסם עבורכם סיכום לשיעור זה.":"No summary has been published for you for this lesson.",{exact:true})).toBeVisible();}
  followupSafe(data,canaries);await followupVisibleSafe(page,canaries);
 });
}
export async function runFishingClassroomPublishedProgressJourney(ports:FishingFollowupPorts,input:FishingClassroomPublishedProgressInput):Promise<FishingClassroomPublishedProgressReceipt>{
 const privateValues=followupProgressInput(input),seen=new Set<object>([ports.page.context()]),t=(en:string,he:string)=>input.lesson.locale==="he"?he:en;
 await followupPortfolio(ports,seen,input,privateValues,"portfolio-before");
 return followupContext(ports,seen,"practitioner","instructor-review",async page=>{
  const href=followupLessonHref(input,"review"),query=followupLessonQuery(input,"teacher");
  const initial=await followupRead(page,input.lesson.origin,lessonPath,query,()=>ports.ordinaryInstructorLogin(page,href,input.lesson.locale));await expect(page).toHaveURL(input.lesson.origin+href,{timeout});followupTeacher(initial,input,input.submission.revisionId);
  await followupVisibleSafe(page,input.lesson.forbiddenContent);
  const submitted=page.getByText(t("Submitted learner work","עבודה שהוגשה"),{exact:true});if(await submitted.locator("..").getAttribute("open")===null)await submitted.click();
  for(const question of input.lesson.questions)await expect(page.locator("#education-panel").getByText(question.answer.trim(),{exact:true})).toBeVisible();
  await page.getByLabel(t("Observed task","המשימה שנצפתה"),{exact:true}).fill(input.observation.task);await page.getByLabel(t("Assistance","סיוע"),{exact:true}).selectOption(input.observation.assistance);
  const privateNote=page.getByText(t("Optional private note","הערה פרטית אופציונלית"),{exact:true});if(await privateNote.locator("..").getAttribute("open")===null)await privateNote.click();await page.getByLabel(t("Private teacher note","הערת מדריך פרטית"),{exact:true}).fill(input.observation.privateNote);
  let observed:{revisionId:string;operationId:string}|undefined;
  const afterObserve=await followupRead(page,input.lesson.origin,lessonPath,query,async()=>{observed=await followupWrite(page,input,{action:"observe",expectedRevisionId:input.submission.revisionId,submissionId:input.submission.revisionId,...input.observation},()=>page.getByRole("button",{name:t("Save private observation","שמירת תצפית פרטית"),exact:true}).click());});
  followupRequire(observed&&observed.revisionId!==input.submission.revisionId,"NEW_OBSERVATION_REQUIRED");const observation=observed;followupTeacher(afterObserve,input,observation.revisionId,observation);
  await expect(page.getByRole("status").filter({hasText:t("Saved in the app","נשמר במערכת")})).toBeVisible();
  const reloaded=await followupRead(page,input.lesson.origin,lessonPath,query,()=>page.reload());followupTeacher(reloaded,input,observation.revisionId,observation);
  const history=page.getByText(t("Previous private observations","תצפיות פרטיות קודמות"),{exact:true});if(await history.locator("..").getAttribute("open")===null)await history.click();await expect(page.locator("#education-panel").getByText(input.observation.privateNote,{exact:true})).toBeVisible();
  await followupVisibleSafe(page,input.lesson.forbiddenContent);
  await followupPortfolio(ports,seen,input,privateValues,"portfolio-unpublished");
  const publishing=await followupRead(page,input.lesson.origin,lessonPath,query,()=>page.getByRole("tab",{name:t("Publish summary","פרסום סיכום"),exact:true}).click());const recipient=followupTeacher(publishing,input,observation.revisionId,observation);
  await page.getByLabel(t("Parent-safe summary","סיכום המתאים להורה"),{exact:true}).fill(input.summary);
  const publish=page.getByRole("button",{name:t("Publish selected summary","פרסום הסיכום שנבחר"),exact:true});await expect(publish).toBeDisabled();
  for(const candidate of recipient.recipients)await expect(page.getByLabel(candidate.label as string,{exact:true})).not.toBeChecked();
  await page.getByLabel(recipient.label,{exact:true}).check();await expect(publish).toBeEnabled();
  let published:{revisionId:string;operationId:string}|undefined;
  const afterPublish=await followupRead(page,input.lesson.origin,lessonPath,query,async()=>{published=await followupWrite(page,input,{action:"publish_parent_summary",expectedRevisionId:observation.revisionId,observationId:observation.revisionId,summary:input.summary,parentAccountIds:[input.parentAccountId]},()=>publish.click());});
  followupRequire(published&&published.revisionId!==observation.revisionId&&published.revisionId!==input.submission.revisionId&&published.operationId!==observation.operationId,"NEW_PUBLICATION_REQUIRED");const publication=published;followupTeacher(afterPublish,input,publication.revisionId,observation);
  await expect(page.getByRole("status").filter({hasText:t("Saved in the app","נשמר במערכת")})).toBeVisible();await followupVisibleSafe(page,input.lesson.forbiddenContent);await followupPortfolio(ports,seen,input,privateValues,"portfolio-published",publication.revisionId);
  return {submissionId:input.submission.revisionId,observationId:observation.revisionId,publicationId:publication.revisionId,sourceSha256:input.sourceSha256,questionCount:3,observedUiWrites:2,unpublishedAfterObservation:true,freshParentRead:true};
 });
}
