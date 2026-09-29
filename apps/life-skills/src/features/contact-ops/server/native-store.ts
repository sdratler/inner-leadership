import "server-only";
import {z} from "zod";
import { privateDigest } from "./digests.ts";
import { requireThat,dateOnly } from "../core/validation.ts";
import type {IdentityStore} from "../../identity/store.ts";
import {seal,unseal,type Keyring} from "../../identity/crypto.ts";
import {freshActor,lockWorkspace} from "../../identity/data.ts";
import {requirePractitioner} from "../../cases/policy.ts";
import {systemClock,type Actor,type IdentityClock} from "../../identity/types.ts";
import {asId} from "../../../lib/ids.ts";
import {demoRecordBatch} from "../../demo/provenance.ts";
import {nativeManualInquirySchema,type NativeManualInquiry} from "../core/people-create.ts";
import {canonical} from "../core/validation.ts";
import {nativeWhatsappInquirySchema,inboundActivitySchema,type NativeWhatsappInquiry,type InboundActivity} from "../core/inbound-projection.ts";
export interface CrmProfile {
    personId: string;
    stage: string;
    nextAction: string | null;
    followUpDate: string | null;
    notes: string;
    legacyIds: readonly string[];
    /** Server-created native inquiry; it does not claim a legacy Sheet origin. */
    nativeInquiry?: NativeManualInquiry;
    /** Provider-origin administrative inquiry; never a manual/Sheet/account claim. */
    whatsappInquiry?: NativeWhatsappInquiry;
    /** Committed incoming activity only, separate from authored notes. */
    inboundActivity?: InboundActivity;
    /** Administrative changes are separate from immutable imported evidence. */
    leadUpdates?: Record<string, {outcome?:string;owner?:string}>;
    /** Sticky communication suppression, never reset by an outcome/status edit. */
    doNotContact?: boolean;
}
export function crmProfileAad(w: string, p: string) { return `ls_contact_ops/profile/v1/${w}/${p}`; }
const legacyId=z.string().regex(/^LS-(?:LEAD|WAPI)-[A-Za-z0-9_-]+$/);
export const crmProfileSchema=z.object({personId:z.string().uuid(),stage:z.string().min(1).max(120),
    nextAction:z.string().max(500).nullable(),followUpDate:z.string().refine(dateOnly).nullable(),
    notes:z.string().max(5000),nativeInquiry:nativeManualInquirySchema.optional(),
    whatsappInquiry:nativeWhatsappInquirySchema.optional(),inboundActivity:inboundActivitySchema.optional(),legacyIds:z.array(legacyId).max(100)
        .refine(ids=>new Set(ids).size===ids.length),
    leadUpdates:z.record(legacyId,z.object({outcome:z.string().max(500).optional(),owner:z.string().max(120).optional()}).strict()).optional(),
    doNotContact:z.boolean().optional()
    }).strict().refine(p=>Object.keys(p.leadUpdates??{}).length<=100&&
        Object.keys(p.leadUpdates??{}).every(id=>p.legacyIds.includes(id)||id===p.nativeInquiry?.leadId||id===p.whatsappInquiry?.leadId)&&
        (!p.nativeInquiry||(p.nativeInquiry.leadId==="LS-LEAD-native-"+p.personId&&!p.legacyIds.includes(p.nativeInquiry.leadId)))&&
        (!p.whatsappInquiry||(p.whatsappInquiry.leadId==="LS-WAPI-native-"+p.personId&&!p.legacyIds.includes(p.whatsappInquiry.leadId)))&&
        (!p.inboundActivity||Boolean(p.whatsappInquiry)));
function validateProfile(profile:unknown):asserts profile is CrmProfile {
    requireThat(crmProfileSchema.safeParse(profile).success,"BAD_PROFILE");
    const p=profile as CrmProfile;
    requireThat(p.personId===asId(p.personId,"person"),"CANONICAL_PERSON_ID_REQUIRED");
}
/** Existing identity people remain canonical. This stores only their administrative CRM extension. */
export class NativeCrmStore {
    constructor(private readonly db: IdentityStore, private readonly keyring: Keyring, private readonly integrityKey: string, private readonly clock:IdentityClock=systemClock) { }
    /** The caller must have created the canonical identity person first. No Sheet write occurs. */
    async create(a:Actor,profile:CrmProfile,operationId:string):Promise<{version:number;replayed:boolean}> {
        validateProfile(profile);
        requireThat(profile.whatsappInquiry===undefined&&profile.inboundActivity===undefined,"PROVIDER_FIELDS_REQUIRE_INBOUND_RECEIPT");
        requireThat(Boolean(operationId)&&operationId.length<=128,"BAD_OPERATION");
        const payloadDigest=privateDigest({action:"create",profile,actor:a.id,workspace:a.workspaceId},this.integrityKey);
        const encrypted=seal(JSON.stringify(profile),crmProfileAad(a.workspaceId,profile.personId),this.keyring);
        return this.db.transaction(async tx=>{
            // Coordinate live profile creation with a pending shadow import's
            // workspace-wide no-unlinked-profiles preflight.
            await lockWorkspace(tx,a.workspaceId);
            requirePractitioner(await freshActor(tx,a,this.clock.now()));
            await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))",[a.workspaceId+":crm:"+operationId]);
            const prior=await tx.query<{payload_digest:string;result_version:number;actor_account_id:string;person_id:string}>(
                "SELECT payload_digest,result_version,actor_account_id,person_id FROM ls_contact_ops.command_receipts WHERE workspace_id=$1 AND operation_id=$2",[a.workspaceId,operationId]);
            if(prior[0]) {
                requireThat(prior[0].payload_digest===payloadDigest&&prior[0].actor_account_id===a.id&&prior[0].person_id===profile.personId,"OPERATION_REUSED_WITH_DIFFERENT_INPUT");
                return {version:prior[0].result_version,replayed:true};
            }
            const demoBatch=await demoRecordBatch(tx,a.workspaceId,"person",profile.personId);
            const inserted=await tx.query<{version:number}>(
                "INSERT INTO ls_contact_ops.profiles(workspace_id,person_id,payload_ciphertext,record_mode,demo_batch_id) VALUES($1,$2,$3,$4,$5) ON CONFLICT (workspace_id,person_id) DO NOTHING RETURNING version",
                [a.workspaceId,profile.personId,encrypted,demoBatch?"demo":"live",demoBatch]);
            requireThat(inserted.length===1,"PROFILE_ALREADY_EXISTS");
            await tx.query("INSERT INTO ls_contact_ops.command_receipts(workspace_id,operation_id,person_id,actor_account_id,payload_digest,result_version) VALUES($1,$2,$3,$4,$5,$6)",
                [a.workspaceId,operationId,profile.personId,a.id,payloadDigest,inserted[0]!.version]);
            return {version:inserted[0]!.version,replayed:false};
        });
    }
    async read(a: Actor, personId: string): Promise<{
        profile: CrmProfile;
        version: number;
    } | null> {
        requireThat(personId===asId(personId,"person"),"CANONICAL_PERSON_ID_REQUIRED");
        return this.db.transaction(async (tx) => {
            requirePractitioner(await freshActor(tx,a,this.clock.now()));
            const rows = await tx.query<{
                payload_ciphertext: string;
                version: number;
            }>("SELECT payload_ciphertext,version FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2", [a.workspaceId, personId]);
            requireThat(rows.length <= 1, "PROFILE_CARDINALITY");
            const r = rows[0];
            if (!r) return null;
            const profile:unknown=JSON.parse(unseal(r.payload_ciphertext,crmProfileAad(a.workspaceId,personId),this.keyring));
            validateProfile(profile);
            requireThat(profile.personId===personId,"PROFILE_ID_MISMATCH");
            requireThat(Number.isSafeInteger(r.version)&&r.version>0,"BAD_PROFILE_VERSION");
            return {profile,version:r.version};
        });
    }
    async update(a: Actor, profile: CrmProfile, expectedVersion: number, operationId: string): Promise<{
        version: number;
        replayed: boolean;
    }> {
        validateProfile(profile);
        requireThat(Boolean(operationId) && Number.isSafeInteger(expectedVersion) && expectedVersion > 0, "BAD_OPERATION");
        requireThat(operationId.length<=128 && Boolean(profile.personId),"BAD_OPERATION");
        const payloadDigest = privateDigest({ action:"update",profile, expectedVersion, actor: a.id, workspace: a.workspaceId }, this.integrityKey);
        const encrypted = seal(JSON.stringify(profile),crmProfileAad(a.workspaceId,profile.personId),this.keyring);
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
            const current=await tx.query<{payload_ciphertext:string}>(
                "SELECT payload_ciphertext FROM ls_contact_ops.profiles WHERE workspace_id=$1 AND person_id=$2 FOR UPDATE",[a.workspaceId,profile.personId]);
            requireThat(current.length===1,"STALE_PROFILE_VERSION");
            const saved=crmProfileSchema.parse(JSON.parse(unseal(current[0]!.payload_ciphertext,crmProfileAad(a.workspaceId,profile.personId),this.keyring)));
            requireThat(canonical(saved.nativeInquiry??null)===canonical(profile.nativeInquiry??null),"INQUIRY_ORIGIN_IMMUTABLE");
            requireThat(canonical(saved.whatsappInquiry??null)===canonical(profile.whatsappInquiry??null),"INQUIRY_ORIGIN_IMMUTABLE");
            requireThat(canonical(saved.inboundActivity??null)===canonical(profile.inboundActivity??null),"INBOUND_ACTIVITY_IMMUTABLE");
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
