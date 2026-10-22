import {expect,type Locator,type Page} from "@playwright/test";
import type {OccurrenceProjection,StageView} from "../../../src/features/fishing-stage/contract.ts";

const nextMarker="[data-fishing-parent-next]",makeupMarker="[data-fishing-parent-makeup]";
const timeout=15000,zone="America/New_York",token="[[TIME]]";
type Common={fixture:"SYNTHETIC_ONLY";origin:string};
type Content={text:string;dates:string[]};
type Block=Content&{tag:string};
type Presentation={label:string;body:Block[];items:Block[][]};
class ReadbackError extends Error{}
function requireFact(value:unknown,code:string):asserts value{if(!value)throw new ReadbackError("FISHING_PARENT_PLAN_"+code);}
function concreteId(value:unknown):value is string{return typeof value==="string"&&value.length>0&&value===value.trim();}
function originGuard(page:Page,input:Common){
 requireFact(input.fixture==="SYNTHETIC_ONLY","SYNTHETIC_ONLY");
 requireFact(["https://127.0.0.1:3445","https://127.0.0.1:3446","https://127.0.0.1:3447","https://127.0.0.1:3448"].includes(input.origin),"EXACT_HTTPS_ORIGIN");
 let current:URL;try{current=new URL(page.url());}catch{throw new ReadbackError("FISHING_PARENT_PLAN_PAGE_ORIGIN");}
 requireFact(current.origin===input.origin&&!current.username&&!current.password,"PAGE_ORIGIN");
}
function revision(value:number,maximum:number){return Number.isSafeInteger(value)&&value>=1&&value<=maximum;}
function instant(value:unknown):number|null{
 if(typeof value!=="string")return null;
 const parts=/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?:Z|[+-](\d{2}):(\d{2}))$/.exec(value);
 if(!parts)return null;
 const year=Number(parts[1]),month=Number(parts[2]),day=Number(parts[3]);
 const days=[31,year%4===0&&(year%100!==0||year%400===0)?29:28,31,30,31,30,31,31,30,31,30,31];
 if(year<1||month<1||month>12||day<1||day>days[month-1]!||Number(parts[4])>23||Number(parts[5])>59||
  Number(parts[6]??0)>59||Number(parts[7]??0)>23||Number(parts[8]??0)>59)return null;
 const time=Date.parse(value);return Number.isFinite(time)?time:null;
}
function occurrenceFor(view:StageView,id:unknown,publishedOnly=false):OccurrenceProjection|null{
 if(!concreteId(id))return null;
 const matches=view.occurrences.filter(occurrence=>occurrence.id===id),occurrence=matches[0];
 if(matches.length!==1||!occurrence)return null;
 return occurrence.cohortId===view.cohortId&&occurrence.stageId===view.stageId&&occurrence.stage===view.stage&&
  revision(occurrence.revision,view.revision)&&Number.isInteger(occurrence.ordinal)&&occurrence.ordinal>=1&&occurrence.ordinal<=12&&
  (publishedOnly?occurrence.state==="published":["published","completed","cancelled"].includes(occurrence.state))?occurrence:null;
}
const normalize=(value:string)=>value.replace(/\s+/g," ").trim();
function block(tag:string,value:string|Content):Block{return typeof value==="string"?{tag,text:normalize(value),dates:[]}:{tag,text:normalize(value.text),dates:[...value.dates]};}
function pair(blocks:Block[],label:string,value:string|Content){blocks.push(block("dt",label),block("dd",value));}

/** Expected semantics are built from native facts and frozen presenter text,
 * not from rendering/importing either production component as its own oracle. */
function expectedPresentations(view:StageView,locale:"en"|"he"){
 const t=(en:string,he:string)=>locale==="he"?he:en,unknown=t("Unavailable","לא זמין");
 const time=(value:unknown):Content=>typeof value==="string"&&instant(value)!==null?{text:token,dates:[value]}:{text:unknown,dates:[]};
 const schedule=(occurrence:OccurrenceProjection):Content=>{
  const value=occurrence.time;
  if(value?.kind==="undated")return {text:t("Date not yet set","טרם נקבע מועד"),dates:[]};
  if(value?.kind==="scheduled"){
   const start=instant(value.startsAt),end=instant(value.endsAt);
   if(value.timeZone===zone&&start!==null&&end!==null&&end>start)return {text:token+" – "+token,dates:[value.startsAt,value.endsAt]};
  }
  return {text:t("Session time unavailable","מועד המפגש אינו זמין"),dates:[]};
 };
 const statuses={published:t("Published","פורסם"),completed:t("Completed","התקיים"),cancelled:t("Cancelled","בוטל")};
 const status=(occurrence:OccurrenceProjection)=>statuses[occurrence.state as keyof typeof statuses];
 const next=concreteId(view.cohortId)&&concreteId(view.stageId)&&[1,2,3,4].includes(view.stage)?occurrenceFor(view,view.nextOccurrenceId,true):null;
 const nextExpected:Presentation={label:t("Next session","המפגש הבא"),body:[block("h2",t("Next session","המפגש הבא"))],items:[]};
 if(next){
  nextExpected.body.push(block("h3",`${t("Session","מפגש")} ${next.ordinal}`));
  pair(nextExpected.body,t("Stage revision","גרסת השלב"),String(view.revision));pair(nextExpected.body,t("Session revision","גרסת המפגש"),String(next.revision));
  const interval=schedule(next);nextExpected.body.push(block("p",{text:interval.text+(interval.dates.length?" · "+zone:""),dates:interval.dates}));
 }else nextExpected.body.push(block("p",t("Next session details unavailable.","פרטי המפגש הבא אינם זמינים.")));
 const makeupExpected:Presentation={label:t("Makeup notices","דיווחי השלמה"),body:[block("h2",t("Makeup notices","דיווחי השלמה")),block("p",`${t("Stage revision:","גרסת השלב:")} ${view.revision} · ${zone}`)],items:[]};
 if(view.notices.length===0)makeupExpected.body.push(block("p",t("No makeup notices recorded.","לא נרשמו דיווחי השלמה.")));
 for(const notice of view.notices){
  const original=occurrenceFor(view,notice.occurrenceId),replacement=occurrenceFor(view,notice.replacementOccurrenceId);
  const replacementState=notice.replacementOccurrenceId===null?"none":concreteId(notice.replacementOccurrenceId)?"recorded":"unknown";
  const requestState=notice.requestedAt===null?"none":instant(notice.requestedAt)!==null?"recorded":"unknown";
  const blocks=[block("h3",original?`${t("Original session","המפגש המקורי")} ${original.ordinal}`:t("Original session details unavailable here.","פרטי המפגש המקורי אינם זמינים כאן."))];
  pair(blocks,t("Original session revision","גרסת המפגש המקורית"),revision(notice.originalOccurrenceRevision,original?.revision??view.revision)?String(notice.originalOccurrenceRevision):unknown);
  pair(blocks,t("Original start","המועד המקורי"),time(notice.originalStartsAt));pair(blocks,t("Notice received","הדיווח התקבל"),time(notice.receivedAt));
  const needsConfirmation=replacementState==="none";
  blocks.push(block("p",notice.state==="protected"?t("Makeup entitlement preserved.","הזכאות להשלמה נשמרה.")+(needsConfirmation?" "+t("A suitable place still needs confirmation.","עדיין נדרש אישור למקום מתאים."):""):
   notice.state==="operator_undelivered"?t("The cancelled session remains undelivered.","המפגש שבוטל טרם סופק.")+(needsConfirmation?" "+t("Replacement arrangements need confirmation.","יש לאשר את הסדרי ההשלמה."):""):
   notice.state==="best_effort"||notice.state==="operator_review"?(needsConfirmation?t("The instructor will review a suitable opportunity.","המדריך יבדוק אפשרות מתאימה.")+" ":"")+t("A particular trip is not guaranteed.","אין הבטחה למקום ביציאה מסוימת."):
   t("Notice status unavailable.","מצב הדיווח אינו זמין.")));
  if(notice.scheduleChangedSinceNotice===true)blocks.push(block("p",t("Session details changed after this notice. Your original notice time is retained.","פרטי המפגש השתנו לאחר הדיווח. מועד הדיווח המקורי נשמר.")));
  else if(notice.scheduleChangedSinceNotice!==false)blocks.push(block("p",t("Schedule comparison unavailable.","השוואת המועדים אינה זמינה.")));
  if(original){
   pair(blocks,t("Current session status","מצב המפגש הנוכחי"),status(original));pair(blocks,t("Current session revision","גרסת המפגש הנוכחית"),String(original.revision));pair(blocks,t("Current session time","מועד המפגש הנוכחי"),schedule(original));
  }
  if(requestState==="recorded"){
   const requested=time(notice.requestedAt);blocks.push(block("p",{text:t("Request received:","הבקשה התקבלה:")+" "+requested.text,dates:requested.dates}));
   if(needsConfirmation)blocks.push(block("p",t("Your makeup request is awaiting confirmation.","בקשת ההשלמה שלך ממתינה לאישור.")));
  }else blocks.push(block("p",requestState==="none"?t("No makeup request recorded.","לא נרשמה בקשת השלמה."):t("Makeup request status unavailable.","מצב בקשת ההשלמה אינו זמין.")));
  if(replacementState==="recorded"){
   if(replacement){
    blocks.push(block("p",t("A replacement is recorded.","נרשם מפגש חלופי.")));
    pair(blocks,t("Replacement session","המפגש החלופי"),`${t("Session","מפגש")} ${replacement.ordinal}`);
    pair(blocks,t("Replacement status","מצב המפגש החלופי"),status(replacement));pair(blocks,t("Replacement revision","גרסת המפגש החלופי"),String(replacement.revision));pair(blocks,t("Replacement time","מועד המפגש החלופי"),schedule(replacement));
   }else blocks.push(block("p",t("A replacement is recorded, but its details are unavailable here.","נרשם מפגש חלופי, אך פרטיו אינם זמינים כאן.")));
  }else if(replacementState==="unknown")blocks.push(block("p",t("Replacement status unavailable.","מצב ההשלמה אינו זמין.")));
  makeupExpected.items.push(blocks);
 }
 return {next:nextExpected,makeup:makeupExpected,nextKnown:next!==null};
}

function region(page:Page,marker:string,label:string){
 // The registered marker may wrap the section or be on the section itself.
 return page.locator(`${marker} section[aria-label="${label}"],section${marker}[aria-label="${label}"]`);
}
async function readPresentation(locator:Locator,locale:"en"|"he"){
 return locator.evaluate((root,{locale,token})=>{
  const normalize=(value:string)=>value.replace(/\s+/g," ").trim();
  const skeleton=(node:Node):string=>{
   if(node instanceof Element&&node.tagName==="TIME")return token;
   if(node.nodeType===Node.TEXT_NODE)return node.textContent??"";
   return Array.from(node.childNodes).map(skeleton).join("");
  };
  const leaf=(element:Element)=>({tag:element.tagName.toLowerCase(),text:normalize(skeleton(element)),dates:Array.from(element.querySelectorAll("time")).map(time=>time.getAttribute("datetime"))});
  const elements=Array.from(root.querySelectorAll("h2,h3,p,dt,dd"));
  const body=elements.filter(element=>{const item=element.closest("li");return !item||!root.contains(item);}).map(leaf);
  const items=Array.from(root.querySelectorAll("ol > li")).map(item=>Array.from(item.querySelectorAll("h2,h3,p,dt,dd")).map(leaf));
  const format=new Intl.DateTimeFormat(locale==="he"?"he-IL":"en-US",{timeZone:"America/New_York",year:"numeric",month:"short",day:"numeric",hour:"numeric",minute:"2-digit",timeZoneName:"short"});
  const timesCorrect=Array.from(root.querySelectorAll("time")).every(time=>{
   const value=time.getAttribute("datetime");if(!value)return false;
   try{return normalize(time.textContent??"")===normalize(format.format(new Date(value)));}catch{return false;}
  });
  // Additional hidden/plain text cannot escape the per-field assertions.
  const completeText=skeleton(root).replace(/\s/g,"")===elements.map(skeleton).join("").replace(/\s/g,"");
  return {label:root.getAttribute("aria-label"),lang:root.getAttribute("lang"),dir:root.getAttribute("dir"),body,items,timesCorrect,completeText,
   actionsAbsent:root.querySelectorAll('a,button,form,input,select,textarea,[contenteditable="true"]').length===0};
 },{locale,token});
}
function matches(actual:Awaited<ReturnType<typeof readPresentation>>,expected:Presentation,locale:"en"|"he"){
 return actual.lang===locale&&actual.dir===(locale==="he"?"rtl":"ltr")&&actual.label===expected.label&&actual.timesCorrect&&actual.completeText&&actual.actionsAbsent&&
  JSON.stringify(actual.body)===JSON.stringify(expected.body)&&JSON.stringify(actual.items)===JSON.stringify(expected.items);
}

/** Root has already obtained the fresh ordinary authorized selected-parent view
 * and opened the existing attendance details. No DTO/ID check here authorizes a
 * session. These functions only read; no login, context, navigation, request,
 * response interception, fixture creation or state mutation is performed.
 * nextKnown means a uniquely resolved eligible published pointer, even undated.
 * No DTO, DOM snapshot, IDs or original browser error is logged or returned. */
export async function verifyFishingParentPlanSummaries(page:Page,input:{fixture:"SYNTHETIC_ONLY";origin:string;locale:"en"|"he";view:StageView}):Promise<{stageRevision:number;nextKnown:boolean;noticeCount:number}>{
 try{
  const boundary:Common={fixture:input.fixture,origin:input.origin},locale=input.locale,view=input.view;
  originGuard(page,boundary);requireFact(locale==="en"||locale==="he","LOCALE");
  requireFact(view.role==="parent"&&concreteId(view.enrollmentId)&&Number.isSafeInteger(view.revision)&&view.revision>=0&&Array.isArray(view.occurrences)&&Array.isArray(view.notices),"SELECTED_PARENT_PRESENTATION");
  const expected=expectedPresentations(view,locale),receipt={stageRevision:view.revision,nextKnown:expected.nextKnown,noticeCount:view.notices.length};
  const nextRegion=region(page,nextMarker,expected.next.label),makeupRegion=region(page,makeupMarker,expected.makeup.label);
  await expect.poll(async()=>{
   originGuard(page,boundary);
   if(await page.locator(nextMarker).count()!==1||await page.locator(makeupMarker).count()!==1||
    await page.locator(`details[data-fishing-parent-attendance][open] ${makeupMarker}`).count()!==1||await nextRegion.count()!==1||await makeupRegion.count()!==1)return false;
   if(!await nextRegion.isVisible()||!await makeupRegion.isVisible())return false;
   const next=await readPresentation(nextRegion,locale),makeup=await readPresentation(makeupRegion,locale);
   originGuard(page,boundary);return matches(next,expected.next,locale)&&matches(makeup,expected.makeup,locale);
  },{timeout,message:"FISHING_PARENT_PLAN_SUMMARIES_MATCH"}).toBe(true);
  originGuard(page,boundary);return receipt;
 }catch(error){if(error instanceof ReadbackError)throw error;throw new ReadbackError("FISHING_PARENT_PLAN_READBACK_FAILED");}
}

/** Root invokes after denial/unselection. Absence means no mounted marker,
 * not merely hidden content. This helper never changes selection or identity. */
export async function expectFishingParentPlanSummariesAbsent(page:Page,input:{fixture:"SYNTHETIC_ONLY";origin:string}):Promise<void>{
 try{
  const boundary:Common={fixture:input.fixture,origin:input.origin};originGuard(page,boundary);
  await expect.poll(async()=>{
   originGuard(page,boundary);
   const absent=await page.locator(nextMarker).count()===0&&await page.locator(makeupMarker).count()===0;
   originGuard(page,boundary);return absent;
  },{timeout,message:"FISHING_PARENT_PLAN_SUMMARIES_ABSENT"}).toBe(true);
  originGuard(page,boundary);
 }catch(error){if(error instanceof ReadbackError)throw error;throw new ReadbackError("FISHING_PARENT_PLAN_ABSENCE_FAILED");}
}
