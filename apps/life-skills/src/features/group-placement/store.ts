import "server-only";
import {randomUUID} from "node:crypto";
import {AppError} from "../../lib/errors.ts";
import type {IdentityStore,SqlSession} from "../identity/store.ts";
import {freshActor,lockWorkspace} from "../identity/data.ts";
import {requirePractitioner} from "../cases/policy.ts";
import {seal,unseal,type Keyring} from "../identity/crypto.ts";
import {systemClock,type Actor,type IdentityClock} from "../identity/types.ts";
import {privateDigest} from "../contact-ops/server/digests.ts";
import {draftGroupCommandSchema,proposedPlacementCommandSchema,type DraftGroupCommand,type DraftGroupRecord,
 type EligibleGroupInterest,type ProposedPlacementCommand,type ProposedPlacementRecord} from "./contract.ts";

type DraftRow={id:string;labelCiphertext:string;recordedBy:string;createdAt:Date;requestDigest:string};
type InterestRow={id:string;familyId:string;familyCiphertext:string;personId:string;personCiphertext:string;recordedBy:string;createdAt:Date};
type PlacementRow=InterestRow&{draftGroupId:string;serviceInterestId:string};
const draftAad=(workspace:string,id:string)=>`ls_group_admin/draft_group/v1/${workspace}/${id}`;

export class GroupPlacementStore{
 constructor(private readonly db:IdentityStore,private readonly ring:Keyring,private readonly key:string,
  private readonly clock:IdentityClock=systemClock){}
 private draftDigest(workspace:string,label:string){return privateDigest({domain:"draft-group/v1",workspace,fields:{label}},this.key);}
 private placementDigest(workspace:string,command:ProposedPlacementCommand){return privateDigest({domain:"proposed-placement/v1",workspace,
  fields:{draftGroupId:command.draftGroupId,serviceInterestId:command.serviceInterestId}},this.key);}
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
  ...this.identity(workspace,row),recordedBy:row.recordedBy,createdAt:row.createdAt.toISOString()};}
 private placement(workspace:string,row:PlacementRow):ProposedPlacementRecord{return {id:row.id,state:"proposed_placement",
  draftGroupId:row.draftGroupId,serviceInterestId:row.serviceInterestId,...this.identity(workspace,row),recordedBy:row.recordedBy,createdAt:row.createdAt.toISOString()};}
 private async readDraft(tx:SqlSession,actor:Actor,id:string){
  const rows=await tx.query<DraftRow>(`SELECT id,label_ciphertext AS "labelCiphertext",recorded_by AS "recordedBy",
   created_at AS "createdAt",request_digest AS "requestDigest" FROM ls_group_admin.draft_groups WHERE workspace_id=$1 AND id=$2`,[actor.workspaceId,id]);
  if(rows.length!==1)throw new AppError("UNAVAILABLE");return this.draft(actor.workspaceId,rows[0]!);
 }
 private async readPlacement(tx:SqlSession,actor:Actor,id:string){
  const rows=await tx.query<PlacementRow>(`SELECT pp.id,pp.draft_group_id AS "draftGroupId",pp.service_interest_id AS "serviceInterestId",
   pp.family_id AS "familyId",f.label_ciphertext AS "familyCiphertext",pp.person_id AS "personId",p.profile_ciphertext AS "personCiphertext",
   pp.recorded_by AS "recordedBy",pp.created_at AS "createdAt" FROM ls_group_admin.proposed_placements pp
   JOIN ls_cases.families f ON f.workspace_id=pp.workspace_id AND f.id=pp.family_id
   JOIN ls_identity.people p ON p.workspace_id=pp.workspace_id AND p.id=pp.person_id
   WHERE pp.workspace_id=$1 AND pp.id=$2`,[actor.workspaceId,id]);
  if(rows.length!==1)throw new AppError("UNAVAILABLE");return this.placement(actor.workspaceId,rows[0]!);
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
 async list(actor:Actor){
  return this.db.transaction(async tx=>{
   await tx.query("SET TRANSACTION READ ONLY");requirePractitioner(await freshActor(tx,actor,this.clock.now()));
   const drafts=await tx.query<DraftRow>(`SELECT id,label_ciphertext AS "labelCiphertext",recorded_by AS "recordedBy",
    created_at AS "createdAt",request_digest AS "requestDigest" FROM ls_group_admin.draft_groups
    WHERE workspace_id=$1 ORDER BY created_at DESC,id DESC LIMIT 101`,[actor.workspaceId]);
   const interests=await tx.query<InterestRow>(`SELECT s.id,s.family_id AS "familyId",f.label_ciphertext AS "familyCiphertext",
    s.person_id AS "personId",p.profile_ciphertext AS "personCiphertext",s.recorded_by AS "recordedBy",s.created_at AS "createdAt"
    FROM ls_service_interest.service_interests s JOIN ls_cases.families f ON f.workspace_id=s.workspace_id AND f.id=s.family_id
    JOIN ls_identity.people p ON p.workspace_id=s.workspace_id AND p.id=s.person_id
    WHERE s.workspace_id=$1 AND s.service_type='group' ORDER BY s.created_at DESC,s.id DESC LIMIT 101`,[actor.workspaceId]);
   const placements=await tx.query<PlacementRow>(`SELECT pp.id,pp.draft_group_id AS "draftGroupId",pp.service_interest_id AS "serviceInterestId",
    pp.family_id AS "familyId",f.label_ciphertext AS "familyCiphertext",pp.person_id AS "personId",p.profile_ciphertext AS "personCiphertext",
    pp.recorded_by AS "recordedBy",pp.created_at AS "createdAt" FROM ls_group_admin.proposed_placements pp
    JOIN ls_cases.families f ON f.workspace_id=pp.workspace_id AND f.id=pp.family_id
    JOIN ls_identity.people p ON p.workspace_id=pp.workspace_id AND p.id=pp.person_id
    WHERE pp.workspace_id=$1 ORDER BY pp.created_at DESC,pp.id DESC LIMIT 201`,[actor.workspaceId]);
   if(drafts.length>100||interests.length>100||placements.length>200)throw new AppError("UNAVAILABLE");
   return {draftGroups:drafts.map(row=>this.draft(actor.workspaceId,row)),eligibleGroupInterests:interests.map(row=>this.interest(actor.workspaceId,row)),
    proposedPlacements:placements.map(row=>this.placement(actor.workspaceId,row))};
  });
 }
}
