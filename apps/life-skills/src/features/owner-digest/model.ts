import type {AdDailyPoint,MarketingSnapshot} from "../marketing-overview/contracts.ts";
import type {Prospect} from "../prospects/bridge.ts";
import {crmDueCivilDate} from "../prospects/due-date.ts";
import {prospectContactSuppressed,prospectArchived} from "../prospects/native-edit.ts";
import {nextHebrewStatus,publicationStatusText,contentDayKey,orderedPublicationQueue} from "../marketing-overview/calendar-model.ts";
import {MAX_OPERATIONAL_PROSPECTS} from "../contact-ops/core/limits.ts";

export type AdminCounts={due:number;overdue:number;future:number;missingDate:number;invalidDate:number;prospects:number;otherStages:number;awaitingForm:number|null;awaitingPayment:number|null;awaitingBooking:number|null};
export type TaskCounts={due:number;overdue:number;future:number};
export type Read<T>={data:T;asOf:string}|null;
export type ActionCode="crm_unavailable"|"tasks_unavailable"|"journeys_unavailable"|"dates_need_attention"|"content_unavailable"|"meta_unavailable"|"content_partial"|"publication_unconfirmed";
export const actionText:Record<"en"|"he",Record<ActionCode,string>>={
 en:{crm_unavailable:"People follow-up counts are unavailable. Retry the signed-in People page; do not treat this as no leads.",tasks_unavailable:"Internal task counts are unavailable. Check the Calendar task connection.",journeys_unavailable:"Intake/payment/booking evidence is unavailable; administrative labels are not verification.",dates_need_attention:"Some follow-ups have a missing or invalid date. Review People without inventing a due date.",content_unavailable:"Creative inventory is unavailable. Check the existing asset registry connection.",meta_unavailable:"Direct Meta readback is unavailable. Keep ads paused; check the existing connection.",content_partial:"Content inventory is partial. Counts and the loaded queue do not establish complete coverage.",publication_unconfirmed:"A publication result needs checking. Provider acceptance or manual marking is not verified publication."},
 he:{crm_unavailable:"מספרי המעקב באנשים אינם זמינים. יש לנסות שוב בעמוד האנשים לאחר כניסה; אין לפרש זאת כאין פניות.",tasks_unavailable:"מספרי המשימות הפנימיות אינם זמינים. יש לבדוק את חיבור המשימות ביומן.",journeys_unavailable:"אסמכתאות טופס, תשלום ותיאום אינן זמינות; תווית מנהלית אינה אימות.",dates_need_attention:"לחלק מפעולות המעקב חסר תאריך או שהתאריך אינו תקין. יש לבדוק באנשים בלי להמציא מועד.",content_unavailable:"מלאי הקריאייטיב אינו זמין. יש לבדוק את החיבור למאגר הנכסים הקיים.",meta_unavailable:"הקריאה הישירה מ-Meta אינה זמינה. יש להשאיר מודעות מושהות ולבדוק את החיבור הקיים.",content_partial:"מלאי התוכן חלקי. המספרים והתור שנטען אינם מוכיחים כיסוי מלא.",publication_unconfirmed:"תוצאת פרסום דורשת בדיקה. קבלת ספק או סימון ידני אינם פרסום מאומת."},
};
export type OwnerDigest={
 reportDate:string;timezone:"Asia/Jerusalem";asOf:string;
 followups:Read<AdminCounts>;tasks:Read<TaskCounts>;
 content:{available:boolean;asOf:string|null;partial:boolean;heStatusReady:number|null;heFeedReady:number|null;enFeedReady:number|null;publishablePosts:number|null;queueCount:number|null;coverageThrough:string|null;nextStatus:{at:string;status:string}|null;confirmedPublished:number|null};
 ads:{available:boolean;asOf:string|null;currency:string|null;timezone:string|null;attribution:string|null;active:number|null;paused:number|null;unknown:number|null;periods:{name:"yesterday"|"last_seven"|"preceding_seven";since:string;until:string;spendMinor:number|null;linkClicks:number|null;providerResults:number|null}[];days:readonly AdDailyPoint[]};
 actions:readonly ActionCode[];
 delivery:{enabled:false;existingTaskId:"6aa7ad09733081919c066b261f8e015f";localTime:"08:00";state:"handover_not_verified"};
};
const canonicalStages=new Set(["New inquiry","Contacted","Offer made","Prospect"]);
type ProspectFacts=Pick<Prospect,"leadId"|"stage"|"outcome"|"dueDate"|"nextAction"|"journeyState"|"paymentVerified"|"bookingConfirmed">;
/** Validate before serializing IDs or querying local ledgers. The identifier
 * bound matches the existing native People API; never truncate a corrupt read. */
export function validateDigestProspects(rows:readonly Pick<Prospect,"leadId"|"stage"|"outcome"|"nextAction"|"dueDate">[]):void {
 if(!Array.isArray(rows)||rows.length>MAX_OPERATIONAL_PROSPECTS)throw Error("INVALID_DIGEST_PROSPECTS");
 const seen=new Set<string>();
 for(const row of rows){
  if(!row||typeof row.leadId!=="string"||!/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]{1,80}$/.test(row.leadId)||seen.has(row.leadId)||
   ["stage","outcome","nextAction","dueDate"].some(key=>typeof row[key as "stage"|"outcome"|"nextAction"|"dueDate"]!=="string"))throw Error("INVALID_DIGEST_PROSPECTS");
  seen.add(row.leadId);
 }
}
/** Read-only administrative arithmetic. Never export name, notes, phone, email,
 * clinical content, arbitrary stage text or an inferred payment/booking state. */
export function summarizeProspects(rows:readonly ProspectFacts[],today:string,journeysAvailable:boolean):AdminCounts {
 validateDigestProspects(rows);
 const result:AdminCounts={due:0,overdue:0,future:0,missingDate:0,invalidDate:0,prospects:0,otherStages:0,awaitingForm:journeysAvailable?0:null,awaitingPayment:journeysAvailable?0:null,awaitingBooking:journeysAvailable?0:null};
 for(const row of rows){
  if(prospectArchived(row)||prospectContactSuppressed(row))continue;
  if(row.journeyState!=="active")result.prospects++;
  if(!canonicalStages.has(row.stage))result.otherStages++;
  if(row.nextAction.trim()){
   const date=crmDueCivilDate(row.dueDate);
   if(!row.dueDate.trim())result.missingDate++;
   else if(!date)result.invalidDate++;
   else if(date===today)result.due++;
   else if(date<today)result.overdue++;else result.future++;
  }
  if(journeysAvailable){
   // Form-invitation counts are supplied separately from the actual intake ledger.
   if(["intake_submitted","awaiting_payment"].includes(row.journeyState)&&!row.paymentVerified)result.awaitingPayment!++;
   if(row.paymentVerified===true&&row.bookingConfirmed!==true)result.awaitingBooking!++;
  }
 }
 return result;
}
function total(points:readonly AdDailyPoint[],key:"spendMinor"|"linkClicks"|"providerResults"):number|null {
 if(!points.length||points.some(point=>point[key]===null||!Number.isSafeInteger(point[key])||point[key]!<0))return null;
 const sum=points.reduce((sum,point)=>sum+point[key]!,0);return Number.isSafeInteger(sum)?sum:null;
}
export function buildOwnerDigest({now,marketing,followups,tasks,journeysAvailable,locale}:{now:Date;marketing:MarketingSnapshot;followups:Read<AdminCounts>;tasks:Read<TaskCounts>;journeysAvailable:boolean;locale:"he"|"en"}):OwnerDigest {
 const reportDate=contentDayKey(now.toISOString()),inventory=marketing.inventory,next=nextHebrewStatus(marketing.publications,marketing.creatives,now),report=marketing.adReporting;
 const queue=orderedPublicationQueue(marketing.publications),future=queue.filter(item=>item.scheduledFor&&Date.parse(item.scheduledFor)>=now.getTime());
 const periods=report?[{name:"yesterday" as const,since:report.current.until,until:report.current.until},{name:"last_seven" as const,...report.current},{name:"preceding_seven" as const,...report.previous}].map(period=>{
  const points=report.days.filter(point=>point.date>=period.since&&point.date<=period.until),expected=period.name==="yesterday"?1:7;
  return {...period,spendMinor:points.length===expected?total(points,"spendMinor"):null,linkClicks:points.length===expected?total(points,"linkClicks"):null,providerResults:points.length===expected?total(points,"providerResults"):null};
 }):[];
 const actions:ActionCode[]=[];
 if(!followups)actions.push("crm_unavailable");if(!tasks)actions.push("tasks_unavailable");if(!journeysAvailable)actions.push("journeys_unavailable");
 if(followups&&(followups.data.missingDate||followups.data.invalidDate))actions.push("dates_need_attention");
 if(!inventory)actions.push("content_unavailable");else if(inventory.partial)actions.push("content_partial");
 if(!report)actions.push("meta_unavailable");
 if(marketing.publications.some(item=>["sending","failed","unknown","manually_reported"].includes(item.state)||item.state==="published"&&!publicationStatusText(item,marketing.creatives,"en").startsWith("Published — provider receipt")))actions.push("publication_unconfirmed");
 return {reportDate,timezone:"Asia/Jerusalem",asOf:now.toISOString(),followups,tasks,
  content:{available:Boolean(inventory),asOf:inventory?.asOf??null,partial:inventory?.partial??true,heStatusReady:inventory?.heStatusReady??null,heFeedReady:inventory?.heFeedReady??null,enFeedReady:inventory?.enFeedReady??null,publishablePosts:inventory?.publishablePosts??null,queueCount:inventory?queue.length:null,coverageThrough:inventory&&!inventory.partial?(future.at(-1)?.scheduledFor??null):null,nextStatus:next?{at:next.scheduledFor!,status:publicationStatusText(next,marketing.creatives,locale)}:null,confirmedPublished:inventory?marketing.publications.filter(item=>publicationStatusText(item,marketing.creatives,"en")==="Published — provider receipt recorded").length:null},
  ads:{available:Boolean(report),asOf:report?.fetchedAt??null,currency:report?.currency??null,timezone:report?.timezone??null,attribution:report?.attribution??null,active:report?marketing.ads.filter(ad=>ad.status==="active").length:null,paused:report?marketing.ads.filter(ad=>ad.status==="paused").length:null,unknown:report?marketing.ads.filter(ad=>ad.status==="unknown").length:null,periods,days:report?report.days.filter(point=>point.date>=report.current.since&&point.date<=report.current.until):[]},
  actions,delivery:{enabled:false,existingTaskId:"6aa7ad09733081919c066b261f8e015f",localTime:"08:00",state:"handover_not_verified"}};
}
