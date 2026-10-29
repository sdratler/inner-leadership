/** Read-only presentation model. It never merges records or infers consent. */
export type LeadPurpose="bna"|"fishing"|"support"|"provider"|"unclassified";
export type LeadViewRow={key:string;recordId:string;kind:"bna_inquiry"|"fishing_inquiry"|"conversation_305";
 label:string;purposes:LeadPurpose[];source:string;latestActivity:string;ownerAccountId:string;
 status:string;nextAction:string|null;dueDate:string|null;waitingCondition:string|null};

type Followup={status:string;nextAction:string|null;dueDate:string|null;waitingCondition:string|null;recordedAt?:string};
type BnaItem={id:string;ownerAccountId:string;receivedAt:string;fields:{name:string};attribution:{source?:string}|null;followup:Followup};
type FishingItem={id:string;receivedAt:string;fields:{programId:string;parentName?:string;schoolName?:string}};
type FishingDetail={application:FishingItem;attribution:unknown;followup:Followup};
type ConversationItem={id:string;ownerAccountId:string;contactHint:string;createdAt:string;followup:{classification:string;recordedAt:string;nextAction:string|null;dueDate:string|null;waitingCondition:string|null}};

export function bnaLeadRow(item:BnaItem):LeadViewRow{
 return {key:`bna:${item.id}`,recordId:item.id,kind:"bna_inquiry",label:item.fields.name,purposes:["bna"],
  source:item.attribution?.source??"unknown",latestActivity:item.followup.recordedAt??item.receivedAt,
  ownerAccountId:item.ownerAccountId,status:item.followup.status,nextAction:item.followup.nextAction,
  dueDate:item.followup.dueDate,waitingCondition:item.followup.waitingCondition};
}
export function fishingLeadRow(item:FishingDetail,ownerAccountId:string):LeadViewRow{
 if(item.application.fields.programId!=="sunday_fishing_academy")throw new Error("OUT_OF_SCOPE_FISHING_INQUIRY");
 const label=item.application.fields.parentName??item.application.fields.schoolName;
 if(!label)throw new Error("MISSING_INQUIRY_LABEL");
 return {key:`fishing:${item.application.id}`,recordId:item.application.id,kind:"fishing_inquiry",label,purposes:["fishing"],
  source:"public_group_application",latestActivity:item.followup.recordedAt??item.application.receivedAt,ownerAccountId,
  status:item.followup.status,nextAction:item.followup.nextAction,dueDate:item.followup.dueDate,waitingCondition:item.followup.waitingCondition};
}
export function conversationLeadRow(item:ConversationItem):LeadViewRow{
 const classification=item.followup.classification;
 const purposes:LeadPurpose[]=classification==="both"?["bna","fishing"]:
  classification==="bna"||classification==="fishing"||classification==="support"||classification==="provider"?[classification]:["unclassified"];
 return {key:`305:${item.id}`,recordId:item.id,kind:"conversation_305",label:item.contactHint,purposes,
  source:"manual_305",latestActivity:item.followup.recordedAt,ownerAccountId:item.ownerAccountId,status:"recorded",
  nextAction:item.followup.nextAction,dueDate:item.followup.dueDate,waitingCondition:item.followup.waitingCondition};
}
/** A recorded 305 conversation has no closed status in its current contract.
 * Keep it visible; do not invent a completion state from a missing date. */
export function needsFollowup(row:LeadViewRow):boolean{return row.kind==="conversation_305"||row.status!=="closed";}
