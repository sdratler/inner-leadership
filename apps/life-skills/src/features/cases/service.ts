import { randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import { asId } from "../../lib/ids.ts";
import { isVisibility,type Visibility } from "../../lib/visibility.ts";
import type { IdentityStore } from "../identity/store.ts";
import { one } from "../identity/store.ts";
import { freshActor,lockWorkspace } from "../identity/data.ts";
import type { IdentityConfig } from "../identity/config.ts";
import type { Actor,CaseId,AccountId,AudienceId,FamilyId,IdentityClock } from "../identity/types.ts";
import { seal,unseal } from "../identity/crypto.ts";
import { recordAction } from "../identity/history.ts";
import { loadCase,loadGuardians,loadAudience } from "./data.ts";
import { requirePractitioner,caseAccess,audienceAccess,isCaseLifecycle,type CaseLifecycle } from "./policy.ts";
export class CaseService {
 constructor(private readonly store:IdentityStore,private readonly config:IdentityConfig,private readonly clock:IdentityClock) {}
 async create(actor:Actor,input:{kind:'minor'|'adult';displayName:string;familyLabel:string;familyId?:FamilyId},requestId:string):Promise<{caseId:CaseId}> {
  const context={requestId,now:this.clock.now()};
  return this.store.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);const current=await freshActor(tx,actor,context.now);requirePractitioner(current);
   const personId=asId(randomUUID(),'person'),clientId=randomUUID(),caseId=asId(randomUUID(),'case'),familyId=input.familyId ?? asId(randomUUID(),'family');
   if(input.familyId){if(!await one(tx,"SELECT id FROM ls_cases.families WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,familyId])) throw new AppError("NOT_FOUND");}
   else await tx.query("INSERT INTO ls_cases.families (id,workspace_id,label_ciphertext,created_at) VALUES ($1,$2,$3,$4)",[familyId,actor.workspaceId,seal(input.familyLabel,`family:${actor.workspaceId}:${familyId}`,this.config.keyring),context.now]);
   await tx.query("INSERT INTO ls_identity.people (id,workspace_id,kind,profile_ciphertext,created_at) VALUES ($1,$2,$3,$4,$5)",[personId,actor.workspaceId,input.kind,seal(JSON.stringify({displayName:input.displayName}),`person:${actor.workspaceId}:${personId}`,this.config.keyring),context.now]);
   await tx.query("INSERT INTO ls_cases.clients (id,workspace_id,person_id,created_at) VALUES ($1,$2,$3,$4)",[clientId,actor.workspaceId,personId,context.now]);
   await tx.query("INSERT INTO ls_cases.family_members (workspace_id,family_id,person_id,role) VALUES ($1,$2,$3,$4)",[actor.workspaceId,familyId,personId,input.kind==='minor'?'child':'adult_client']);
   await tx.query("INSERT INTO ls_cases.cases (id,workspace_id,client_id,family_id,practitioner_account_id,state,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,'invited',$6,$6)",[caseId,actor.workspaceId,clientId,familyId,actor.id,context.now]);
   await recordAction(tx,context,actor.workspaceId,actor.id,'case_created');return {caseId};
  });
 }
 async list(actor:Actor):Promise<Array<{id:CaseId;kind:'minor'|'adult';state:CaseLifecycle;displayName:string}>> {
  return this.store.transaction(async tx=>{
   const current=await freshActor(tx,actor,this.clock.now());
   const rows=await tx.query<{id:CaseId;kind:'minor'|'adult';state:CaseLifecycle;personId:string;profileCiphertext:string}>(`SELECT c.id,p.kind,c.state,p.id AS "personId",p.profile_ciphertext AS "profileCiphertext"
    FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id
    JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id WHERE c.workspace_id=$1 AND
    (($3='practitioner' AND c.practitioner_account_id=$2) OR
     ($3='adult_client' AND p.kind='adult' AND p.id=$4) OR
     ($3='parent' AND p.kind='minor' AND EXISTS(SELECT 1 FROM ls_cases.case_guardians g WHERE g.workspace_id=c.workspace_id AND g.case_id=c.id AND g.account_id=$2 AND g.revoked_at IS NULL)))
    ORDER BY c.created_at DESC,c.id LIMIT 100`,[actor.workspaceId,actor.id,current.role,current.personId]);
   return rows.map(row=>{
    const payload:unknown=JSON.parse(unseal(row.profileCiphertext,`person:${actor.workspaceId}:${row.personId}`,this.config.keyring));
    if(!payload || typeof payload!=='object' || !('displayName' in payload) || typeof payload.displayName!=='string') throw new AppError("UNAVAILABLE");
    return {id:row.id,kind:row.kind,state:row.state,displayName:payload.displayName};
   });
  });
 }
 async changeState(actor:Actor,caseId:CaseId,state:CaseLifecycle,requestId:string):Promise<void> {
  if(!isCaseLifecycle(state)) throw new AppError("INVALID_REQUEST");
  const context={requestId,now:this.clock.now()};
  await this.store.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);const account=await freshActor(tx,actor,context.now);
   caseAccess(account,await loadCase(tx,actor.workspaceId,caseId),await loadGuardians(tx,actor.workspaceId,caseId),'write');
   await tx.query("UPDATE ls_cases.cases SET state=$3,updated_at=$4 WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,caseId,state,context.now]);
   await recordAction(tx,context,actor.workspaceId,actor.id,'case_status_changed');
  });
 }
 async createEngagement(actor:Actor,caseId:CaseId,input:{rateMinor:number;attendedReviewTarget:number},requestId:string):Promise<{engagementId:string}> {
  const context={requestId,now:this.clock.now()};
  return this.store.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);const account=await freshActor(tx,actor,context.now),item=await loadCase(tx,actor.workspaceId,caseId);
   caseAccess(account,item,await loadGuardians(tx,actor.workspaceId,caseId),'write');
   if(!item) throw new AppError("NOT_FOUND");
   if(item.kind==='minor' && (input.rateMinor!==55000 || input.attendedReviewTarget!==12)) throw new AppError("CONFLICT");
   if(await one(tx,"SELECT id FROM ls_cases.engagements WHERE workspace_id=$1 AND case_id=$2 AND state='active'",[actor.workspaceId,caseId])) throw new AppError("CONFLICT");
   const id=randomUUID();
   await tx.query("INSERT INTO ls_cases.engagements (id,workspace_id,case_id,terms_version,currency,appointment_rate_minor,attended_review_target,state,created_at) VALUES ($1,$2,$3,'Product2.3','ILS',$4,$5,'active',$6)",[id,actor.workspaceId,caseId,input.rateMinor,input.attendedReviewTarget,context.now]);
   await recordAction(tx,context,actor.workspaceId,actor.id,'engagement_created');return {engagementId:id};
  });
 }
 async createAudience(actor:Actor,caseId:CaseId,input:{visibility:Visibility;published:boolean;accountIds?:readonly AccountId[]},requestId:string):Promise<{audienceId:AudienceId;accountIds:readonly AccountId[]}> {
  if(!isVisibility(input.visibility)) throw new AppError("INVALID_REQUEST");
  const context={requestId,now:this.clock.now()};
  return this.store.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);const current=await freshActor(tx,actor,context.now),item=await loadCase(tx,actor.workspaceId,caseId),guardians=await loadGuardians(tx,actor.workspaceId,caseId);
   caseAccess(current,item,guardians,'publish');if(!item) throw new AppError("NOT_FOUND");
   const eligible=await tx.query<{id:AccountId}>(`SELECT a.id FROM ls_identity.accounts a JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id
    WHERE a.workspace_id=$1 AND a.state<>'revoked' AND
    (($3='minor' AND a.role='parent' AND EXISTS(SELECT 1 FROM ls_cases.case_guardians g WHERE g.workspace_id=a.workspace_id AND g.case_id=$2 AND g.account_id=a.id AND g.revoked_at IS NULL)) OR
     ($3='adult' AND a.role='adult_client' AND s.person_id=$4)) ORDER BY a.id`,[actor.workspaceId,caseId,item.kind,item.clientPersonId]);
   const allowed=eligible.map(x=>x.id),ids=input.visibility==='private'?[]:[...(input.accountIds ?? allowed)];
   if(input.visibility==='private' && input.accountIds?.length) throw new AppError("INVALID_REQUEST");
   if(new Set(ids).size!==ids.length || ids.length>2 || ids.some(id=>!allowed.includes(id))) throw new AppError("NOT_FOUND");
   const audienceId=asId(randomUUID(),'audience');
   await tx.query("INSERT INTO ls_cases.audiences (id,workspace_id,case_id,visibility,published,created_at) VALUES ($1,$2,$3,$4,$5,$6)",[audienceId,actor.workspaceId,caseId,input.visibility,input.published,context.now]);
   for(const id of ids) await tx.query("INSERT INTO ls_cases.audience_accounts (workspace_id,case_id,audience_id,account_id,granted_at) VALUES ($1,$2,$3,$4,$5)",[actor.workspaceId,caseId,audienceId,id,context.now]);
   await recordAction(tx,context,actor.workspaceId,actor.id,'audience_created');return {audienceId,accountIds:ids};
  });
 }
 async audience(actor:Actor,caseId:CaseId,id:AudienceId):Promise<{id:AudienceId;visibility:Visibility;published:boolean}> {
  return this.store.transaction(async tx=>{
   const current=await freshActor(tx,actor,this.clock.now()),item=await loadAudience(tx,actor.workspaceId,caseId,id);
   if(!item) throw new AppError("NOT_FOUND");
   audienceAccess(current,await loadCase(tx,actor.workspaceId,caseId),await loadGuardians(tx,actor.workspaceId,caseId),item);
   // Other recipients' account identifiers are not exposed by this read model.
   return {id:item.id,visibility:item.visibility,published:item.published};
  });
 }
}
