import type { SessionAdapter } from "../../lib/security/session.ts";
import { AppError } from "../../lib/errors.ts";
import type { IdentityStore } from "./store.ts";
import { one } from "./store.ts";
import { accountById } from "./data.ts";
import { TOKEN_PATTERN, tokenDigest, csrfSecret } from "./crypto.ts";
import type { IdentityConfig } from "./config.ts";
import type { Actor, AccountId, IdentityClock } from "./types.ts";
export class IdentitySessions implements SessionAdapter {
 constructor(private readonly store: IdentityStore, private readonly config: IdentityConfig, private readonly clock: IdentityClock) {}
 async actor(token: string): Promise<Actor> {
  if (!TOKEN_PATTERN.test(token)) throw new AppError("UNAUTHENTICATED");
  const digest = tokenDigest(token), now = this.clock.now();
  return this.store.transaction(async tx => {
   const session = await one<{accountId:AccountId; expiresAt:Date}>(tx,`SELECT account_id AS "accountId",expires_at AS "expiresAt"
    FROM ls_identity.sessions WHERE workspace_id=$1 AND token_digest=$2 AND expires_at>GREATEST($3::timestamptz,clock_timestamp()) AND revoked_at IS NULL`,[this.config.workspaceId,digest,now]);
   if (!session) throw new AppError("UNAUTHENTICATED");
   const expiresAt = new Date(session.expiresAt).getTime();
   if (!Number.isFinite(expiresAt) || expiresAt <= this.clock.now().getTime()) throw new AppError("UNAUTHENTICATED");
   const account = await accountById(tx,this.config.workspaceId,session.accountId);
   if (!account || account.state!=="active" || !account.emailVerifiedAt) throw new AppError("UNAUTHENTICATED");
   return Object.freeze({id:account.id,workspaceId:account.workspaceId,personId:account.personId,role:account.role,state:account.state,locale:account.locale,sessionDigest:digest,expiresAt});
  });
 }
 async resolve(token: string) {
  try { const actor = await this.actor(token); return {accountId:actor.id,workspaceId:actor.workspaceId,expiresAt:actor.expiresAt,revoked:false}; }
  catch (error) { if (error instanceof AppError && error.code==="UNAUTHENTICATED") return null; throw new AppError("UNAVAILABLE"); }
 }
 csrf(token:string):string { return csrfSecret(token,this.config.csrfKey,"session"); }
}
