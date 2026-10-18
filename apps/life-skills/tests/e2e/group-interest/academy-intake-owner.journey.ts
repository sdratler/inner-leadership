import {expect,type Page} from "@playwright/test";

/** Root 20261018-10 successor: exact numeric drive and optional exact learner age;
 * retains historical Source03 categories and the original strict local boundary.
 * Read-only structural readback. Root supplies a fresh authorized native DTO,
 * selects its matching record and opens the details before calling this helper.
 * Neither a reference, SYNTHETIC_ONLY nor complete is authorization or enrollment.
 * Base contacts, age/gear and the legacy fit section remain Root's assertions. */
type AcademyIntakeMirroredInline={
 readonly version:"JLFA-ENROLLMENT-20261018-03-v1";
 readonly postalCode:string;
 readonly driveLimit:number|"up_to_30"|"up_to_45"|"up_to_60"|"over_60";
 readonly preferredAreas?:string|undefined;
 readonly preferredGroupLanguage:"en"|"he"|"either";
 readonly stagePreference:"foundation"|"independent"|"advanced"|"leadership"|"discuss";
 readonly keysTravel:"parent_drive"|"shuttle_interest"|"alternative"|"discuss";
 readonly offshoreInterest:"interested"|"not_interested"|"discuss";
 readonly nextStep:"enrollment_followup"|"callback";
 readonly confirmationEmail?:string|undefined;
 readonly travelNotes?:string|undefined;
 readonly learners:readonly {
  readonly ageYears?:number|undefined;
  readonly gradeBand:"grade_3_5"|"grade_6_8"|"grade_9_12"|"discuss";
  readonly schooling:"school"|"homeschool"|"discuss";
  readonly tackleBox:"ready"|"need_advice"|"not_sure";
 }[];
};
type Boundary={readonly fixture:"SYNTHETIC_ONLY";readonly origin:string};
type VerifyInput=Boundary&{
 readonly locale:"en"|"he";readonly reference:string;readonly expected:AcademyIntakeMirroredInline;
};
type Pair={label:string;value:string;bdi:boolean};
const timeout=15000;
const intakeMarker="[data-academy-intake]",learnerMarker="[data-academy-intake-learner]";

function requireInput(value:unknown):asserts value{
 if(!value)throw new Error("ACADEMY_INTAKE_INPUT_INVALID");
}
/** Capture only data properties; never retain caller objects/getters across await. */
function record(value:unknown,required:readonly string[],optional:readonly string[]=[]):Record<string,unknown>{
 requireInput(typeof value==="object"&&value!==null&&!Array.isArray(value));
 const prototype=Object.getPrototypeOf(value);
 requireInput(prototype===Object.prototype||prototype===null);
 const descriptors=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(descriptors);
 requireInput(keys.every(key=>typeof key==="string"&&(required.includes(key)||optional.includes(key))));
 requireInput(required.every(key=>Object.hasOwn(descriptors,key)));
 const copy:Record<string,unknown>=Object.create(null);
 for(const key of keys){
  requireInput(typeof key==="string");
  const descriptor=descriptors[key];
  requireInput(descriptor&&Object.hasOwn(descriptor,"value")&&descriptor.enumerable);
  copy[key]=descriptor.value;
 }
 return copy;
}
function oneOf<const T extends readonly string[]>(value:unknown,choices:T):T[number]{
 requireInput(typeof value==="string"&&choices.includes(value));return value as T[number];
}
function trimmed(value:unknown,maximum:number):string{
 requireInput(typeof value==="string"&&value.length>=1&&value.length<=maximum&&value===value.trim());return value;
}
function optionalString(value:unknown,maximum:number):string|undefined{
 return value===undefined?undefined:trimmed(value,maximum);
}
function boundarySnapshot(raw:Record<string,unknown>):Boundary{
 return Object.freeze({fixture:oneOf(raw.fixture,["SYNTHETIC_ONLY"]),
  origin:oneOf(raw.origin,["https://localhost:3105","https://localhost:3107"])});
}
function intakeSnapshot(value:unknown):AcademyIntakeMirroredInline{
 const raw=record(value,["version","postalCode","driveLimit","preferredGroupLanguage","stagePreference","keysTravel","offshoreInterest","nextStep","learners"],
  ["preferredAreas","confirmationEmail","travelNotes"]);
 if(typeof raw.driveLimit==="number")requireInput(Number.isInteger(raw.driveLimit)&&raw.driveLimit>=5&&raw.driveLimit<=120&&raw.driveLimit%5===0);
 const postalCode=trimmed(raw.postalCode,10);requireInput(/^\d{5}(?:-\d{4})?$/.test(postalCode));
 const confirmationEmail=optionalString(raw.confirmationEmail,254);
 // Frozen schema uses Zod's default email syntax and stores lowercase output.
 if(confirmationEmail!==undefined)requireInput(confirmationEmail===confirmationEmail.toLowerCase()&&
  /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-\.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/.test(confirmationEmail));
 const values=raw.learners;requireInput(Array.isArray(values)&&Object.getPrototypeOf(values)===Array.prototype);
 const descriptors=Object.getOwnPropertyDescriptors(values as object),length=descriptors.length?.value as unknown;
 requireInput(typeof length==="number"&&Number.isInteger(length)&&length>=1&&length<=10);
 requireInput(Reflect.ownKeys(descriptors).length===length+1);
 const learners=Array.from({length},(_,index)=>{
  const descriptor=descriptors[String(index)];
  requireInput(descriptor&&Object.hasOwn(descriptor,"value")&&descriptor.enumerable);
  const learner=record(descriptor.value,["gradeBand","schooling","tackleBox"],["ageYears"]);
  requireInput(learner.ageYears===undefined||(typeof learner.ageYears==="number"&&Number.isInteger(learner.ageYears)&&learner.ageYears>=0&&learner.ageYears<=17));
  return Object.freeze({...(learner.ageYears===undefined?{}:{ageYears:learner.ageYears as number}),gradeBand:oneOf(learner.gradeBand,["grade_3_5","grade_6_8","grade_9_12","discuss"]),
   schooling:oneOf(learner.schooling,["school","homeschool","discuss"]),
   tackleBox:oneOf(learner.tackleBox,["ready","need_advice","not_sure"])});
 });
 return Object.freeze({version:oneOf(raw.version,["JLFA-ENROLLMENT-20261018-03-v1"]),postalCode,
  driveLimit:typeof raw.driveLimit==="number"?raw.driveLimit:oneOf(raw.driveLimit,["up_to_30","up_to_45","up_to_60","over_60"]),
  preferredAreas:optionalString(raw.preferredAreas,160),preferredGroupLanguage:oneOf(raw.preferredGroupLanguage,["en","he","either"]),
  stagePreference:oneOf(raw.stagePreference,["foundation","independent","advanced","leadership","discuss"]),
  keysTravel:oneOf(raw.keysTravel,["parent_drive","shuttle_interest","alternative","discuss"]),
  offshoreInterest:oneOf(raw.offshoreInterest,["interested","not_interested","discuss"]),
  nextStep:oneOf(raw.nextStep,["enrollment_followup","callback"]),confirmationEmail,
  travelNotes:optionalString(raw.travelNotes,300),learners:Object.freeze(learners)});
}
function verifySnapshot(input:VerifyInput):VerifyInput{
 const raw=record(input,["fixture","origin","locale","reference","expected"]),boundary=boundarySnapshot(raw);
 const reference=trimmed(raw.reference,36);
 requireInput(/^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/i.test(reference));
 return Object.freeze({...boundary,locale:oneOf(raw.locale,["en","he"]),reference,expected:intakeSnapshot(raw.expected)});
}
function guard(page:Page,input:Boundary,locale?:"en"|"he"){
 const current=new URL(page.url());
 if(input.fixture!=="SYNTHETIC_ONLY"||!["https://localhost:3105","https://localhost:3107"].includes(input.origin)||
  current.origin!==input.origin||current.username||current.password||
  (locale!==undefined&&current.pathname!==`/${locale}/app/group-applications`))throw new Error("ACADEMY_INTAKE_PAGE_BOUNDARY");
}

/** Independently transcribed expected text; no production renderer/schema oracle. */
function presentation(input:VerifyInput){
 const t=(en:string,he:string)=>input.locale==="he"?he:en,intake=input.expected;
 const pair=(label:string,value:string,bdi=false):Pair=>({label,value,bdi});
 const drive={up_to_30:t("Up to 30 minutes","עד 30 דקות"),up_to_45:t("Up to 45 minutes","עד 45 דקות"),
  up_to_60:t("Up to 60 minutes","עד 60 דקות"),over_60:t("More than 60 minutes","יותר מ־60 דקות")};
 const language={en:t("English","אנגלית"),he:t("Hebrew","עברית"),either:t("Either language","כל אחת מהשפות")};
 const stage={foundation:t("Foundation","יסודות"),independent:t("Independent","עצמאות"),advanced:t("Advanced","מתקדמים"),
  leadership:t("Leadership","מנהיגות"),discuss:t("Discuss with me","לתיאום איתי")};
 const keys={parent_drive:t("Parent drive","נסיעה עם הורה"),shuttle_interest:t("Interested in an optional shuttle","עניין בהסעה אופציונלית"),
  alternative:t("Interested in an alternative","עניין בחלופה"),discuss:t("Discuss with me","לתיאום איתי")};
 const offshore={interested:t("Interested","מעוניינים"),not_interested:t("Not interested","לא מעוניינים"),discuss:t("Discuss with me","לתיאום איתי")};
 const grade={grade_3_5:t("Grades 3–5","כיתות ג׳–ה׳"),grade_6_8:t("Grades 6–8","כיתות ו׳–ח׳"),
  grade_9_12:t("Grades 9–12","כיתות ט׳–י״ב"),discuss:t("Discuss with me","לתיאום איתי")};
 const schooling={school:t("Attends school","לומד בבית ספר"),homeschool:t("Homeschool","חינוך ביתי"),discuss:t("Discuss with me","לתיאום איתי")};
 const tackle={ready:t("Has a personal tackle box","יש ארגז ציוד אישי"),need_advice:t("Needs tackle-box advice","נדרשת הכוונה לארגז ציוד"),not_sure:t("Not sure","לא בטוח/ה")};
 return {origin:input.origin,locale:input.locale,reference:input.reference,path:`/${input.locale}/app/group-applications`,
  summary:t("Application preferences","העדפות הפנייה"),learnerLabel:t("Learner preferences","העדפות הלומדים"),
  fields:[
   pair(t("Next step","הצעד הבא"),intake.nextStep==="callback"?t("Request a callback","בקשה לשיחה חוזרת"):t("Continue toward enrollment — request only","המשך לקראת הרשמה — בקשה בלבד")),
   pair(t("ZIP code","מיקוד"),intake.postalCode,true),
   pair(t("Maximum normal one-way drive","נסיעה רגילה מרבית לכיוון אחד"),typeof intake.driveLimit==="number"?t(`Up to ${intake.driveLimit} minutes`,`עד ${intake.driveLimit} דקות`):drive[intake.driveLimit]),
   pair(t("Preferred areas","אזורים מועדפים"),intake.preferredAreas??t("Not specified","לא נמסר")),
   pair(t("Preferred group language","שפה מועדפת לקבוצה"),language[intake.preferredGroupLanguage]),
   pair(t("Stage interest — not placement","עניין בשלב — לא שיבוץ"),stage[intake.stagePreference]),
   pair(t("Keys travel interest — not booked","עניין בנסיעה לקיז — לא הזמנה"),keys[intake.keysTravel]),
   pair(t("Optional offshore interest — not booked","עניין בים הפתוח — לא הזמנה"),offshore[intake.offshoreInterest]),
   pair(t("Confirmation email — not a delivery receipt","דוא״ל לאישור הפנייה — לא אישור מסירה"),intake.confirmationEmail??t("No separate confirmation address provided","לא נמסרה כתובת נפרדת לאישור הפנייה"),intake.confirmationEmail!==undefined),
   pair(t("Travel notes","הערות על נסיעה"),intake.travelNotes??t("Not specified","לא נמסר")),
  ],
  learners:intake.learners.map((learner,index)=>({heading:`${t("Child","ילד")} ${index+1}`,fields:[
   ...(learner.ageYears===undefined?[]:[pair(t("Age (years)","גיל בשנים"),String(learner.ageYears))]),pair(t("Grade band","טווח כיתות"),grade[learner.gradeBand]),pair(t("Schooling","מסגרת לימודים"),schooling[learner.schooling]),
   pair(t("Personal tackle box","ארגז ציוד אישי"),tackle[learner.tackleBox]),
  ]})),
  footer:t("This saved inquiry does not enroll a child, reserve a founding-family place, confirm a group, book transport or authorize payment.",
   "הפנייה שנשמרה אינה רושמת ילד, שומרת מקום למשפחה מייסדת, מאשרת קבוצה, מזמינה הסעה או מאשרת תשלום.")};
}

export async function verifyAcademyIntakeOwnerReadback(page:Page,input:VerifyInput):Promise<{
 learnerCount:number;complete:boolean;nextStep:"enrollment_followup"|"callback";driveLimit:number|"up_to_30"|"up_to_45"|"up_to_60"|"over_60";
}>{
 try{
  // Everything from the caller, including nested learners, is captured before await.
  const captured=verifySnapshot(input),expected=presentation(captured);
  guard(page,captured,captured.locale);
  await expect.poll(async()=>{
   try{
    guard(page,captured,captured.locale);
    // Return only a boolean from the page. No raw private text enters assertions,
    // error messages, logs or exported results, including on locator failure.
    const matches=await page.locator("[data-academy-intake-ref]").evaluateAll((nodes,want)=>{
     const current=new URL(window.location.href);
     if(current.origin!==want.origin||current.username||current.password||current.pathname!==want.path)return false;
     // Only the matching record's new intake is in scope; other cards are Root's.
     const articles=nodes.filter(node=>node.getAttribute("data-academy-intake-ref")===want.reference),article=articles[0];
     if(articles.length!==1||!(article instanceof HTMLElement)||article.tagName!=="ARTICLE")return false;
     const panels=article.querySelectorAll("[data-academy-intake]"),panel=panels[0];
     if(panels.length!==1||!(panel instanceof HTMLDetailsElement)||!panel.open||
      panel.closest("[data-academy-intake-ref]")!==article||panel.lang!==want.locale||panel.dir!==(want.locale==="he"?"rtl":"ltr"))return false;
     const normalize=(text:string)=>text.replace(/\s+/g," ").trim();
     const visible=(element:Element)=>{
      if(!(element instanceof HTMLElement)||!Array.from(element.getClientRects()).some(rect=>rect.width>0&&rect.height>0))return false;
      for(let parent:HTMLElement|null=element;parent;parent=parent.parentElement){
       const style=getComputedStyle(parent);
       if(parent.hidden||parent.getAttribute("aria-hidden")==="true"||parent.inert||style.display==="none"||
        style.visibility==="hidden"||style.visibility==="collapse"||Number(style.opacity)===0||
        (parent instanceof HTMLDetailsElement&&!parent.open))return false;
      }
      return true;
     };
     const container=(element:Element,tags:readonly string[])=>visible(element)&&element.children.length===tags.length&&
      Array.from(element.children).every((child,index)=>child.tagName===tags[index])&&
      Array.from(element.childNodes).every(node=>node.nodeType===Node.ELEMENT_NODE||node.nodeType===Node.COMMENT_NODE||
       (node.nodeType===Node.TEXT_NODE&&!node.textContent?.trim()));
     const leaf=(element:Element|undefined,text:string)=>!!element&&visible(element)&&element.children.length===0&&
      normalize(element.textContent??"")===normalize(text)&&normalize((element as HTMLElement).innerText)===normalize(text);
     const pairs=(list:Element|undefined,fields:readonly {label:string;value:string;bdi:boolean}[])=>{
      if(!list||!container(list,fields.flatMap(()=>["DT","DD"])))return false;
      return fields.every((field,index)=>{
       const term=list.children[index*2],description=list.children[index*2+1];
       if(!leaf(term,field.label)||!description)return false;
       if(!field.bdi)return leaf(description,field.value);
       const bidi=description.children[0];
       return visible(description)&&description.children.length===1&&bidi?.tagName==="BDI"&&
        bidi.getAttribute("dir")==="ltr"&&leaf(bidi,field.value)&&
        normalize(description.textContent??"")===normalize(field.value)&&
        normalize((description as HTMLElement).innerText)===normalize(field.value);
      });
     };
     if(!container(panel,["SUMMARY","DL","OL","P"]))return false;
     const [summary,fields,list,footer]=Array.from(panel.children);
     if(!leaf(summary,want.summary)||!pairs(fields,want.fields)||!leaf(footer,want.footer)||!list||
      list.getAttribute("aria-label")!==want.learnerLabel||!container(list,want.learners.map(()=>"LI"))||
      panel.querySelectorAll("[data-academy-intake-learner]").length!==want.learners.length)return false;
     return want.learners.every((learner,index)=>{
      const item=list.children[index];
      return !!item&&item.hasAttribute("data-academy-intake-learner")&&container(item,["H4","DL"])&&
       leaf(item.children[0],learner.heading)&&pairs(item.children[1],learner.fields);
     });
    },expected);
    guard(page,captured,captured.locale);return matches;
   }catch{throw new Error("ACADEMY_INTAKE_DOM_READ_FAILED");}
  },{timeout,message:"ACADEMY_INTAKE_READBACK_MISMATCH"}).toBe(true);
  guard(page,captured,captured.locale);
  return {learnerCount:captured.expected.learners.length,complete:true,nextStep:captured.expected.nextStep,driveLimit:captured.expected.driveLimit};
 }catch{throw new Error("ACADEMY_INTAKE_READBACK_FAILED");}
}

/** Root first causes denial/unselection. Same-origin denial/login paths are allowed;
 * hidden or collapsed intake nodes still fail absence. This does not verify auth. */
export async function expectAcademyIntakeReadbackAbsent(page:Page,input:Boundary):Promise<void>{
 try{
  const captured=boundarySnapshot(record(input,["fixture","origin"]));
  guard(page,captured);
  await expect.poll(async()=>{
   try{
    guard(page,captured);
    const absent=await page.locator(`${intakeMarker}, ${learnerMarker}`).evaluateAll((nodes,origin)=>{
     const current=new URL(window.location.href);
     return current.origin===origin&&!current.username&&!current.password&&nodes.length===0;
    },captured.origin);
    guard(page,captured);return absent;
   }catch{throw new Error("ACADEMY_INTAKE_ABSENCE_READ_FAILED");}
  },{timeout,message:"ACADEMY_INTAKE_READBACK_STILL_PRESENT"}).toBe(true);
  guard(page,captured);
 }catch{throw new Error("ACADEMY_INTAKE_ABSENCE_FAILED");}
}
