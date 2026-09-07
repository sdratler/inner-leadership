import { AppError } from "../../lib/errors.ts";
import type { IdentityStore } from "../../features/identity/store.ts";
import { one } from "../../features/identity/store.ts";
import { accountById,accountByEmail,lockWorkspace } from "../../features/identity/data.ts";
import { issueAuthToken } from "../../features/identity/auth-mail.ts";
import type { AuthMailKind,AuthMailPayload } from "../../features/identity/auth-mail.ts";
import { recordAction } from "../../features/identity/history.ts";
import type { IdentityConfig } from "../../features/identity/config.ts";
import type { AccountId,IdentityClock } from "../../features/identity/types.ts";
import { unseal,TOKEN_PATTERN } from "../../features/identity/crypto.ts";
import type { AuthEmailTransport } from "./transport.ts";
import { AuthEmailDeliveryError } from "./transport.ts";
import { authEmailContent } from "./template.ts";
/** Private worker operations only. No public route or unauthenticated cron endpoint is supplied. */
export async function processResetRequests(store:IdentityStore,config:IdentityConfig,clock:IdentityClock,limit=25):Promise<number> {
 if(!Number.isSafeInteger(limit) || limit<1 || limit>100) throw new AppError("INVALID_REQUEST");
 let processed=0;
 for(let i=0;i<limit;i++){
  const found=await store.transaction(async tx=>{
   await lockWorkspace(tx,config.workspaceId);
   const row=await one<{id:string;emailBlind:string;requestId:string;createdAt:Date}>(tx,`SELECT id,email_blind AS "emailBlind",request_id AS "requestId",created_at AS "createdAt"
    FROM ls_identity.reset_requests WHERE workspace_id=$1 AND processed_at IS NULL ORDER BY created_at,id LIMIT 1 FOR UPDATE`,[config.workspaceId]);
   if(!row) return false;
   const now=clock.now(),account=await accountByEmail(tx,config.workspaceId,row.emailBlind);
   if(now.getTime()-new Date(row.createdAt).getTime()<=15*60*1000 && account?.state==='active' && account.emailVerifiedAt){
    const context={now,requestId:row.requestId};await issueAuthToken(tx,config,account,context,'reset');
    await recordAction(tx,context,config.workspaceId,null,'reset_queued');
   }
   await tx.query("UPDATE ls_identity.reset_requests SET processed_at=$3 WHERE workspace_id=$1 AND id=$2",[config.workspaceId,row.id,now]);
   return true;
  });
  if(!found) break;processed++;
 }
 return processed;
}
interface MailRow {id:string;accountId:AccountId;tokenDigest:string|null;kind:AuthMailKind;ciphertext:string;expiresAt:Date;attempts:number;}
/**
 * Dispatch one item. Database lock serializes account revocation against dispatch eligibility;
 * transport has an eight-second timeout. An already-dispatched email cannot be recalled, but
 * the link's token/account/session is always checked again on use. Same outbox idempotency key
 * survives uncertain provider responses; no retries after the 23-hour payload deadline.
 */
export async function dispatchOneAuthMail(store:IdentityStore,config:IdentityConfig,clock:IdentityClock,transport:AuthEmailTransport,from:string):Promise<'idle'|'sent'|'retry'|'canceled'|'failed'> {
 return store.transaction(async tx=>{
  await lockWorkspace(tx,config.workspaceId);
  const now=clock.now();
  const row=await one<MailRow>(tx,`SELECT id,account_id AS "accountId",token_digest AS "tokenDigest",kind,payload_ciphertext AS ciphertext,expires_at AS "expiresAt",attempts
   FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1 AND state='queued' AND next_attempt_at<=$2 ORDER BY created_at,id LIMIT 1 FOR UPDATE`,[config.workspaceId,now]);
  if(!row) return 'idle';
  const finish=async(state:'canceled'|'failed')=>{await tx.query("UPDATE ls_identity.auth_mail_outbox SET state=$3,payload_ciphertext=NULL,completed_at=$4 WHERE workspace_id=$1 AND id=$2",[config.workspaceId,row.id,state,now]);return state;};
  const account=await accountById(tx,config.workspaceId,row.accountId);
  if(!account || account.state==='revoked' || new Date(row.expiresAt).getTime()<=now.getTime() || row.attempts>=6) return finish('canceled');
  if(row.kind==='invite' ? account.state!=='invited' : account.state!=='active') return finish('canceled');
  if(row.tokenDigest && !await one(tx,"SELECT token_digest FROM ls_identity.auth_tokens WHERE workspace_id=$1 AND account_id=$2 AND token_digest=$3 AND purpose=$4 AND used_at IS NULL AND revoked_at IS NULL AND expires_at>GREATEST($5::timestamptz,clock_timestamp())",[config.workspaceId,account.id,row.tokenDigest,row.kind,now])) return finish('canceled');
  let payload:AuthMailPayload;
  try{
   const parsed:unknown=JSON.parse(unseal(row.ciphertext,`auth-mail:${config.workspaceId}:${row.id}`,config.keyring));
   if(!parsed || typeof parsed!=='object') throw new Error();
   const value=parsed as Record<string,unknown>;
   if(Object.keys(value).sort().join()!=='locale,recipient,token' || typeof value.recipient!=='string' || !['en','he'].includes(String(value.locale)) || !(value.token===null || typeof value.token==='string' && TOKEN_PATTERN.test(value.token))) throw new Error();
   payload=value as unknown as AuthMailPayload;
  }catch{ return finish('failed'); }
  const content=authEmailContent(config.origin,row.kind,payload);
  try{
   const sent=await transport.send({from,to:payload.recipient,...content,idempotencyKey:`ls-auth-${row.id}`});
   await tx.query("UPDATE ls_identity.auth_mail_outbox SET state='sent',payload_ciphertext=NULL,provider_id=$3,completed_at=$4,attempts=attempts+1 WHERE workspace_id=$1 AND id=$2",[config.workspaceId,row.id,sent.providerId,clock.now()]);
   return 'sent';
  }catch(error){
   if(!(error instanceof AuthEmailDeliveryError) || !error.retryable || row.attempts+1>=6) return finish('failed');
   const next=new Date(clock.now().getTime()+Math.min(30,2**row.attempts)*60*1000);
   await tx.query("UPDATE ls_identity.auth_mail_outbox SET attempts=attempts+1,next_attempt_at=$3 WHERE workspace_id=$1 AND id=$2",[config.workspaceId,row.id,next]);return 'retry';
  }
 });
}
/** Only credential/transport ephemera are purged. This is not a clinical data retention policy. */
export async function pruneAuthEphemera(store:IdentityStore,config:IdentityConfig,clock:IdentityClock):Promise<void> {
 const now=clock.now(),dayAgo=new Date(now.getTime()-24*3600*1000);
 await store.transaction(async tx=>{
  await lockWorkspace(tx,config.workspaceId);
  await tx.query("UPDATE ls_identity.auth_mail_outbox SET state='canceled',payload_ciphertext=NULL,completed_at=$2 WHERE workspace_id=$1 AND state='queued' AND expires_at<=$2",[config.workspaceId,now]);
  await tx.query("UPDATE ls_identity.auth_tokens SET revoked_at=COALESCE(revoked_at,$2),target_email_ciphertext=NULL,target_email_blind=NULL WHERE workspace_id=$1 AND expires_at<=$2",[config.workspaceId,now]);
  await tx.query("DELETE FROM ls_identity.preauth_sessions WHERE workspace_id=$1 AND expires_at<$2",[config.workspaceId,now]);
  await tx.query("DELETE FROM ls_identity.sessions WHERE workspace_id=$1 AND expires_at<$2",[config.workspaceId,dayAgo]);
  await tx.query("DELETE FROM ls_identity.reset_requests WHERE workspace_id=$1 AND created_at<$2",[config.workspaceId,dayAgo]);
  await tx.query("DELETE FROM ls_identity.rate_counters WHERE expires_at<$1",[dayAgo]);
 });
}
