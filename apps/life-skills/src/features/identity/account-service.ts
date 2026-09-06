import { randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import { asId } from "../../lib/ids.ts";
import type { IdentityStore,SqlSession } from "./store.ts";
import { one } from "./store.ts";
import { accountById,accountByEmail,lockWorkspace,freshActor,revokeSessions,revokeTokens } from "./data.ts";
import type { AccountRow } from "./data.ts";
import { seal,blindEmail,canonicalEmail } from "./crypto.ts";
import type { IdentityConfig } from "./config.ts";
import type { Actor,AccountId,PersonId,CaseId,Locale,RequestContext,IdentityClock,AccountRole } from "./types.ts";
import { requirePractitioner,caseAccess } from "../cases/policy.ts";
import { loadCase,loadGuardians } from "../cases/data.ts";
import { recordAction } from "./history.ts";
import { issueAuthToken,queueAuthMail } from "./auth-mail.ts";
export interface InviteInput {caseId:CaseId;email:string;displayName:string;locale:Locale;}
async function createAdultAccount(tx:SqlSession,config:IdentityConfig,context:RequestContext,
 input:{email:string;displayName:string;locale:Locale;role:AccountRole;personId?:PersonId}):Promise<AccountRow> {
 const id=asId(randomUUID(),'account'),personId=input.personId ?? asId(randomUUID(),'person');
 if (!input.personId) await tx.query("INSERT INTO ls_identity.people (id,workspace_id,kind,profile_ciphertext,created_at) VALUES ($1,$2,'adult',$3,$4)",[personId,config.workspaceId,seal(JSON.stringify({displayName:input.displayName}),`person:${config.workspaceId}:${personId}`,config.keyring),context.now]);
 else if (!await one(tx,"SELECT id FROM ls_identity.people WHERE workspace_id=$1 AND id=$2 AND kind='adult'",[config.workspaceId,personId])) throw new AppError("NOT_FOUND");
 await tx.query("INSERT INTO ls_identity.accounts (id,workspace_id,role,state,locale,email_blind,email_ciphertext,created_at,updated_at) VALUES ($1,$2,$3,'invited',$4,$5,$6,$7,$7)",[id,config.workspaceId,input.role,input.locale,blindEmail(input.email,config.lookupKey),seal(canonicalEmail(input.email),`email:${config.workspaceId}:${id}`,config.keyring),context.now]);
 await tx.query("INSERT INTO ls_identity.account_subjects (workspace_id,account_id,person_id) VALUES ($1,$2,$3)",[config.workspaceId,id,personId]);
 const row=await accountById(tx,config.workspaceId,id);if(!row) throw new AppError("INTERNAL");return row;
}
export class IdentityAccountService {
 constructor(private readonly store:IdentityStore,private readonly config:IdentityConfig,private readonly clock:IdentityClock) {}
 async inviteParent(actor:Actor,input:InviteInput,requestId:string):Promise<{accountId:AccountId}> {
  const context={requestId,now:this.clock.now()};
  return this.store.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);const current=await freshActor(tx,actor,context.now);requirePractitioner(current);
   const item=await loadCase(tx,actor.workspaceId,input.caseId),guardians=await loadGuardians(tx,actor.workspaceId,input.caseId);
   caseAccess(current,item,guardians,'write');if(!item || item.kind!=='minor') throw new AppError("NOT_FOUND");
   let account=await accountByEmail(tx,actor.workspaceId,blindEmail(input.email,this.config.lookupKey));
   if (account && (account.role!=='parent' || account.state==='revoked')) throw new AppError("CONFLICT");
   const already=account && guardians.some(g=>g.accountId===account!.id && !g.revoked);
   if (!already && guardians.filter(g=>!g.revoked).length>=2) throw new AppError("CONFLICT");
   if (!account) account=await createAdultAccount(tx,this.config,context,{...input,role:'parent'});
   await tx.query("INSERT INTO ls_cases.case_guardians (workspace_id,case_id,account_id,granted_at) VALUES ($1,$2,$3,$4) ON CONFLICT(workspace_id,case_id,account_id) DO UPDATE SET granted_at=EXCLUDED.granted_at,revoked_at=NULL",[actor.workspaceId,item.id,account.id,context.now]);
   await tx.query("INSERT INTO ls_cases.family_members (workspace_id,family_id,person_id,role) SELECT workspace_id,family_id,$3,'parent' FROM ls_cases.cases WHERE workspace_id=$1 AND id=$2 AND family_id IS NOT NULL ON CONFLICT DO NOTHING",[actor.workspaceId,item.id,account.personId]);
   if (account.state==='invited') await issueAuthToken(tx,this.config,account,context,'invite');
   else await queueAuthMail(tx,this.config,account,context,'case_notice',null);
   // No existing audience grant is inserted or un-revoked by an invitation.
   await recordAction(tx,context,actor.workspaceId,actor.id,'invite_queued');return {accountId:account.id};
  });
 }
 async inviteAdult(actor:Actor,input:InviteInput,requestId:string):Promise<{accountId:AccountId}> {
  const context={requestId,now:this.clock.now()};
  return this.store.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);const current=await freshActor(tx,actor,context.now);requirePractitioner(current);
   const item=await loadCase(tx,actor.workspaceId,input.caseId);caseAccess(current,item,[],'write');
   if(!item || item.kind!=='adult') throw new AppError("NOT_FOUND");
   let account=await accountByEmail(tx,actor.workspaceId,blindEmail(input.email,this.config.lookupKey));
   if(account && (account.role!=='adult_client' || account.state==='revoked' || account.personId!==item.clientPersonId)) throw new AppError("CONFLICT");
   const linked=await one<{accountId:AccountId}>(tx,"SELECT account_id AS \"accountId\" FROM ls_identity.account_subjects WHERE workspace_id=$1 AND person_id=$2",[actor.workspaceId,item.clientPersonId]);
   if(linked && linked.accountId!==account?.id) throw new AppError("CONFLICT");
   if(!account) account=await createAdultAccount(tx,this.config,context,{...input,role:'adult_client',personId:item.clientPersonId});
   if(account.state==='invited') await issueAuthToken(tx,this.config,account,context,'invite');
   else await queueAuthMail(tx,this.config,account,context,'case_notice',null);
   await recordAction(tx,context,actor.workspaceId,actor.id,'invite_queued');return {accountId:account.id};
  });
 }
 async revokeGuardian(actor:Actor,caseId:CaseId,accountId:AccountId,requestId:string):Promise<void> {
  const context={requestId,now:this.clock.now()};
  await this.store.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);const current=await freshActor(tx,actor,context.now);requirePractitioner(current);
   caseAccess(current,await loadCase(tx,actor.workspaceId,caseId),await loadGuardians(tx,actor.workspaceId,caseId),'write');
   const changed=await tx.query("UPDATE ls_cases.case_guardians SET revoked_at=$4 WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3 AND revoked_at IS NULL RETURNING account_id",[actor.workspaceId,caseId,accountId,context.now]);
   if(changed.length!==1) throw new AppError("NOT_FOUND");
   await tx.query("UPDATE ls_cases.audience_accounts SET revoked_at=$4 WHERE workspace_id=$1 AND case_id=$2 AND account_id=$3 AND revoked_at IS NULL",[actor.workspaceId,caseId,accountId,context.now]);
   await revokeSessions(tx,actor.workspaceId,accountId,context.now);await revokeTokens(tx,actor.workspaceId,accountId,context.now);
   await tx.query("UPDATE ls_identity.auth_mail_outbox SET state='canceled',payload_ciphertext=NULL,completed_at=$3 WHERE workspace_id=$1 AND account_id=$2 AND state='queued'",[actor.workspaceId,accountId,context.now]);
   await recordAction(tx,context,actor.workspaceId,actor.id,'guardian_revoked');
  });
 }
 async revokeAccount(actor:Actor,accountId:AccountId,requestId:string):Promise<void> {
  const context={requestId,now:this.clock.now()};
  await this.store.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);const current=await freshActor(tx,actor,context.now);requirePractitioner(current);
   const target=await accountById(tx,actor.workspaceId,accountId);
   if(!target || target.role==='practitioner') throw new AppError("NOT_FOUND");
   await tx.query("UPDATE ls_identity.accounts SET state='revoked',updated_at=$3 WHERE workspace_id=$1 AND id=$2",[actor.workspaceId,accountId,context.now]);
   await tx.query("UPDATE ls_cases.case_guardians SET revoked_at=$3 WHERE workspace_id=$1 AND account_id=$2 AND revoked_at IS NULL",[actor.workspaceId,accountId,context.now]);
   await tx.query("UPDATE ls_cases.audience_accounts SET revoked_at=$3 WHERE workspace_id=$1 AND account_id=$2 AND revoked_at IS NULL",[actor.workspaceId,accountId,context.now]);
   await revokeSessions(tx,actor.workspaceId,accountId,context.now);await revokeTokens(tx,actor.workspaceId,accountId,context.now);
   await tx.query("UPDATE ls_identity.auth_mail_outbox SET state='canceled',payload_ciphertext=NULL,completed_at=$3 WHERE workspace_id=$1 AND account_id=$2 AND state='queued'",[actor.workspaceId,accountId,context.now]);
   await recordAction(tx,context,actor.workspaceId,actor.id,'account_revoked');
  });
 }
 /** Operator-only bootstrap: NEVER bind to a route, RPC or browser action. No password/token is returned. */
 async bootstrapPractitioner(input:{email:string;displayName:string;locale:Locale},operatorPermission:boolean,requestId:string):Promise<void> {
  if(operatorPermission!==true) throw new AppError("FORBIDDEN");
  const context={requestId,now:this.clock.now()};
  await this.store.transaction(async tx=>{
   await tx.query("SELECT pg_advisory_xact_lock(6042026)");
   await tx.query("INSERT INTO ls_identity.workspaces (id) VALUES ($1) ON CONFLICT DO NOTHING",[this.config.workspaceId]);
   await lockWorkspace(tx,this.config.workspaceId);
   if(await one(tx,"SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND role='practitioner'",[this.config.workspaceId])) throw new AppError("CONFLICT");
   const account=await createAdultAccount(tx,this.config,context,{...input,role:'practitioner'});
   await issueAuthToken(tx,this.config,account,context,'invite');
   await recordAction(tx,context,this.config.workspaceId,account.id,'workspace_bootstrapped');
  });
 }
}
