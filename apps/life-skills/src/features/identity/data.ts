import { AppError } from "../../lib/errors.ts";
import type { SqlSession } from "./store.ts";
import { one } from "./store.ts";
import type { AccountFacts, AccountId, WorkspaceId, Actor } from "./types.ts";
import type {IdentityConfig} from './config.ts';
export interface AccountRow extends AccountFacts {
 emailBlind: string; emailCiphertext: string; emailVerifiedAt: Date | null;
 passwordHash: string | null; phoneCiphertext: string | null; phoneVerifiedAt: Date | null;
}
/** Additional restriction inside the actual identity data transaction. The
 * ordinary session check remains required; this does not grant a role. */
export async function assertSelectedIdentityOwner(tx:SqlSession,config:IdentityConfig,account:AccountRow):Promise<void>{
 if(!config.ownerAccountId)return;
 if(account.workspaceId!==config.workspaceId||account.id!==config.ownerAccountId||account.role!=='practitioner'||account.state!=='active')throw new AppError('FORBIDDEN');
 const rows=await tx.query<{id:string}>("SELECT a.id FROM ls_identity.accounts a WHERE a.workspace_id=$1 AND a.id=$2 AND a.role='practitioner' AND a.state='active' AND NOT EXISTS(SELECT 1 FROM ls_demo.accounts d WHERE d.workspace_id=a.workspace_id AND d.account_id=a.id)",[config.workspaceId,config.ownerAccountId]);
 if(rows.length!==1||rows[0]?.id!==config.ownerAccountId)throw new AppError('FORBIDDEN');
}
export const ACCOUNT_SELECT = `SELECT a.id,a.workspace_id AS "workspaceId",s.person_id AS "personId",
 a.role,a.state,a.locale,a.email_blind AS "emailBlind",a.email_ciphertext AS "emailCiphertext",
 a.email_verified_at AS "emailVerifiedAt",a.password_hash AS "passwordHash",
 a.phone_ciphertext AS "phoneCiphertext",a.phone_verified_at AS "phoneVerifiedAt"
 FROM ls_identity.accounts a JOIN ls_identity.account_subjects s ON s.workspace_id=a.workspace_id AND s.account_id=a.id`;
export async function lockWorkspace(tx: SqlSession, workspaceId: WorkspaceId): Promise<void> {
 if (!await one(tx,"SELECT id FROM ls_identity.workspaces WHERE id=$1 FOR UPDATE",[workspaceId])) throw new AppError("UNAVAILABLE");
}
export function accountById(tx: SqlSession, workspace: WorkspaceId, id: AccountId): Promise<AccountRow | null> {
 return one<AccountRow>(tx,ACCOUNT_SELECT+" WHERE a.workspace_id=$1 AND a.id=$2",[workspace,id]);
}
export function accountByEmail(tx: SqlSession, workspace: WorkspaceId, emailBlind: string,restrictedAccountId?:AccountId): Promise<AccountRow | null> {
 return restrictedAccountId===undefined?one<AccountRow>(tx,ACCOUNT_SELECT+" WHERE a.workspace_id=$1 AND a.email_blind=$2",[workspace,emailBlind]):
  one<AccountRow>(tx,ACCOUNT_SELECT+" WHERE a.workspace_id=$1 AND a.email_blind=$2 AND a.id=$3",[workspace,emailBlind,restrictedAccountId]);
}
/** Recheck a captured server actor inside the same transaction as every mutation/read. */
export async function freshActor(tx: SqlSession, actor: Actor, now: Date): Promise<AccountRow> {
 const session = await one<{id: string}>(tx,`SELECT a.id FROM ls_identity.sessions s JOIN ls_identity.accounts a
 ON a.workspace_id=s.workspace_id AND a.id=s.account_id WHERE s.workspace_id=$1 AND s.account_id=$2
 AND s.token_digest=$3 AND s.revoked_at IS NULL AND s.expires_at>GREATEST($4::timestamptz,clock_timestamp()) AND a.state='active'`,[actor.workspaceId,actor.id,actor.sessionDigest,now]);
 if (!session) throw new AppError("UNAUTHENTICATED");
 const account = await accountById(tx,actor.workspaceId,actor.id);
 if (!account || account.state!=="active") throw new AppError("UNAUTHENTICATED");
 return account;
}
export async function revokeSessions(tx: SqlSession, workspace: WorkspaceId, account: AccountId, now: Date): Promise<void> {
 await tx.query("UPDATE ls_identity.sessions SET revoked_at=$3 WHERE workspace_id=$1 AND account_id=$2 AND revoked_at IS NULL",[workspace,account,now]);
 await tx.query("UPDATE ls_identity.push_subscriptions SET revoked_at=$3,payload_ciphertext=NULL WHERE workspace_id=$1 AND account_id=$2 AND revoked_at IS NULL",[workspace,account,now]);
}
export async function revokeTokens(tx: SqlSession, workspace: WorkspaceId, account: AccountId, now: Date): Promise<void> {
 await tx.query("UPDATE ls_identity.auth_tokens SET revoked_at=$3,target_email_blind=NULL,target_email_ciphertext=NULL WHERE workspace_id=$1 AND account_id=$2 AND used_at IS NULL AND revoked_at IS NULL",[workspace,account,now]);
 await tx.query("UPDATE ls_identity.auth_mail_outbox SET state='canceled',payload_ciphertext=NULL,completed_at=$3 WHERE workspace_id=$1 AND account_id=$2 AND state='queued' AND token_digest IS NOT NULL",[workspace,account,now]);
}
