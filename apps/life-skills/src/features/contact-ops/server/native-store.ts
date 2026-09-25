import "server-only";
import { privateDigest } from "./digests.js";
import { requireThat } from "../core/validation.js";
import type {IdentityStore} from "../../identity/store.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import {freshActor} from "../../identity/data.ts";
import {requirePractitioner} from "../../cases/policy.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
export interface CrmProfile {
    personId: string;
    stage: string;
    nextAction: string | null;
    followUpDate: string | null;
    notes: string;
    legacyIds: readonly string[];
}
function aad(w: string, p: string) { return `ls_contact_ops/profile/v1/${w}/${p}`; }
/** Existing identity people remain canonical. This stores only their administrative CRM extension. */
export class NativeCrmStore {
    constructor(private readonly db: IdentityStore, private readonly keyring: Keyring, private readonly integrityKey: string, private readonly clock:IdentityClock=systemClock) { }
    async read(a: Actor, personId: string): Promise<{
        profile: CrmProfile;
        version: number;
    } | null> {
        return this.db.transaction(async (tx) => {
            requirePractitioner(await freshActor(tx,a,this.clock.now()));
            const rows = await tx.query<{
                payload_ciphertext: string;
                version: number;
            }>("SELECT payload_ciphertext,version FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2", [a.workspaceId, personId]);
            requireThat(rows.length <= 1, "PROFILE_CARDINALITY");
            const r = rows[0];
            if (!r) return null;
            const profile=JSON.parse(unseal(r.payload_ciphertext,aad(a.workspaceId,personId),this.keyring)) as CrmProfile;
            requireThat(profile.personId===personId,"PROFILE_ID_MISMATCH");
            return {profile,version:r.version};
        });
    }
    async update(a: Actor, profile: CrmProfile, expectedVersion: number, operationId: string): Promise<{
        version: number;
        replayed: boolean;
    }> {
        requireThat(Boolean(operationId) && Number.isSafeInteger(expectedVersion) && expectedVersion > 0, "BAD_OPERATION");
        requireThat(operationId.length<=128 && Boolean(profile.personId),"BAD_OPERATION");
        const payloadDigest = privateDigest({ profile, expectedVersion, actor: a.id, workspace: a.workspaceId }, this.integrityKey);
        const encrypted = seal(JSON.stringify(profile),aad(a.workspaceId,profile.personId),this.keyring);
        return this.db.transaction(async (tx) => {
            requirePractitioner(await freshActor(tx,a,this.clock.now()));
            // The transaction-scoped lock serializes an idempotency key across concurrent retries.
            await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [a.workspaceId + ":crm:" + operationId]);
            const prior = await tx.query<{
                payload_digest: string;
                result_version: number;
                actor_account_id: string;
                person_id: string;
            }>("SELECT payload_digest,result_version,actor_account_id,person_id FROM ls_contact_ops.command_receipts WHERE workspace_id=$1 AND operation_id=$2", [a.workspaceId, operationId]);
            if (prior[0]) {
                requireThat(prior[0].payload_digest === payloadDigest && prior[0].actor_account_id === a.id && prior[0].person_id === profile.personId, "OPERATION_REUSED_WITH_DIFFERENT_INPUT");
                return { version: prior[0].result_version, replayed: true };
            }
            const updated = await tx.query<{
                version: number;
            }>("UPDATE ls_contact_ops.profiles SET payload_ciphertext=$3,version=version+1,updated_at=clock_timestamp() WHERE workspace_id=$1 AND person_id=$2 AND version=$4 RETURNING version", [a.workspaceId, profile.personId, encrypted, expectedVersion]);
            requireThat(updated.length === 1, "STALE_PROFILE_VERSION");
            const version = updated[0]!.version;
            await tx.query("INSERT INTO ls_contact_ops.command_receipts(workspace_id,operation_id,person_id,actor_account_id,payload_digest,result_version) VALUES($1,$2,$3,$4,$5,$6)", [a.workspaceId, operationId, profile.personId, a.id, payloadDigest, version]);
            return { version, replayed: false };
        });
    }
}
