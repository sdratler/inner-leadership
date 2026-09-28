import { randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import { asId } from "../../lib/ids.ts";
import { isVisibility,type Visibility } from "../../lib/visibility.ts";
import type { IdentityStore } from "../identity/store.ts";
import { one } from "../identity/store.ts";
import { accountById,freshActor,lockWorkspace } from "../identity/data.ts";
import type { IdentityConfig } from "../identity/config.ts";
import type { Actor,CaseId,AccountId,AudienceId,FamilyId,IdentityClock } from "../identity/types.ts";
import { seal,unseal } from "../identity/crypto.ts";
import { recordAction } from "../identity/history.ts";
import { loadCase,loadGuardians,loadAudience } from "./data.ts";
import { requirePractitioner,caseAccess,audienceAccess,isCaseLifecycle,type CaseLifecycle } from "./policy.ts";
import {CalendarStore,type TransactionContext} from '../calendar/store.ts';
export class CaseService {
 constructor(private readonly store:IdentityStore,private readonly config:IdentityConfig,private readonly clock:IdentityClock) {}
 async create(actor:Actor,input:{kind:'minor'|'adult';displayName:string;familyLabel:string;familyId?:FamilyId},requestId:string):Promise<{caseId:CaseId}> {
  return this.createWithOrigin(actor,input,requestId,null);
 }
 /** Internal operator path only: no public handler accepts a demo marker from a browser. */
 async createDemo(actor:Actor,input:{kind:'minor'|'adult';displayName:string;familyLabel:string},batchId:string,sourceKey:string,requestId:string):Promise<{caseId:CaseId}> {
  if(!/^ls-owner-[0-9]{8}$/.test(batchId)||!/^[a-z0-9_-]{1,80}$/.test(sourceKey)||!input.displayName.startsWith('DEMO')||!input.familyLabel.startsWith('DEMO'))throw new AppError('INVALID_REQUEST');
  return this.createWithOrigin(actor,input,requestId,{batchId,sourceKey});
 }
 /** Explicit one-shot operator capability. It is not reachable from an HTTP route and
  * verifies the existing active practitioner in the database; no session is forged. */
 async createDemoAsOperator(practitionerId:AccountId,input:{kind:'minor'|'adult';displayName:string;familyLabel:string},batchId:string,sourceKey:string,requestId:string,operatorPermission:boolean):Promise<{caseId:CaseId}> {
  if(operatorPermission!==true)throw new AppError('FORBIDDEN');
  if(!/^ls-owner-[0-9]{8}$/.test(batchId)||!/^[a-z0-9_-]{1,80}$/.test(sourceKey)||!input.displayName.startsWith('DEMO')||!input.familyLabel.startsWith('DEMO'))throw new AppError('INVALID_REQUEST');
  return this.createWithOrigin({id:practitionerId,workspaceId:this.config.workspaceId},input,requestId,{batchId,sourceKey},true);
 }
 private async createWithOrigin(actor:Actor|Pick<Actor,'id'|'workspaceId'>,input:{kind:'minor'|'adult';displayName:string;familyLabel:string;familyId?:FamilyId},requestId:string,demo:{batchId:string;sourceKey:string}|null,operator=false):Promise<{caseId:CaseId}> {
  const context={requestId,now:this.clock.now()};
  return this.store.transaction(async tx=>{
   if(actor.workspaceId!==this.config.workspaceId)throw new AppError('FORBIDDEN');
   await lockWorkspace(tx,actor.workspaceId);
   const current=operator?await accountById(tx,actor.workspaceId,actor.id):await freshActor(tx,actor as Actor,context.now);
   if(!current||current.state!=='active'||operator&&!current.emailVerifiedAt)throw new AppError('FORBIDDEN');
   requirePractitioner(current);
   if(operator&&await one(tx,'SELECT account_id FROM ls_demo.accounts WHERE workspace_id=$1 AND account_id=$2',[actor.workspaceId,actor.id]))throw new AppError('FORBIDDEN');
   if(demo){
    if(input.familyId)throw new AppError('INVALID_REQUEST');
    await tx.query('INSERT INTO ls_demo.batches(workspace_id,batch_id,created_by) VALUES($1,$2,$3) ON CONFLICT(workspace_id,batch_id) DO NOTHING',[actor.workspaceId,demo.batchId,actor.id]);
    const batch=await one<{createdBy:string}>(tx,'SELECT created_by AS "createdBy" FROM ls_demo.batches WHERE workspace_id=$1 AND batch_id=$2',[actor.workspaceId,demo.batchId]);
    if(batch?.createdBy!==actor.id)throw new AppError('CONFLICT');
    const previous=await one<{caseId:CaseId;kind:'minor'|'adult';personId:string;profileCiphertext:string;practitionerId:string}>(tx,`SELECT c.id AS "caseId",p.kind,p.id AS "personId",p.profile_ciphertext AS "profileCiphertext",c.practitioner_account_id AS "practitionerId"
     FROM ls_demo.cases d JOIN ls_cases.cases c ON c.workspace_id=d.workspace_id AND c.id=d.case_id
     JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id
     JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id
     WHERE d.workspace_id=$1 AND d.batch_id=$2 AND d.source_key=$3`,[actor.workspaceId,demo.batchId,demo.sourceKey]);
    if(previous){
     const profile:unknown=JSON.parse(unseal(previous.profileCiphertext,`person:${actor.workspaceId}:${previous.personId}`,this.config.keyring));
     if(previous.practitionerId!==actor.id||previous.kind!==input.kind||!profile||typeof profile!=='object'||!('displayName' in profile)||profile.displayName!==input.displayName)throw new AppError('CONFLICT');
     return {caseId:previous.caseId};
    }
   }
   const personId=asId(randomUUID(),'person'),clientId=randomUUID(),caseId=asId(randomUUID(),'case'),familyId=input.familyId ?? asId(randomUUID(),'family');
   if(input.familyId){if(!await one(tx,"SELECT id FROM ls_cases.families WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,familyId])) throw new AppError("NOT_FOUND");}
   else await tx.query("INSERT INTO ls_cases.families (id,workspace_id,label_ciphertext,created_at) VALUES ($1,$2,$3,$4)",[familyId,actor.workspaceId,seal(input.familyLabel,`family:${actor.workspaceId}:${familyId}`,this.config.keyring),context.now]);
   await tx.query("INSERT INTO ls_identity.people (id,workspace_id,kind,profile_ciphertext,created_at) VALUES ($1,$2,$3,$4,$5)",[personId,actor.workspaceId,input.kind,seal(JSON.stringify({displayName:input.displayName}),`person:${actor.workspaceId}:${personId}`,this.config.keyring),context.now]);
   await tx.query("INSERT INTO ls_cases.clients (id,workspace_id,person_id,created_at) VALUES ($1,$2,$3,$4)",[clientId,actor.workspaceId,personId,context.now]);
   await tx.query("INSERT INTO ls_cases.family_members (workspace_id,family_id,person_id,role) VALUES ($1,$2,$3,$4)",[actor.workspaceId,familyId,personId,input.kind==='minor'?'child':'adult_client']);
   await tx.query("INSERT INTO ls_cases.cases (id,workspace_id,client_id,family_id,practitioner_account_id,state,created_at,updated_at,demo_batch_id) VALUES ($1,$2,$3,$4,$5,'invited',$6,$6,$7)",[caseId,actor.workspaceId,clientId,familyId,actor.id,context.now,demo?.batchId??null]);
   if(demo){
    await tx.query('INSERT INTO ls_demo.cases(workspace_id,case_id,batch_id,source_key) VALUES($1,$2,$3,$4)',[actor.workspaceId,caseId,demo.batchId,demo.sourceKey]);
    for(const [kind,id] of [['person',personId],['client',clientId],['family',familyId]])
     await tx.query('INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,case_id) VALUES($1,$2,$3,$4,$5,$6)',[actor.workspaceId,demo.batchId,kind,id,`${demo.sourceKey}:${kind}`,caseId]);
   }
   await recordAction(tx,context,actor.workspaceId,actor.id,'case_created');return {caseId};
  });
 }
 /** Contained preparation of an already-created DEMO case; no fake payment,
  * invite, identity/session mutation or provider call. Real cases are denied by
  * immutable ancestry checks even if their display names begin with DEMO.
  */
 async prepareDemoCalendarAsOperator(practitionerId:AccountId,caseId:CaseId,batchId:string,key:string,
  requestId:string,permission:boolean):Promise<{caseId:CaseId;engagementId:string;audienceId:AudienceId;parentIds:AccountId[];accountIds:AccountId[]}>{
  const db=new CalendarStore(this.store,this.config.keyring,this.clock);
  const eligible=async(c:TransactionContext)=>{
   const {item}=await db.scope(c,caseId,true);
   const members=await c.tx.query<{id:AccountId;role:string;state:string;verified:boolean;batchId:string|null}>(`SELECT DISTINCT a.id,a.role,a.state,
    (a.email_verified_at IS NOT NULL) AS verified,d.batch_id AS "batchId"
    FROM ls_identity.accounts a JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id
    LEFT JOIN ls_demo.accounts d ON d.workspace_id=a.workspace_id AND d.account_id=a.id
    WHERE a.workspace_id=$1 AND (($3='minor' AND ((a.role='parent' AND EXISTS(SELECT 1 FROM ls_cases.case_guardians g
     WHERE g.workspace_id=a.workspace_id AND g.case_id=$2 AND g.account_id=a.id AND g.revoked_at IS NULL)) OR (a.role='child' AND s.person_id=$4)))
     OR ($3='adult' AND a.role='adult_client' AND s.person_id=$4)) ORDER BY a.id`,[c.workspace,caseId,item.kind,item.clientPersonId]);
   if(members.length<1||members.length>3||members.some(m=>m.state!=='active'||!m.verified||m.batchId!==batchId)||
    item.kind==='minor'&&(!members.some(m=>m.role==='parent')||!members.some(m=>m.role==='child'))||
    item.kind==='adult'&&(members.length!==1||members[0]?.role!=='adult_client'))throw new AppError('CONFLICT');
   // Existing synthetic configuration is reused only if its exact current
   // audience agrees. Revoked/unpublished grants are not silently reinstated.
   const prior=await c.tx.query<{id:AudienceId;published:boolean}>(`SELECT id,published FROM ls_cases.audiences
    WHERE workspace_id=$1 AND case_id=$2 AND visibility='family_full' ORDER BY id LIMIT 2`,[c.workspace,caseId]);
   if(prior.length>1)throw new AppError('CONFLICT');
   if(prior[0]){const audience=await loadAudience(c.tx,c.workspace,caseId,prior[0].id);
    if(!audience?.published||JSON.stringify([...audience.accountIds].sort())!==JSON.stringify(members.map(m=>m.id).sort()))throw new AppError('CONFLICT');}
   const engagements=await c.tx.query<{id:string;termsVersion:string;currency:string;rate:number;target:number}>(`SELECT id,terms_version AS "termsVersion",currency,
    appointment_rate_minor AS rate,attended_review_target AS target FROM ls_cases.engagements WHERE workspace_id=$1 AND case_id=$2 AND state='active' LIMIT 2`,[c.workspace,caseId]);
   if(engagements.length>1||engagements.some(e=>e.termsVersion!=='Product2.3'||e.currency!=='ILS'||e.rate!==55000||e.target!==12)||
    item.state==='active'&&(!engagements.length||!prior.length))throw new AppError('CONFLICT');
   return {item,members,audienceId:prior[0]?.id??null,engagementId:engagements[0]?.id??null};
  };
  return db.demoOperatorCommand(this.config.workspaceId,practitionerId,caseId,batchId,'demo:case:prepare',key,
   {recipe:'owner-calendar-v1'},permission,eligible,async c=>{
    const {item,members,audienceId:previousAudience,engagementId:previousEngagement}=await eligible(c);
    const historyContext={requestId,now:new Date(c.now)},engagementId=previousEngagement??randomUUID();
    if(!previousEngagement){await c.tx.query(`INSERT INTO ls_cases.engagements(id,workspace_id,case_id,terms_version,currency,
     appointment_rate_minor,attended_review_target,state,created_at) VALUES($1,$2,$3,'Product2.3','ILS',55000,12,'active',$4)`,[engagementId,c.workspace,caseId,c.now]);
     await recordAction(c.tx,historyContext,c.workspace,c.actor.id,'engagement_created');}
    const audienceId=previousAudience??asId(randomUUID(),'audience');
    if(!previousAudience){
     await c.tx.query(`INSERT INTO ls_cases.audiences(id,workspace_id,case_id,visibility,published,created_at)
      VALUES($1,$2,$3,'family_full',true,$4)`,[audienceId,c.workspace,caseId,c.now]);
     for(const m of members)await c.tx.query(`INSERT INTO ls_cases.audience_accounts(workspace_id,case_id,audience_id,account_id,granted_at)
      VALUES($1,$2,$3,$4,$5)`,[c.workspace,caseId,audienceId,m.id,c.now]);
     await recordAction(c.tx,historyContext,c.workspace,c.actor.id,'audience_created');
    }
    if(item.state!=='active'){await c.tx.query("UPDATE ls_cases.cases SET state='active',updated_at=$3 WHERE workspace_id=$1 AND id=$2",[c.workspace,caseId,c.now]);
     await recordAction(c.tx,historyContext,c.workspace,c.actor.id,'case_status_changed');}
    return {caseId,engagementId,audienceId,parentIds:members.filter(m=>m.role==='parent').map(m=>m.id),accountIds:members.map(m=>m.id)};
   });
 }
 async list(actor:Actor,mode?:'live'|'demo'):Promise<Array<{id:CaseId;kind:'minor'|'adult';state:CaseLifecycle;displayName:string;mode:'live'|'demo'}>> {
  if(mode!==undefined&&mode!=='live'&&mode!=='demo')throw new AppError('INVALID_REQUEST');
  return this.store.transaction(async tx=>{
   const current=await freshActor(tx,actor,this.clock.now());
   if(mode!==undefined&&current.role!=='practitioner')throw new AppError('FORBIDDEN');
   const rows=await tx.query<{id:CaseId;kind:'minor'|'adult';state:CaseLifecycle;personId:string;profileCiphertext:string;demoBatchId:string|null;markerBatchId:string|null}>(`SELECT c.id,p.kind,c.state,p.id AS "personId",p.profile_ciphertext AS "profileCiphertext",
    c.demo_batch_id AS "demoBatchId",d.batch_id AS "markerBatchId"
    FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id
    JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id
    LEFT JOIN ls_demo.cases d ON d.workspace_id=c.workspace_id AND d.case_id=c.id WHERE c.workspace_id=$1 AND
    (($3='practitioner' AND c.practitioner_account_id=$2) OR
     ($3='adult_client' AND p.kind='adult' AND p.id=$4) OR
     ($3='child' AND p.kind='minor' AND p.id=$4) OR
     ($3='parent' AND p.kind='minor' AND EXISTS(SELECT 1 FROM ls_cases.case_guardians g WHERE g.workspace_id=c.workspace_id AND g.case_id=c.id AND g.account_id=$2 AND g.revoked_at IS NULL)))
    AND (c.demo_batch_id IS DISTINCT FROM d.batch_id OR $5::text IS NULL OR
     ($5='live' AND c.demo_batch_id IS NULL) OR ($5='demo' AND c.demo_batch_id IS NOT NULL))
    ORDER BY c.created_at DESC,c.id LIMIT 100`,[actor.workspaceId,actor.id,current.role,current.personId,mode??null]);
   return rows.map(row=>{
    // Preserve authorized DEMO contexts, but never classify synthetic roots by
    // display name or treat missing/inconsistent ancestry as a live record.
    if(row.demoBatchId!==row.markerBatchId||row.demoBatchId!==null&&
     (typeof row.demoBatchId!=='string'||!/^ls-owner-[0-9]{8}$/.test(row.demoBatchId)))throw new AppError('UNAVAILABLE');
    const payload:unknown=JSON.parse(unseal(row.profileCiphertext,`person:${actor.workspaceId}:${row.personId}`,this.config.keyring));
    if(!payload || typeof payload!=='object' || !('displayName' in payload) || typeof payload.displayName!=='string') throw new AppError("UNAVAILABLE");
    return {id:row.id,kind:row.kind,state:row.state,displayName:payload.displayName,mode:row.demoBatchId===null?'live':'demo'};
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
    (($3='minor' AND ((a.role='parent' AND EXISTS(SELECT 1 FROM ls_cases.case_guardians g WHERE g.workspace_id=a.workspace_id AND g.case_id=$2 AND g.account_id=a.id AND g.revoked_at IS NULL)) OR (a.role='child' AND s.person_id=$4))) OR
     ($3='adult' AND a.role='adult_client' AND s.person_id=$4)) ORDER BY a.id`,[actor.workspaceId,caseId,item.kind,item.clientPersonId]);
   const allowed=eligible.map(x=>x.id),ids=input.visibility==='private'?[]:[...(input.accountIds ?? allowed)];
   if(input.visibility==='private' && input.accountIds?.length) throw new AppError("INVALID_REQUEST");
   if(new Set(ids).size!==ids.length || ids.length>3 || ids.some(id=>!allowed.includes(id))) throw new AppError("NOT_FOUND");
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
 async caseAccessInfo(actor:Actor,caseId:CaseId) {
  return this.store.transaction(async tx=>{
   const current=await freshActor(tx,actor,this.clock.now());requirePractitioner(current);
   const item=await loadCase(tx,actor.workspaceId,caseId),guardians=await loadGuardians(tx,actor.workspaceId,caseId);
   caseAccess(current,item,guardians,'read');if(!item)throw new AppError('NOT_FOUND');
   const rows=await tx.query<{accountId:AccountId;personId:string;profileCiphertext:string;emailCiphertext:string;locale:'he'|'en';role:'parent'|'adult_client'|'child';state:'invited'|'active'|'revoked';guardianRevokedAt:string|null}>(`SELECT a.id AS "accountId",p.id AS "personId",p.profile_ciphertext AS "profileCiphertext",a.email_ciphertext AS "emailCiphertext",a.locale,a.role,a.state,g.revoked_at::text AS "guardianRevokedAt"
    FROM ls_identity.accounts a JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id
    JOIN ls_identity.people p ON p.workspace_id=s.workspace_id AND p.id=s.person_id
    LEFT JOIN ls_cases.case_guardians g ON g.workspace_id=a.workspace_id AND g.account_id=a.id AND g.case_id=$2
    WHERE a.workspace_id=$1 AND (($3='minor' AND ((a.role='parent' AND g.case_id=$2) OR (a.role='child' AND p.id=$4))) OR ($3='adult' AND a.role='adult_client' AND p.id=$4))
    ORDER BY a.created_at,a.id LIMIT 50`,[actor.workspaceId,caseId,item.kind,item.clientPersonId]);
   const members=rows.map(row=>{
    const profile:unknown=JSON.parse(unseal(row.profileCiphertext,`person:${actor.workspaceId}:${row.personId}`,this.config.keyring));
    if(!profile||typeof profile!=='object'||!('displayName' in profile)||typeof profile.displayName!=='string')throw new AppError('UNAVAILABLE');
    return {accountId:row.accountId,displayName:profile.displayName,email:unseal(row.emailCiphertext,`email:${actor.workspaceId}:${row.accountId}`,this.config.keyring),locale:row.locale,role:row.role,state:row.state,guardianRevokedAt:row.guardianRevokedAt};
   });
   return {caseId,kind:item.kind,childAccountsEnabled:this.config.childAccountsEnabled===true,members};
  });
 }
 async audiences(actor:Actor,caseId:CaseId):Promise<Array<{id:AudienceId;visibility:Visibility;published:boolean}>> {
  return this.store.transaction(async tx=>{
   const current=await freshActor(tx,actor,this.clock.now()),item=await loadCase(tx,actor.workspaceId,caseId),guardians=await loadGuardians(tx,actor.workspaceId,caseId);
   caseAccess(current,item,guardians,'read');
   const rows=await tx.query<{id:AudienceId;visibility:Visibility;published:boolean}>("SELECT id,visibility,published FROM ls_cases.audiences WHERE workspace_id=$1 AND case_id=$2 AND published ORDER BY created_at DESC,id",[actor.workspaceId,caseId]);
   if(current.role==='practitioner')return rows;
   const allowed:typeof rows=[];
   for(const row of rows){const audience=await loadAudience(tx,actor.workspaceId,caseId,row.id);if(!audience)continue;try{audienceAccess(current,item,guardians,audience);allowed.push(row)}catch(error){if(!(error instanceof AppError)||error.code!=='NOT_FOUND')throw error}}
   return allowed;
  });
 }
}
