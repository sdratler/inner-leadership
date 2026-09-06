import { randomUUID } from "node:crypto";
import { AppError } from "../../lib/errors.ts";
import type { SqlSession } from "./store.ts";
import type { AccountRow } from "./data.ts";
import type { IdentityConfig } from "./config.ts";
import type { RequestContext } from "./types.ts";
import { opaqueToken, tokenDigest, seal, unseal } from "./crypto.ts";
export type AuthTokenPurpose = "invite" | "reset" | "email_change";
export type AuthMailKind = AuthTokenPurpose | "security_notice" | "case_notice";
export interface AuthMailPayload { recipient: string; locale: "he" | "en"; token: string | null; }
export async function queueAuthMail(tx: SqlSession, config: IdentityConfig, account: AccountRow, context: RequestContext,
 kind: AuthMailKind, token: string | null, recipientOverride?: string): Promise<void> {
 const id=randomUUID(), now=context.now;
 const recipient=recipientOverride ?? unseal(account.emailCiphertext,`email:${account.workspaceId}:${account.id}`,config.keyring);
 const payload:AuthMailPayload={recipient,locale:account.locale,token};
 await tx.query(`INSERT INTO ls_identity.auth_mail_outbox
  (id,workspace_id,account_id,token_digest,kind,payload_ciphertext,created_at,expires_at,next_attempt_at,state)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$7,'queued')`,[id,config.workspaceId,account.id,token ? tokenDigest(token):null,kind,
  seal(JSON.stringify(payload),`auth-mail:${config.workspaceId}:${id}`,config.keyring),now,
  new Date(now.getTime()+(kind==='reset'?15*60:23*60*60)*1000)]);
}
/** The token is returned only to the internal encrypted outbox, never in an HTTP response. */
export async function issueAuthToken(tx:SqlSession,config:IdentityConfig,account:AccountRow,context:RequestContext,
 purpose:AuthTokenPurpose,target?:{email:string;blind:string}):Promise<void> {
 if ((purpose==='email_change') !== Boolean(target)) throw new AppError("INTERNAL");
 await tx.query("UPDATE ls_identity.auth_tokens SET revoked_at=$4,target_email_blind=NULL,target_email_ciphertext=NULL WHERE workspace_id=$1 AND account_id=$2 AND purpose=$3 AND used_at IS NULL AND revoked_at IS NULL",[config.workspaceId,account.id,purpose,context.now]);
 await tx.query("UPDATE ls_identity.auth_mail_outbox SET state='canceled',payload_ciphertext=NULL,completed_at=$4 WHERE workspace_id=$1 AND account_id=$2 AND kind=$3 AND state='queued'",[config.workspaceId,account.id,purpose,context.now]);
 const token=opaqueToken(), digest=tokenDigest(token), expires=new Date(context.now.getTime()+(purpose==='reset'?15*60:24*60*60)*1000);
 await tx.query(`INSERT INTO ls_identity.auth_tokens
  (token_digest,workspace_id,account_id,purpose,target_email_blind,target_email_ciphertext,created_at,expires_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,[digest,config.workspaceId,account.id,purpose,target?.blind ?? null,
  target ? seal(target.email,`email-change:${config.workspaceId}:${digest}`,config.keyring):null,context.now,expires]);
 await queueAuthMail(tx,config,account,context,purpose,token,target?.email);
}
