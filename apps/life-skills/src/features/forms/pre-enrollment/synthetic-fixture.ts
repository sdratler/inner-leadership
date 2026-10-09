import "server-only";
import {createHash,createHmac,randomUUID} from "node:crypto";
import {z} from "zod";
import {AppError} from "../../../lib/errors.ts";
import {freshActor} from "../../identity/data.ts";
import {requirePractitioner} from "../../cases/policy.ts";
import type {Actor} from "../../identity/types.ts";
import type {IdentityStore,SqlSession} from "../../identity/store.ts";

const configSchema=z.object({batch:z.string().regex(/^ls-owner-\d{8}$/),accountId:z.string().uuid()}).strict();
export type FixtureBinding=z.infer<typeof configSchema>;
/** Disabled by default. This is a server-selected existing demo root, never a browser flag. */
export function intakeFixtureBinding(env:Record<string,string|undefined>):FixtureBinding|null{
 if(env.LS_INTAKE_SYNTHETIC_FIXTURE_ENABLED!=="true")return null;
 try{return configSchema.parse(JSON.parse(env.LS_INTAKE_SYNTHETIC_FIXTURE_BINDING_JSON??""));}catch{throw new AppError("UNAVAILABLE");}
}
const rootPrefix="intake-fixture:v1:";
type Root={batch:string;accountId:string;sourceKey:string};
/** Generic demo markers are valid only when tied to this producer and its immutable invitation. */
export async function intakeFixtureRoot(tx:SqlSession,workspace:string,invitationId:string):Promise<Root|null>{
 const rows=await tx.query<Root&{valid:boolean}>(`SELECT m.batch_id AS batch,m.account_id AS "accountId",m.source_key AS "sourceKey",
  (m.case_id IS NULL AND m.source_key ~ '^intake-fixture:v1:[0-9a-f-]{36}$'
   AND i.created_by_account_id=b.created_by AND i.stable_lead_ref='LS-LEAD-fixture-'||i.invitation_id::text
   AND jsonb_array_length(i.child_slots)=1 AND a.account_id IS NOT NULL) AS valid
  FROM ls_demo.records m JOIN ls_intake.pre_enrollment_invitations i ON i.workspace_id=m.workspace_id AND i.invitation_id::text=m.entity_key
  JOIN ls_demo.batches b ON b.workspace_id=m.workspace_id AND b.batch_id=m.batch_id
  LEFT JOIN ls_demo.accounts a ON a.workspace_id=m.workspace_id AND a.batch_id=m.batch_id AND a.account_id=m.account_id
  WHERE m.workspace_id=$1 AND m.entity_kind='form' AND m.entity_key=$2`,[workspace,invitationId]);
 if(!rows.length)return null;
 if(rows.length!==1||!rows[0]!.valid)throw new AppError("UNAVAILABLE");
 return rows[0]!;
}
/** Atomic operator-style producer. No existing lead/form can be relabeled, and 0100 is untouched. */
export async function issueSyntheticIntake(store:IdentityStore,actor:Actor,operationId:string,binding:FixtureBinding|null,
 derivationKey:Buffer,now:Date):Promise<{token:string;expiresAt:string;synthetic:true;replayed:boolean}>{
 if(!binding)throw new AppError("NOT_FOUND");
 const config=configSchema.parse(binding);if(!z.string().uuid().safeParse(operationId).success||derivationKey.length<32)throw new AppError("INVALID_REQUEST");
 const sourceKey=rootPrefix+operationId;
 const token=createHmac("sha256",derivationKey).update(JSON.stringify(["intake-fixture-token-v1",actor.workspaceId,actor.id,sourceKey])).digest("base64url");
 const digest=createHash("sha256").update(token).digest("hex");
 return store.transaction(async tx=>{
  const current=await freshActor(tx,actor,now);requirePractitioner(current);
  const roots=await tx.query(`SELECT a.account_id FROM ls_demo.batches b JOIN ls_demo.accounts a ON a.workspace_id=b.workspace_id AND a.batch_id=b.batch_id
   JOIN ls_identity.accounts i ON i.workspace_id=a.workspace_id AND i.id=a.account_id
   WHERE b.workspace_id=$1 AND b.batch_id=$2 AND b.created_by=$3 AND a.account_id=$4 AND i.role='parent' AND i.state='active'`,
   [current.workspaceId,config.batch,current.id,config.accountId]);
  if(roots.length!==1)throw new AppError("FORBIDDEN");
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[current.workspaceId+":"+sourceKey]);
  const prior=await tx.query<{id:string;digest:string;expires:Date;account:string;revokedAt:Date|null}>(`SELECT i.invitation_id AS id,i.token_digest AS digest,i.expires_at AS expires,m.account_id AS account,i.revoked_at AS "revokedAt"
   FROM ls_demo.records m JOIN ls_intake.pre_enrollment_invitations i ON i.workspace_id=m.workspace_id AND i.invitation_id::text=m.entity_key
   WHERE m.workspace_id=$1 AND m.batch_id=$2 AND m.entity_kind='form' AND m.source_key=$3`,[current.workspaceId,config.batch,sourceKey]);
  if(prior.length){
   if(prior.length!==1||prior[0]!.digest!==digest||prior[0]!.account!==config.accountId)throw new AppError("CONFLICT");
   await intakeFixtureRoot(tx,current.workspaceId,prior[0]!.id);
   if(prior[0]!.revokedAt)throw new AppError("NOT_FOUND");
   return {token,expiresAt:prior[0]!.expires.toISOString(),synthetic:true,replayed:true};
  }
  const id=randomUUID(),expires=new Date(now.getTime()+86400000),lead="LS-LEAD-fixture-"+id;
  await tx.query(`INSERT INTO ls_intake.pre_enrollment_invitations(workspace_id,invitation_id,token_digest,stable_lead_ref,child_slots,expires_at,created_at,created_by_account_id)
   VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8)`,[current.workspaceId,id,digest,lead,JSON.stringify([randomUUID()]),expires,now,current.id]);
  await tx.query(`INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,account_id)
   VALUES($1,$2,'form',$3,$4,$5)`,[current.workspaceId,config.batch,id,sourceKey,config.accountId]);
  return {token,expiresAt:expires.toISOString(),synthetic:true,replayed:false};
 });
}
/** Monotonic containment for one producer operation. It deliberately does not
 * depend on the issuance switch so an already issued fixture can be contained
 * after issuance is disabled. Tokens, leads and arbitrary invitation IDs are
 * never accepted as selectors. */
export async function revokeSyntheticIntake(store:IdentityStore,actor:Actor,operationId:string,now:Date):Promise<{synthetic:true;revokedAt:string;replayed:boolean}>{
 if(!z.string().uuid().safeParse(operationId).success)throw new AppError("INVALID_REQUEST");
 const sourceKey=rootPrefix+operationId;
 return store.transaction(async tx=>{
  const current=await freshActor(tx,actor,now);requirePractitioner(current);
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[current.workspaceId+":"+sourceKey]);
  const rows=await tx.query<{id:string;batch:string;accountId:string;creator:string;invitationCreator:string;role:string;state:string;revokedAt:Date|null}>(`SELECT
   i.invitation_id AS id,m.batch_id AS batch,m.account_id AS "accountId",b.created_by AS creator,
   i.created_by_account_id AS "invitationCreator",a.role,a.state,i.revoked_at AS "revokedAt"
   FROM ls_demo.records m
   JOIN ls_intake.pre_enrollment_invitations i ON i.workspace_id=m.workspace_id AND i.invitation_id::text=m.entity_key
   JOIN ls_demo.batches b ON b.workspace_id=m.workspace_id AND b.batch_id=m.batch_id
   JOIN ls_demo.accounts da ON da.workspace_id=m.workspace_id AND da.batch_id=m.batch_id AND da.account_id=m.account_id
   JOIN ls_identity.accounts a ON a.workspace_id=da.workspace_id AND a.id=da.account_id
   WHERE m.workspace_id=$1 AND m.entity_kind='form' AND m.source_key=$2
   FOR UPDATE OF i`,[current.workspaceId,sourceKey]);
  if(!rows.length)throw new AppError("NOT_FOUND");
  if(rows.length!==1)throw new AppError("UNAVAILABLE");
  const row=rows[0]!,root=await intakeFixtureRoot(tx,current.workspaceId,row.id);
  if(!root||root.sourceKey!==sourceKey||root.batch!==row.batch||root.accountId!==row.accountId||row.creator!==current.id||
   row.invitationCreator!==current.id||row.role!=="parent"||row.state!=="active")throw new AppError("FORBIDDEN");
  const result=await tx.query<{revokedAt:Date}>(`UPDATE ls_intake.pre_enrollment_invitations SET revoked_at=COALESCE(revoked_at,$3)
   WHERE workspace_id=$1 AND invitation_id=$2 RETURNING revoked_at AS "revokedAt"`,[current.workspaceId,row.id,now]);
  if(result.length!==1)throw new AppError("UNAVAILABLE");
  return {synthetic:true,revokedAt:result[0]!.revokedAt.toISOString(),replayed:row.revokedAt!==null};
 });
}
/** Runs inside the receipt transaction. A fixture submission cannot commit unmarked. */
export async function markIntakeFixtureReceipt(tx:SqlSession,workspace:string,invitationId:string,receiptId:string):Promise<void>{
 const root=await intakeFixtureRoot(tx,workspace,invitationId);if(!root)return;
 await tx.query(`INSERT INTO ls_demo.records(workspace_id,batch_id,entity_kind,entity_key,source_key,account_id)
  VALUES($1,$2,'submission',$3,$4,$5)`,[workspace,root.batch,receiptId,"intake-receipt:v1:"+invitationId,root.accountId]);
}
/** Verify the committed receipt AND matching journey before suppressing the external projection. */
export async function isSyntheticIntakeReceipt(tx:SqlSession,workspace:string,receiptId:string,lead:string):Promise<boolean>{
 const rows=await tx.query<{invitationId:string;lead:string;journey:string|null}>(`SELECT r.invitation_id AS "invitationId",i.stable_lead_ref AS lead,j.intake_receipt_id::text AS journey
  FROM ls_intake.pre_enrollment_receipts r JOIN ls_intake.pre_enrollment_invitations i ON i.workspace_id=r.workspace_id AND i.invitation_id=r.invitation_id
  LEFT JOIN ls_onboarding.prospect_journeys j ON j.workspace_id=i.workspace_id AND j.stable_lead_ref=i.stable_lead_ref
  WHERE r.workspace_id=$1 AND r.receipt_id=$2`,[workspace,receiptId]);
 if(rows.length!==1||rows[0]!.lead!==lead)throw new AppError("UNAVAILABLE");
 const row=rows[0]!,root=await intakeFixtureRoot(tx,workspace,row.invitationId);
 const marks=await tx.query<{batch:string;accountId:string;sourceKey:string;caseId:string|null}>(`SELECT batch_id AS batch,account_id AS "accountId",source_key AS "sourceKey",case_id AS "caseId"
  FROM ls_demo.records WHERE workspace_id=$1 AND entity_kind='submission' AND entity_key=$2`,[workspace,receiptId]);
 if(!root){if(marks.length)throw new AppError("UNAVAILABLE");return false;}
 if(row.journey!==receiptId||marks.length!==1||marks[0]!.batch!==root.batch||marks[0]!.accountId!==root.accountId||marks[0]!.caseId!==null||
  marks[0]!.sourceKey!=="intake-receipt:v1:"+row.invitationId)throw new AppError("UNAVAILABLE");
 return true;
}
