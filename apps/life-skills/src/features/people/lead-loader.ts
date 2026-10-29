import type {BnaInquiryStore} from "../bna-inquiry/store.ts";
import type {Owner305ConversationStore} from "../conversation-305/store.ts";
import type {FishingInquiryFollowupStore} from "../group-application/fishing-followup-store.ts";
import type {GroupApplicationReviewPage} from "../group-application/store.ts";
import {isFloridaGroupApplication,isSchoolInquiry} from "../group-application/contract.ts";
import {bnaLeadRow,conversationLeadRow,fishingLeadRow,type LeadViewRow} from "./lead-view.ts";

export type LeadSource="bna"|"fishing"|"conversation_305";
export type LeadSourcePage={rows:LeadViewRow[];nextCursor:string|null};
export class LeadReadError extends Error{constructor(readonly status:number){super("LEAD_READ_FAILED");}}
export type LeadRead=<T>(path:string)=>Promise<T>;
export const readLeadEndpoint:LeadRead=async<T>(path:string):Promise<T>=>{
 const response=await fetch(path,{credentials:"same-origin",cache:"no-store",redirect:"error",referrerPolicy:"no-referrer"});
 const body=await response.json().catch(()=>null);if(!response.ok||body?.ok!==true)throw new LeadReadError(response.status||503);
 return body.data as T;
};
/** Each call fetches one bounded page from one source. Every Fishing inquiry
 * requires its independently authorized follow-up before it can be presented;
 * a partial read is an error rather than a fabricated "new" state. */
export async function loadLeadSource(source:LeadSource,ownerAccountId:string,cursor:string|null,read:LeadRead=readLeadEndpoint):Promise<LeadSourcePage>{
 if(source==="bna"){
  const query=cursor?"?"+new URLSearchParams({before:cursor}):"";
  const page=await read<Awaited<ReturnType<BnaInquiryStore["list"]>>>("/api/private/bna-inquiries"+query);
  return {rows:page.items.map(bnaLeadRow),nextCursor:page.nextCursor};
 }
 if(source==="conversation_305"){
  const query=cursor?"?"+new URLSearchParams({before:cursor}):"";
  const page=await read<Awaited<ReturnType<Owner305ConversationStore["list"]>>>("/api/private/owner-305-conversations"+query);
  return {rows:page.items.map(conversationLeadRow),nextCursor:page.nextCursor};
 }
 const query=cursor?"?"+new URLSearchParams({cursor}):"";
 const page=await read<GroupApplicationReviewPage>("/api/private/group-applications"+query);
 const rows:LeadViewRow[]=[];
 // Bound simultaneous requests; no adult or child details are placed in URLs.
 for(let i=0;i<page.items.length;i+=5){
  const batch=await Promise.all(page.items.slice(i,i+5).map(async item=>{
   const detail=await read<Awaited<ReturnType<FishingInquiryFollowupStore["read"]>>>("/api/private/group-applications/followups?"+new URLSearchParams({id:item.id}));
   const application=detail.application,fields=application.fields;
   if(application.id!==item.id||!isFloridaGroupApplication(fields)||fields.programId!=="sunday_fishing_academy")throw new LeadReadError(503);
   return fishingLeadRow({...detail,application:{...application,fields:{programId:fields.programId,...(isSchoolInquiry(fields)?{schoolName:fields.schoolName}:{parentName:fields.parentName})}}},ownerAccountId);
  }));
  rows.push(...batch);
 }
 return {rows,nextCursor:page.nextCursor};
}
