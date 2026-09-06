import { AppError } from "../../lib/errors.ts";
import type { RateLimitStore } from "../../lib/security/rate-limit.ts";
import type { IdentityStore } from "./store.ts";
import { one } from "./store.ts";
/** One SQL upsert is the atomic counter across replicas. Keys are already HMAC blinded. */
export class PostgresIdentityRateStore implements RateLimitStore {
 constructor(private readonly store: IdentityStore) {}
 async consume(key: string,windowMs: number): Promise<{count:number;retryAfterMs:number}> {
  if (!/^[a-f0-9]{64}$/.test(key) || !Number.isSafeInteger(windowMs) || windowMs<1000 || windowMs>86400000) throw new AppError("UNAVAILABLE");
  return this.store.transaction(async tx => {
   const row = await one<{count:number;retryAfterMs:number}>(tx,`INSERT INTO ls_identity.rate_counters
    (key_digest,window_start,window_ms,count,expires_at)
    VALUES ($1,statement_timestamp(),$2::integer,1,statement_timestamp()+($2::integer * interval '1 millisecond'))
    ON CONFLICT(key_digest) DO UPDATE SET
    count=CASE WHEN ls_identity.rate_counters.expires_at<=statement_timestamp() THEN 1 ELSE LEAST(ls_identity.rate_counters.count+1,1000000) END,
    window_start=CASE WHEN ls_identity.rate_counters.expires_at<=statement_timestamp() THEN statement_timestamp() ELSE ls_identity.rate_counters.window_start END,
    expires_at=CASE WHEN ls_identity.rate_counters.expires_at<=statement_timestamp() THEN statement_timestamp()+($2::integer * interval '1 millisecond') ELSE ls_identity.rate_counters.expires_at END,
    window_ms=$2::integer
    RETURNING count, GREATEST(1,CEIL(EXTRACT(epoch FROM (expires_at-statement_timestamp()))*1000))::integer AS "retryAfterMs"`,[key,windowMs]);
   if (!row) throw new AppError("UNAVAILABLE"); return row;
  });
 }
}
