import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import type {IdentityStore,SqlSession} from "../identity/store.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {requirePractitioner} from "../cases/policy.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../identity/types.ts";
import {privateDigest} from "../contact-ops/server/digests.ts";
import {MINUTE_MS,possibleInstants} from "../calendar/time.ts";
import {draftGroupCommandSchema,moveProposedPlacementCommandSchema,proposedPlacementCommandSchema,type DraftGroupCommand,type DraftGroupRecord,
 proposedDraftMeetingCommandSchema,reviseDraftMeetingCommandSchema,type DraftMeetingConflict,type DraftMeetingRevisionRecord,type EligibleGroupInterest,
 type MoveProposedPlacementCommand,type ProposedDraftMeetingCommand,type ProposedPlacementCommand,type ProposedPlacementMoveRecord,
 type ProposedPlacementRecord,type ReviseDraftMeetingCommand} from "./contract.ts";

type DraftRow={id:string;labelCiphertext:string;recordedBy:string;createdAt:Date;requestDigest:string};
type InterestRow={id:string;familyId:string;familyCiphertext:string;personId:string;personCiphertext:string;
 sourceInquiryId:string;sourceInquiryCreatedAt:Date;recordedBy:string;createdAt:Date};
type PlacementRow=InterestRow&{draftGroupId:string;serviceInterestId:string;movedFromProposalId:string|null;movedToProposalId:string|null};
type MoveRow={id:string;sourceProposedPlacementId:string;destinationProposedPlacementId:string;sourceDraftGroupId:string;
 destinationDraftGroupId:string;serviceInterestId:string;familyId:string;personId:string;recordedBy:string;createdAt:Date};
type MeetingRow={id:string;occurrenceId:string;draftGroupId:string;previousRevisionId:string|null;nextRevisionId:string|null;
 timeZone:"Asia/Jerusalem";localStart:string;startsAt:Date;endsAt:Date;durationMinutes:number;venueCiphertext:string;
 recordedBy:string;createdAt:Date;requestDigest:string};
const draftAad=(workspace:string,id:string)=>`ls_group_admin/draft_group/v1/${workspace}/${id}`;
const meetingAad=(workspace:string,id:string)=>`ls_group_admin/draft_meeting/v1/${workspace}/${id}`;

export class GroupPlacementStore{
 constructor(private readonly db:IdentityStore,private readonly ring:Keyring,private readonly key:string,
  private readonly clock:IdentityClock=systemClock){}
 private draftDigest(workspace:string,label:string){return privateDigest({domain:"draft-group/v1",workspace,fields:{label}},this.key);}
 private placementDigest(workspace:string,command:ProposedPlacementCommand){return privateDigest({domain:"proposed-placement/v1",workspace,
  fields:{draftGroupId:command.draftGroupId,serviceInterestId:command.serviceInterestId}},this.key);}
 private moveDigest(workspace:string,command:MoveProposedPlacementCommand){return privateDigest({domain:"proposed-placement-move/v1",workspace,
  fields:{sourceProposedPlacementId:command.sourceProposedPlacementId,destinationDraftGroupId:command.destinationDraftGroupId}},this.key);}
 private meetingDigest(workspace:string,command:ProposedDraftMeetingCommand|ReviseDraftMeetingCommand){return privateDigest({domain:"draft-meeting/v1",workspace,
  fields:{action:command.action,...("draftGroupId" in command?{draftGroupId:command.draftGroupId}:{sourceRevisionId:command.sourceRevisionId}),
   timeZone:command.timeZone,localStart:command.localStart,durationMinutes:command.durationMinutes,venue:command.venue}},this.key);}
 private draft(workspace:string,row:DraftRow):DraftGroupRecord{
  try{const label=unseal(row.labelCiphertext,draftAad(workspace,row.id),this.ring);if(!label.trim())throw new Error();
   if(this.draftDigest(workspace,label)!==row.requestDigest)throw new Error();
   return {id:row.id,state:"draft_group",label,recordedBy:row.recordedBy,createdAt:row.createdAt.toISOString()};
  }catch{throw new AppError("UNAVAILABLE");}
 }
 private identity(workspace:string,row:InterestRow){
  try{const profile:unknown=JSON.parse(unseal(row.personCiphertext,`person:${workspace}:${row.personId}`,this.ring));
   if(!profile||typeof profile!=="object"||!("displayName" in profile)||typeof profile.displayName!=="string"||!profile.displayName.trim())throw new Error();
   const familyLabel=unseal(row.familyCiphertext,`family:${workspace}:${row.familyId}`,this.ring);if(!familyLabel.trim())throw new Error();
   return {familyId:row.familyId,familyLabel,personId:row.personId,personLabel:profile.displayName};
  }catch{throw new AppError("UNAVAILABLE");}
 }
 private interest(workspace:string,row:InterestRow):EligibleGroupInterest{return {id:row.id,state:"service_interest",serviceType:"group",
  ...this.identity(workspace,row),sourceInquiryId:row.sourceInquiryId,sourceInquiryCreatedAt:row.sourceInquiryCreatedAt.toISOString(),
  recordedBy:row.recordedBy,createdAt:row.createdAt.toISOString()};}
 private placement(workspace:string,row:PlacementRow):ProposedPlacementRecord{return {id:row.id,state:"proposed_placement",
  draftGroupId:row.draftGroupId,serviceInterestId:row.serviceInterestId,...this.identity(workspace,row),sourceInquiryId:row.sourceInquiryId,
  sourceInquiryCreatedAt:row.sourceInquiryCreatedAt.toISOString(),recordedBy:row.recordedBy,createdAt:row.createdAt.toISOString(),
  proposalStatus:row.movedToProposalId?"moved":"current",movedFromProposalId:row.movedFromProposalId,movedToProposalId:row.movedToProposalId};}
 private movement(row:MoveRow):ProposedPlacementMoveRecord{return {id:row.id,state:"proposal_movement",
  sourceProposedPlacementId:row.sourceProposedPlacementId,destinationProposedPlacementId:row.destinationProposedPlacementId,
  sourceDraftGroupId:row.sourceDraftGroupId,destinationDraftGroupId:row.destinationDraftGroupId,serviceInterestId:row.serviceInterestId,
  familyId:row.familyId,personId:row.personId,recordedBy:row.recordedBy,createdAt:row.createdAt.toISOString()};}
 private meeting(workspace:string,row:MeetingRow,conflicts:DraftMeetingConflict[]):DraftMeetingRevisionRecord{
  try{const venue=unseal(row.venueCiphertext,meetingAad(workspace,row.id),this.ring);if(!venue.trim())throw new Error();
   const operationId="00000000-0000-4000-8000-000000000001",expected=this.meetingDigest(workspace,row.previousRevisionId?
    {action:"revise_draft_group_meeting",operationId,sourceRevisionId:row.previousRevisionId,timeZone:row.timeZone,localStart:row.localStart,durationMinutes:row.durationMinutes,venue}:
    {action:"propose_draft_group_meeting",operationId,draftGroupId:row.draftGroupId,timeZone:row.timeZone,localStart:row.localStart,durationMinutes:row.durationMinutes,venue});
   if(expected!==row.requestDigest)throw new Error();
   return {id:row.id,occurrenceId:row.occurrenceId,state:"proposed",draftGroupId:row.draftGroupId,timeZone:row.timeZone,
    localStart:row.localStart,startsAt:row.startsAt.toISOString(),endsAt:row.endsAt.toISOString(),durationMinutes:row.durationMinutes,venue,
    recordedBy:row.recordedBy,createdAt:row.createdAt.toISOString(),previousRevisionId:row.previousRevisionId,nextRevisionId:row.nextRevisionId,
    revisionStatus:row.nextRevisionId?"superseded":"current",conflicts};
  }catch{throw new AppError("UNAVAILABLE");}
 }
 private resolveMeeting(command:ProposedDraftMeetingCommand|ReviseDraftMeetingCommand){
  const choices=possibleInstants(command.localStart);if(choices.length!==1)throw new AppError("INVALID_REQUEST");
  const startsAt=new Date(choices[0]!),endsAt=new Date(startsAt.valueOf()+command.durationMinutes*MINUTE_MS);
  return {startsAt,endsAt};
 }
 private async meetingConflicts(tx:SqlSession,actor:Actor,row:MeetingRow):Promise<DraftMeetingConflict[]>{
  const appointments=await tx.query<{id:string;startsAt:Date;endsAt:Date}>(`SELECT id,
   starts_at-buffer_before*interval '1 minute' AS "startsAt",ends_at+buffer_after*interval '1 minute' AS "endsAt"
   FROM ls_calendar.appointments WHERE workspace_id=$1 AND practitioner_id=$2 AND status='scheduled'
   AND starts_at-buffer_before*interval '1 minute'<$4 AND ends_at+buffer_after*interval '1 minute'>$3
   ORDER BY starts_at,id LIMIT 21`,[actor.workspaceId,actor.id,row.startsAt,row.endsAt]);
  const meetings=await tx.query<{id:string;startsAt:Date;endsAt:Date}>(`SELECT r.id,r.starts_at AS "startsAt",r.ends_at AS "endsAt"
   FROM ls_group_admin.draft_meeting_revisions r LEFT JOIN ls_group_admin.draft_meeting_revisions successor
    ON successor.workspace_id=r.workspace_id AND successor.previous_revision_id=r.id
   WHERE r.workspace_id=$1 AND r.recorded_by=$2 AND successor.id IS NULL AND r.occurrence_id<>$3
    AND r.starts_at<$5 AND r.ends_at>$4 ORDER BY r.starts_at,r.id LIMIT 21`,[actor.workspaceId,actor.id,row.occurrenceId,row.startsAt,row.endsAt]);
  if(appointments.length>20||meetings.length>20)throw new AppError("UNAVAILABLE");
  return [...appointments.map(item=>({kind:"private_appointment" as const,reference:item.id.slice(0,8),startsAt:item.startsAt.toISOString(),endsAt:item.endsAt.toISOString()})),
   ...meetings.map(item=>({kind:"draft_occurrence" as const,reference:item.id.slice(0,8),startsAt:item.startsAt.toISOString(),endsAt:item.endsAt.toISOString()}))];
 }
 private orderedMovements(rows:MoveRow[]){
  const bySource=new Map(rows.map(row=>[row.sourceProposedPlacementId,row])),destinations=new Set(rows.map(row=>row.destinationProposedPlacementId)),
   ordered:MoveRow[]=[],visited=new Set<string>();
  for(const root of rows.filter(row=>!destinations.has(row.sourceProposedPlacementId))){let current:MoveRow|undefined=root;
   while(current&&!visited.has(current.id)){ordered.push(current);visited.add(current.id);current=bySource.get(current.destinationProposedPlacementId);}}
  if(ordered.length!==rows.length)throw new AppError("UNAVAILABLE");return ordered.map(row=>this.movement(row));
 }
 private async readDraft(tx:SqlSession,actor:Actor,id:string){
  const rows=await tx.query<DraftRow>(`SELECT id,label_ciphertext AS "labelCiphertext",recorded_by AS "recordedBy",
   created_at AS "createdAt",request_digest AS "requestDigest" FROM ls_group_admin.draft_groups WHERE workspace_id=$1 AND id=$2`,[actor.workspaceId,id]);
  if(rows.length!==1)throw new AppError("UNAVAILABLE");return this.draft(actor.workspaceId,rows[0]!);
 }
 private async readPlacement(tx:SqlSession,actor:Actor,id:string){
  const rows=await tx.query<PlacementRow>(`SELECT pp.id,pp.draft_group_id AS "draftGroupId",pp.service_interest_id AS "serviceInterestId",
   pp.family_id AS "familyId",f.label_ciphertext AS "familyCiphertext",pp.person_id AS "personId",p.profile_ciphertext AS "personCiphertext",
   s.source_inquiry_id AS "sourceInquiryId",i.created_at AS "sourceInquiryCreatedAt",
   pp.recorded_by AS "recordedBy",pp.created_at AS "createdAt",incoming.source_proposed_placement_id AS "movedFromProposalId",
   outgoing.destination_proposed_placement_id AS "movedToProposalId" FROM ls_group_admin.proposed_placements pp
   JOIN ls_service_interest.service_interests s ON s.workspace_id=pp.workspace_id AND s.id=pp.service_interest_id
   JOIN ls_service_interest.inquiries i ON i.workspace_id=s.workspace_id AND i.id=s.source_inquiry_id
   JOIN ls_cases.families f ON f.workspace_id=pp.workspace_id AND f.id=pp.family_id
   JOIN ls_identity.people p ON p.workspace_id=pp.workspace_id AND p.id=pp.person_id
   LEFT JOIN ls_group_admin.proposed_placement_moves incoming ON incoming.workspace_id=pp.workspace_id AND incoming.destination_proposed_placement_id=pp.id
   LEFT JOIN ls_group_admin.proposed_placement_moves outgoing ON outgoing.workspace_id=pp.workspace_id AND outgoing.source_proposed_placement_id=pp.id
   WHERE pp.workspace_id=$1 AND pp.id=$2`,[actor.workspaceId,id]);
  if(rows.length!==1)throw new AppError("UNAVAILABLE");return this.placement(actor.workspaceId,rows[0]!);
 }
 private async readMove(tx:SqlSession,actor:Actor,id:string){
  const rows=await tx.query<MoveRow>(`SELECT id,source_proposed_placement_id AS "sourceProposedPlacementId",
   destination_proposed_placement_id AS "destinationProposedPlacementId",source_draft_group_id AS "sourceDraftGroupId",
   destination_draft_group_id AS "destinationDraftGroupId",service_interest_id AS "serviceInterestId",family_id AS "familyId",
   person_id AS "personId",recorded_by AS "recordedBy",created_at AS "createdAt"
   FROM ls_group_admin.proposed_placement_moves WHERE workspace_id=$1 AND id=$2`,[actor.workspaceId,id]);
  if(rows.length!==1)throw new AppError("UNAVAILABLE");return this.movement(rows[0]!);
 }
 private async readMeeting(tx:SqlSession,actor:Actor,id:string){
  const rows=await tx.query<MeetingRow>(`SELECT r.id,r.occurrence_id AS "occurrenceId",r.draft_group_id AS "draftGroupId",
   r.previous_revision_id AS "previousRevisionId",successor.id AS "nextRevisionId",r.time_zone AS "timeZone",
   r.local_start AS "localStart",r.starts_at AS "startsAt",r.ends_at AS "endsAt",r.duration_minutes AS "durationMinutes",
   r.venue_ciphertext AS "venueCiphertext",r.recorded_by AS "recordedBy",r.created_at AS "createdAt",r.request_digest AS "requestDigest"
   FROM ls_group_admin.draft_meeting_revisions r LEFT JOIN ls_group_admin.draft_meeting_revisions successor
    ON successor.workspace_id=r.workspace_id AND successor.previous_revision_id=r.id
   WHERE r.workspace_id=$1 AND r.id=$2`,[actor.workspaceId,id]);
  if(rows.length!==1)throw new AppError("UNAVAILABLE");const row=rows[0]!;return this.meeting(actor.workspaceId,row,row.nextRevisionId?[]:await this.meetingConflicts(tx,actor,row));
 }
 async createDraftGroup(actor:Actor,input:DraftGroupCommand){
  const parsed=draftGroupCommandSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const command=parsed.data,hash=this.draftDigest(actor.workspaceId,command.label);
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const prior=await tx.query<{draftGroupId:string;requestDigest:string;recordedBy:string}>(`SELECT draft_group_id AS "draftGroupId",
    request_digest AS "requestDigest",recorded_by AS "recordedBy" FROM ls_group_admin.draft_group_operations
    WHERE workspace_id=$1 AND operation_id=$2`,[actor.workspaceId,command.operationId]);
   if(prior.length){if(prior.length!==1||prior[0]!.requestDigest!==hash||prior[0]!.recordedBy!==actor.id)throw new AppError("CONFLICT");
    return {saved:true as const,replayed:true,item:await this.readDraft(tx,actor,prior[0]!.draftGroupId)};}
   const id=randomUUID();await tx.query(`INSERT INTO ls_group_admin.draft_groups
    (workspace_id,id,label_ciphertext,recorded_by,request_digest,created_at) VALUES($1,$2,$3,$4,$5,$6)`,
    [actor.workspaceId,id,seal(command.label,draftAad(actor.workspaceId,id),this.ring),actor.id,hash,this.clock.now()]);
   await tx.query(`INSERT INTO ls_group_admin.draft_group_operations
    (workspace_id,operation_id,recorded_by,request_digest,draft_group_id) VALUES($1,$2,$3,$4,$5)`,
    [actor.workspaceId,command.operationId,actor.id,hash,id]);
   return {saved:true as const,replayed:false,item:await this.readDraft(tx,actor,id)};
  });
 }
 async proposePlacement(actor:Actor,input:ProposedPlacementCommand){
  const parsed=proposedPlacementCommandSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const command=parsed.data,hash=this.placementDigest(actor.workspaceId,command);
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const prior=await tx.query<{proposedPlacementId:string;requestDigest:string;recordedBy:string}>(`SELECT proposed_placement_id AS "proposedPlacementId",
    request_digest AS "requestDigest",recorded_by AS "recordedBy" FROM ls_group_admin.proposed_placement_operations
    WHERE workspace_id=$1 AND operation_id=$2`,[actor.workspaceId,command.operationId]);
   if(prior.length){if(prior.length!==1||prior[0]!.requestDigest!==hash||prior[0]!.recordedBy!==actor.id)throw new AppError("CONFLICT");
    return {saved:true as const,replayed:true,duplicate:true,item:await this.readPlacement(tx,actor,prior[0]!.proposedPlacementId)};}
   const group=await tx.query<{ok:boolean}>(`SELECT true AS ok FROM ls_group_admin.draft_groups WHERE workspace_id=$1 AND id=$2`,[actor.workspaceId,command.draftGroupId]);
   if(group.length!==1)throw new AppError("NOT_FOUND");
   const interest=await tx.query<{familyId:string;personId:string}>(`SELECT family_id AS "familyId",person_id AS "personId"
    FROM ls_service_interest.service_interests WHERE workspace_id=$1 AND id=$2 AND service_type='group'`,[actor.workspaceId,command.serviceInterestId]);
   if(interest.length!==1)throw new AppError("NOT_FOUND");
   const existing=await tx.query<{id:string}>(`SELECT id FROM ls_group_admin.proposed_placements
    WHERE workspace_id=$1 AND draft_group_id=$2 AND service_interest_id=$3`,[actor.workspaceId,command.draftGroupId,command.serviceInterestId]);
   if(existing.length>1)throw new AppError("UNAVAILABLE");const id=existing[0]?.id??randomUUID(),member=interest[0]!;
   if(!existing.length)await tx.query(`INSERT INTO ls_group_admin.proposed_placements
    (workspace_id,id,draft_group_id,service_interest_id,service_type,family_id,person_id,recorded_by,request_digest,created_at)
    VALUES($1,$2,$3,$4,'group',$5,$6,$7,$8,$9)`,[actor.workspaceId,id,command.draftGroupId,command.serviceInterestId,
     member.familyId,member.personId,actor.id,hash,this.clock.now()]);
   await tx.query(`INSERT INTO ls_group_admin.proposed_placement_operations
    (workspace_id,operation_id,recorded_by,request_digest,proposed_placement_id) VALUES($1,$2,$3,$4,$5)`,
    [actor.workspaceId,command.operationId,actor.id,hash,id]);
   return {saved:true as const,replayed:false,duplicate:existing.length===1,item:await this.readPlacement(tx,actor,id)};
  });
 }
 async movePlacement(actor:Actor,input:MoveProposedPlacementCommand){
  const parsed=moveProposedPlacementCommandSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const command=parsed.data,hash=this.moveDigest(actor.workspaceId,command);
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const prior=await tx.query<{moveId:string;requestDigest:string;recordedBy:string}>(`SELECT proposed_placement_move_id AS "moveId",
    request_digest AS "requestDigest",recorded_by AS "recordedBy" FROM ls_group_admin.proposed_placement_move_operations
    WHERE workspace_id=$1 AND operation_id=$2`,[actor.workspaceId,command.operationId]);
   if(prior.length){
    if(prior.length!==1||prior[0]!.requestDigest!==hash||prior[0]!.recordedBy!==actor.id)throw new AppError("CONFLICT");
    const movement=await this.readMove(tx,actor,prior[0]!.moveId);
    return {saved:true as const,replayed:true,item:await this.readPlacement(tx,actor,movement.destinationProposedPlacementId),movement};
   }
   const source=await this.readPlacement(tx,actor,command.sourceProposedPlacementId);
   if(source.movedToProposalId||source.draftGroupId===command.destinationDraftGroupId)throw new AppError("CONFLICT");
   const group=await tx.query<{ok:boolean}>(`SELECT true AS ok FROM ls_group_admin.draft_groups WHERE workspace_id=$1 AND id=$2`,
    [actor.workspaceId,command.destinationDraftGroupId]);
   if(group.length!==1)throw new AppError("NOT_FOUND");
   const occupied=await tx.query<{id:string}>(`SELECT id FROM ls_group_admin.proposed_placements
    WHERE workspace_id=$1 AND draft_group_id=$2 AND service_interest_id=$3`,
    [actor.workspaceId,command.destinationDraftGroupId,source.serviceInterestId]);
   if(occupied.length)throw new AppError("CONFLICT");
   const destinationId=randomUUID(),moveId=randomUUID(),createdAt=this.clock.now();
   const destinationDigest=this.placementDigest(actor.workspaceId,{action:"propose_group_placement",operationId:command.operationId,
    draftGroupId:command.destinationDraftGroupId,serviceInterestId:source.serviceInterestId});
   await tx.query(`INSERT INTO ls_group_admin.proposed_placements
    (workspace_id,id,draft_group_id,service_interest_id,service_type,family_id,person_id,recorded_by,request_digest,created_at)
    VALUES($1,$2,$3,$4,'group',$5,$6,$7,$8,$9)`,[actor.workspaceId,destinationId,command.destinationDraftGroupId,
     source.serviceInterestId,source.familyId,source.personId,actor.id,destinationDigest,createdAt]);
   await tx.query(`INSERT INTO ls_group_admin.proposed_placement_moves
    (workspace_id,id,source_proposed_placement_id,destination_proposed_placement_id,source_draft_group_id,destination_draft_group_id,
     service_interest_id,service_type,family_id,person_id,recorded_by,request_digest,created_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,'group',$8,$9,$10,$11,$12)`,[actor.workspaceId,moveId,source.id,destinationId,
     source.draftGroupId,command.destinationDraftGroupId,source.serviceInterestId,source.familyId,source.personId,actor.id,hash,createdAt]);
   await tx.query(`INSERT INTO ls_group_admin.proposed_placement_move_operations
    (workspace_id,operation_id,recorded_by,request_digest,proposed_placement_move_id) VALUES($1,$2,$3,$4,$5)`,
    [actor.workspaceId,command.operationId,actor.id,hash,moveId]);
   return {saved:true as const,replayed:false,item:await this.readPlacement(tx,actor,destinationId),movement:await this.readMove(tx,actor,moveId)};
  });
 }
 async proposeMeeting(actor:Actor,input:ProposedDraftMeetingCommand){
  const parsed=proposedDraftMeetingCommandSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const command=parsed.data,hash=this.meetingDigest(actor.workspaceId,command),times=this.resolveMeeting(command);
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const prior=await tx.query<{meetingRevisionId:string;requestDigest:string;recordedBy:string}>(`SELECT meeting_revision_id AS "meetingRevisionId",
    request_digest AS "requestDigest",recorded_by AS "recordedBy" FROM ls_group_admin.draft_meeting_operations
    WHERE workspace_id=$1 AND operation_id=$2`,[actor.workspaceId,command.operationId]);
   if(prior.length){if(prior.length!==1||prior[0]!.requestDigest!==hash||prior[0]!.recordedBy!==actor.id)throw new AppError("CONFLICT");
    return {saved:true as const,replayed:true,item:await this.readMeeting(tx,actor,prior[0]!.meetingRevisionId)};}
   const group=await tx.query<{ok:boolean}>(`SELECT true AS ok FROM ls_group_admin.draft_groups WHERE workspace_id=$1 AND id=$2`,
    [actor.workspaceId,command.draftGroupId]);if(group.length!==1)throw new AppError("NOT_FOUND");
   const id=randomUUID(),createdAt=this.clock.now();await tx.query(`INSERT INTO ls_group_admin.draft_meeting_revisions
    (workspace_id,id,occurrence_id,draft_group_id,previous_revision_id,state,time_zone,local_start,starts_at,ends_at,duration_minutes,
     venue_ciphertext,recorded_by,request_digest,created_at) VALUES($1,$2,$2,$3,NULL,'proposed',$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
    [actor.workspaceId,id,command.draftGroupId,command.timeZone,command.localStart,times.startsAt,times.endsAt,command.durationMinutes,
     seal(command.venue,meetingAad(actor.workspaceId,id),this.ring),actor.id,hash,createdAt]);
   await tx.query(`INSERT INTO ls_group_admin.draft_meeting_operations
    (workspace_id,operation_id,recorded_by,request_digest,meeting_revision_id) VALUES($1,$2,$3,$4,$5)`,
    [actor.workspaceId,command.operationId,actor.id,hash,id]);
   return {saved:true as const,replayed:false,item:await this.readMeeting(tx,actor,id)};
  });
 }
 async reviseMeeting(actor:Actor,input:ReviseDraftMeetingCommand){
  const parsed=reviseDraftMeetingCommandSchema.safeParse(input);if(!parsed.success)throw new AppError("INVALID_REQUEST");
  const command=parsed.data,hash=this.meetingDigest(actor.workspaceId,command),times=this.resolveMeeting(command);
  return this.db.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const prior=await tx.query<{meetingRevisionId:string;requestDigest:string;recordedBy:string}>(`SELECT meeting_revision_id AS "meetingRevisionId",
    request_digest AS "requestDigest",recorded_by AS "recordedBy" FROM ls_group_admin.draft_meeting_operations
    WHERE workspace_id=$1 AND operation_id=$2`,[actor.workspaceId,command.operationId]);
   if(prior.length){if(prior.length!==1||prior[0]!.requestDigest!==hash||prior[0]!.recordedBy!==actor.id)throw new AppError("CONFLICT");
    return {saved:true as const,replayed:true,item:await this.readMeeting(tx,actor,prior[0]!.meetingRevisionId)};}
   const source=await tx.query<MeetingRow>(`SELECT r.id,r.occurrence_id AS "occurrenceId",r.draft_group_id AS "draftGroupId",
    r.previous_revision_id AS "previousRevisionId",successor.id AS "nextRevisionId",r.time_zone AS "timeZone",r.local_start AS "localStart",
    r.starts_at AS "startsAt",r.ends_at AS "endsAt",r.duration_minutes AS "durationMinutes",r.venue_ciphertext AS "venueCiphertext",
    r.recorded_by AS "recordedBy",r.created_at AS "createdAt",r.request_digest AS "requestDigest"
    FROM ls_group_admin.draft_meeting_revisions r LEFT JOIN ls_group_admin.draft_meeting_revisions successor
     ON successor.workspace_id=r.workspace_id AND successor.previous_revision_id=r.id
    WHERE r.workspace_id=$1 AND r.id=$2 AND r.recorded_by=$3`,[actor.workspaceId,command.sourceRevisionId,actor.id]);
   if(source.length!==1)throw new AppError("NOT_FOUND");if(source[0]!.nextRevisionId)throw new AppError("CONFLICT");
   const id=randomUUID(),createdAt=this.clock.now(),item=source[0]!;await tx.query(`INSERT INTO ls_group_admin.draft_meeting_revisions
    (workspace_id,id,occurrence_id,draft_group_id,previous_revision_id,state,time_zone,local_start,starts_at,ends_at,duration_minutes,
     venue_ciphertext,recorded_by,request_digest,created_at) VALUES($1,$2,$3,$4,$5,'proposed',$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
    [actor.workspaceId,id,item.occurrenceId,item.draftGroupId,item.id,command.timeZone,command.localStart,times.startsAt,times.endsAt,
     command.durationMinutes,seal(command.venue,meetingAad(actor.workspaceId,id),this.ring),actor.id,hash,createdAt]);
   await tx.query(`INSERT INTO ls_group_admin.draft_meeting_operations
    (workspace_id,operation_id,recorded_by,request_digest,meeting_revision_id) VALUES($1,$2,$3,$4,$5)`,
    [actor.workspaceId,command.operationId,actor.id,hash,id]);
   return {saved:true as const,replayed:false,item:await this.readMeeting(tx,actor,id)};
  });
 }
 async list(actor:Actor){
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION READ ONLY");requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const drafts=await tx.query<DraftRow>(`SELECT id,label_ciphertext AS "labelCiphertext",recorded_by AS "recordedBy",
    created_at AS "createdAt",request_digest AS "requestDigest" FROM ls_group_admin.draft_groups
    WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 101`,[actor.workspaceId]);
   const interests=await tx.query<InterestRow>(`SELECT s.id,s.family_id AS "familyId",f.label_ciphertext AS "familyCiphertext",
    s.person_id AS "personId",p.profile_ciphertext AS "personCiphertext",s.recorded_by AS "recordedBy",s.created_at AS "createdAt"
    ,s.source_inquiry_id AS "sourceInquiryId",i.created_at AS "sourceInquiryCreatedAt"
    FROM ls_service_interest.service_interests s JOIN ls_cases.families f ON f.workspace_id=s.workspace_id AND f.id=s.family_id
    JOIN ls_identity.people p ON p.workspace_id=s.workspace_id AND p.id=s.person_id
    JOIN ls_service_interest.inquiries i ON i.workspace_id=s.workspace_id AND i.id=s.source_inquiry_id
    WHERE s.workspace_id=$1 AND s.service_type='group' ORDER BY s.created_at DESC,s.id DESC LIMIT 101`,[actor.workspaceId]);
   const placements=await tx.query<PlacementRow>(`SELECT pp.id,pp.draft_group_id AS "draftGroupId",pp.service_interest_id AS "serviceInterestId",
    pp.family_id AS "familyId",f.label_ciphertext AS "familyCiphertext",pp.person_id AS "personId",p.profile_ciphertext AS "personCiphertext",
    s.source_inquiry_id AS "sourceInquiryId",i.created_at AS "sourceInquiryCreatedAt",
    pp.recorded_by AS "recordedBy",pp.created_at AS "createdAt",incoming.source_proposed_placement_id AS "movedFromProposalId",
    outgoing.destination_proposed_placement_id AS "movedToProposalId" FROM ls_group_admin.proposed_placements pp
    JOIN ls_service_interest.service_interests s ON s.workspace_id=pp.workspace_id AND s.id=pp.service_interest_id
    JOIN ls_service_interest.inquiries i ON i.workspace_id=s.workspace_id AND i.id=s.source_inquiry_id
    JOIN ls_cases.families f ON f.workspace_id=pp.workspace_id AND f.id=pp.family_id
    JOIN ls_identity.people p ON p.workspace_id=pp.workspace_id AND p.id=pp.person_id
    LEFT JOIN ls_group_admin.proposed_placement_moves incoming ON incoming.workspace_id=pp.workspace_id AND incoming.destination_proposed_placement_id=pp.id
    LEFT JOIN ls_group_admin.proposed_placement_moves outgoing ON outgoing.workspace_id=pp.workspace_id AND outgoing.source_proposed_placement_id=pp.id
    WHERE pp.workspace_id=$1 ORDER BY pp.created_at DESC,pp.id DESC LIMIT 201`,[actor.workspaceId]);
   const movements=await tx.query<MoveRow>(`SELECT id,source_proposed_placement_id AS "sourceProposedPlacementId",
    destination_proposed_placement_id AS "destinationProposedPlacementId",source_draft_group_id AS "sourceDraftGroupId",
    destination_draft_group_id AS "destinationDraftGroupId",service_interest_id AS "serviceInterestId",family_id AS "familyId",
    person_id AS "personId",recorded_by AS "recordedBy",created_at AS "createdAt" FROM ls_group_admin.proposed_placement_moves
    WHERE workspace_id=$1 ORDER BY created_at,id LIMIT 201`,[actor.workspaceId]);
   const meetings=await tx.query<MeetingRow>(`SELECT r.id,r.occurrence_id AS "occurrenceId",r.draft_group_id AS "draftGroupId",
    r.previous_revision_id AS "previousRevisionId",successor.id AS "nextRevisionId",r.time_zone AS "timeZone",r.local_start AS "localStart",
    r.starts_at AS "startsAt",r.ends_at AS "endsAt",r.duration_minutes AS "durationMinutes",r.venue_ciphertext AS "venueCiphertext",
    r.recorded_by AS "recordedBy",r.created_at AS "createdAt",r.request_digest AS "requestDigest"
    FROM ls_group_admin.draft_meeting_revisions r LEFT JOIN ls_group_admin.draft_meeting_revisions successor
     ON successor.workspace_id=r.workspace_id AND successor.previous_revision_id=r.id
    WHERE r.workspace_id=$1 ORDER BY r.created_at,r.id LIMIT 201`,[actor.workspaceId]);
   if(drafts.length>100||interests.length>100||placements.length>200||movements.length>200||meetings.length>200)throw new AppError("UNAVAILABLE");
   const meetingRevisions=[];for(const row of meetings)meetingRevisions.push(this.meeting(actor.workspaceId,row,
    row.nextRevisionId?[]:await this.meetingConflicts(tx,actor,row)));
   return {draftGroups:drafts.map(row=>this.draft(actor.workspaceId,row)),eligibleGroupInterests:interests.map(row=>this.interest(actor.workspaceId,row)),
    proposedPlacements:placements.map(row=>this.placement(actor.workspaceId,row)),proposalMovements:this.orderedMovements(movements),meetingRevisions};
  });
 }
}
