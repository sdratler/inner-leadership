import { randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import type { IdentityStore } from "./store.ts";
import { one } from "./store.ts";
import { accountByEmail, accountById, lockWorkspace, freshActor, revokeSessions, revokeTokens } from "./data.ts";
import { opaqueToken, tokenDigest, blindEmail, canonicalEmail, hashPassword, verifyPassword, dummyPasswordHash, csrfSecret, seal, unseal } from "./crypto.ts";
import type { IdentityConfig } from "./config.ts";
import type { AccountId, Actor, IdentityClock, RequestContext } from "./types.ts";
import { issueAuthToken, queueAuthMail } from "./auth-mail.ts";
import type { AuthTokenPurpose } from "./auth-mail.ts";
import { recordAction } from "./history.ts";
interface TokenRow {accountId:AccountId;purpose:AuthTokenPurpose;targetBlind:string|null;targetCiphertext:string|null;}
export class IdentityAuthService {
 constructor(private readonly store:IdentityStore,private readonly config:IdentityConfig,private readonly clock:IdentityClock) {}
 context(requestId:string):RequestContext {return {requestId,now:this.clock.now()};}
 async preauth():Promise<{token:string;csrf:string}> {
  const token=opaqueToken(),expires=new Date(this.clock.now().getTime()+15*60*1000);
  await this.store.transaction(tx=>tx.query("INSERT INTO ls_identity.preauth_sessions (token_digest,workspace_id,expires_at) VALUES ($1,$2,$3)",[tokenDigest(token),this.config.workspaceId,expires]));
  return {token,csrf:csrfSecret(token,this.config.csrfKey,"preauth")};
 }
 async assertPreauth(token:string):Promise<void> {
  const valid=await this.store.transaction(tx=>one(tx,"SELECT token_digest FROM ls_identity.preauth_sessions WHERE workspace_id=$1 AND token_digest=$2 AND expires_at>GREATEST($3::timestamptz,clock_timestamp())",[this.config.workspaceId,tokenDigest(token),this.clock.now()]));
  if (!valid) throw new AppError("FORBIDDEN");
 }
 async login(email:string,password:string,preauthToken:string,requestId:string):Promise<{token:string;expiresAt:string}> {
  const emailBlind=blindEmail(email,this.config.lookupKey);
  const candidate=await this.store.transaction(tx=>accountByEmail(tx,this.config.workspaceId,emailBlind));
  // Unknown, invited and revoked accounts all use an expensive dummy verifier.
  const eligible=candidate?.state==='active' && Boolean(candidate.emailVerifiedAt) && Boolean(candidate.passwordHash);
  const encoded=eligible ? candidate!.passwordHash! : await dummyPasswordHash();
  const matches=await verifyPassword(password,encoded);
  if (!eligible || !matches || !candidate) throw new AppError("UNAUTHENTICATED");
  const context=this.context(requestId),token=opaqueToken(),expires=new Date(context.now.getTime()+this.config.sessionSeconds*1000);
  await this.store.transaction(async tx=>{
   await lockWorkspace(tx,this.config.workspaceId);
   const current=await accountById(tx,this.config.workspaceId,candidate.id);
   if (!current || current.state!=='active' || current.passwordHash!==encoded || current.emailBlind!==emailBlind || !current.emailVerifiedAt) throw new AppError("UNAUTHENTICATED");
   const consumed=await tx.query("DELETE FROM ls_identity.preauth_sessions WHERE workspace_id=$1 AND token_digest=$2 AND expires_at>GREATEST($3::timestamptz,clock_timestamp()) RETURNING token_digest",[this.config.workspaceId,tokenDigest(preauthToken),context.now]);
   if (consumed.length!==1) throw new AppError("FORBIDDEN");
   // Always generate a new server token: neither a supplied token nor preauth becomes a session.
   await tx.query("INSERT INTO ls_identity.sessions (token_digest,workspace_id,account_id,created_at,expires_at) VALUES ($1,$2,$3,$4,$5)",[tokenDigest(token),this.config.workspaceId,current.id,context.now,expires]);
   await recordAction(tx,context,this.config.workspaceId,current.id,"login_succeeded");
  });
  return {token,expiresAt:expires.toISOString()};
 }
 /** Caller applies identical blinded address/network limits before this method. */
 async requestReset(email:string,requestId:string):Promise<void> {
  // Identical insert for known/unknown addresses. Account lookup happens asynchronously
  // in the private auth-mail worker, not on this account-enumeration-sensitive route.
  await this.store.transaction(tx=>tx.query("INSERT INTO ls_identity.reset_requests (id,workspace_id,email_blind,request_id,created_at) VALUES ($1,$2,$3,$4,$5)",[randomUUID(),this.config.workspaceId,blindEmail(email,this.config.lookupKey),requestId,this.clock.now()]));
 }
 async consumePasswordToken(purpose:'invite'|'reset',token:string,password:string,requestId:string):Promise<void> {
  const digest=tokenDigest(token);
  // KDF outside the database lock. HTTP limits protect this expensive path.
  const passwordHash=await hashPassword(password),context=this.context(requestId);
  await this.store.transaction(async tx=>{
   await lockWorkspace(tx,this.config.workspaceId);
   const tokenRow=await one<TokenRow>(tx,`SELECT account_id AS "accountId",purpose,target_email_blind AS "targetBlind",target_email_ciphertext AS "targetCiphertext"
    FROM ls_identity.auth_tokens WHERE workspace_id=$1 AND token_digest=$2 AND purpose=$3
    AND used_at IS NULL AND revoked_at IS NULL AND expires_at>GREATEST($4::timestamptz,clock_timestamp()) FOR UPDATE`,[this.config.workspaceId,digest,purpose,context.now]);
   if (!tokenRow) throw new AppError("INVALID_REQUEST");
   const account=await accountById(tx,this.config.workspaceId,tokenRow.accountId);
   if (!account || account.state!==(purpose==='invite'?'invited':'active')) throw new AppError("INVALID_REQUEST");
   // Every subject behind an account is DB-enforced adult, including a parent of a minor.
   await tx.query("UPDATE ls_identity.auth_tokens SET used_at=$3,target_email_blind=NULL,target_email_ciphertext=NULL WHERE workspace_id=$1 AND token_digest=$2",[this.config.workspaceId,digest,context.now]);
   await tx.query("UPDATE ls_identity.accounts SET password_hash=$3,state='active',email_verified_at=COALESCE(email_verified_at,$4),updated_at=$4 WHERE workspace_id=$1 AND id=$2",[this.config.workspaceId,account.id,passwordHash,context.now]);
   await revokeSessions(tx,this.config.workspaceId,account.id,context.now);
   await revokeTokens(tx,this.config.workspaceId,account.id,context.now);
   await queueAuthMail(tx,this.config,{...account,state:'active'},context,'security_notice',null);
   await recordAction(tx,context,this.config.workspaceId,account.id,purpose==='invite'?'invite_accepted':'password_reset');
  });
  // Deliberately no automatic login after invite/reset; public handler clears any prior session cookie.
 }
 async logout(actor:Actor,requestId:string,all=false):Promise<void> {
  const context=this.context(requestId);
  await this.store.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);await freshActor(tx,actor,context.now);
   if (all) await revokeSessions(tx,actor.workspaceId,actor.id,context.now);
   else await tx.query("UPDATE ls_identity.sessions SET revoked_at=$3 WHERE workspace_id=$1 AND token_digest=$2 AND revoked_at IS NULL",[actor.workspaceId,actor.sessionDigest,context.now]);
   await recordAction(tx,context,actor.workspaceId,actor.id,'session_revoked');
  });
 }
 async verifyCurrentPassword(actor:Actor,password:string):Promise<string> {
  const account=await this.store.transaction(tx=>freshActor(tx,actor,this.clock.now()));
  if (!account.passwordHash || !await verifyPassword(password,account.passwordHash)) throw new AppError("UNAUTHENTICATED");
  return account.passwordHash;
 }
 async requestEmailChange(actor:Actor,email:string,currentPassword:string,requestId:string):Promise<void> {
  const verifiedHash=await this.verifyCurrentPassword(actor,currentPassword),context=this.context(requestId),target=canonicalEmail(email);
  await this.store.transaction(async tx=>{
   await lockWorkspace(tx,actor.workspaceId);const account=await freshActor(tx,actor,context.now);
   if (account.passwordHash!==verifiedHash) throw new AppError("UNAUTHENTICATED");
   const blind=blindEmail(target,this.config.lookupKey),existing=await accountByEmail(tx,actor.workspaceId,blind);
   if (existing) throw new AppError("CONFLICT");
   await issueAuthToken(tx,this.config,account,context,'email_change',{email:target,blind});
   await queueAuthMail(tx,this.config,account,context,'security_notice',null);
   await recordAction(tx,context,actor.workspaceId,actor.id,'contact_change_queued');
  });
 }
 async confirmEmailChange(token:string,requestId:string):Promise<void> {
  const context=this.context(requestId),digest=tokenDigest(token);
  await this.store.transaction(async tx=>{
   await lockWorkspace(tx,this.config.workspaceId);
   const row=await one<TokenRow>(tx,`SELECT account_id AS "accountId",purpose,target_email_blind AS "targetBlind",target_email_ciphertext AS "targetCiphertext"
    FROM ls_identity.auth_tokens WHERE workspace_id=$1 AND token_digest=$2 AND purpose='email_change' AND used_at IS NULL AND revoked_at IS NULL AND expires_at>GREATEST($3::timestamptz,clock_timestamp()) FOR UPDATE`,[this.config.workspaceId,digest,context.now]);
   if (!row?.targetBlind || !row.targetCiphertext) throw new AppError("INVALID_REQUEST");
   const account=await accountById(tx,this.config.workspaceId,row.accountId);
   if (!account || account.state!=='active' || await accountByEmail(tx,this.config.workspaceId,row.targetBlind)) throw new AppError("INVALID_REQUEST");
   const email=unseal(row.targetCiphertext,`email-change:${this.config.workspaceId}:${digest}`,this.config.keyring);
   await queueAuthMail(tx,this.config,account,context,'security_notice',null); // Old verified address receives notice.
   await tx.query("UPDATE ls_identity.accounts SET email_blind=$3,email_ciphertext=$4,email_verified_at=$5,updated_at=$5 WHERE workspace_id=$1 AND id=$2",[this.config.workspaceId,account.id,row.targetBlind,seal(email,`email:${this.config.workspaceId}:${account.id}`,this.config.keyring),context.now]);
   await tx.query("UPDATE ls_identity.auth_tokens SET used_at=$3,target_email_blind=NULL,target_email_ciphertext=NULL WHERE workspace_id=$1 AND token_digest=$2",[this.config.workspaceId,digest,context.now]);
   await revokeSessions(tx,this.config.workspaceId,account.id,context.now);await revokeTokens(tx,this.config.workspaceId,account.id,context.now);
   await recordAction(tx,context,this.config.workspaceId,account.id,'contact_verified');
  });
 }
}
