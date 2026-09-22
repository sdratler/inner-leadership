import "server-only";
import type { IdentityStore, SqlSession } from "../../identity/store.ts";
import type { IntakeToken, PreEnrollmentRepository } from "./service.ts";

type TokenRow = { tokenDigest:string; stableLeadId:string; childSlots:unknown; expiresAt:Date; usedAt:Date|null };
function slots(value: unknown): readonly string[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 8 || value.some(item => typeof item !== "string" || !/^[0-9a-f-]{36}$/i.test(item))) throw new Error("INTAKE_SLOT_CORRUPT");
  return value;
}
/** SQL gateway for the private intake ledger. No URL, token plaintext or decrypted answer is logged. */
export class SqlPreEnrollmentRepository implements PreEnrollmentRepository {
  constructor(private readonly store: IdentityStore, private readonly workspaceId: string, private readonly session?: SqlSession) {}
  private async query<T extends object>(text:string, values:readonly unknown[]):Promise<T[]>{
    if(this.session)return this.session.query<T>(text,values);
    return this.store.transaction(tx=>tx.query<T>(text,values));
  }
  transaction<T>(work: (tx: PreEnrollmentRepository) => Promise<T>): Promise<T> {
    if(this.session)return work(this);
    return this.store.transaction(tx => work(new SqlPreEnrollmentRepository(this.store, this.workspaceId, tx)));
  }
  async findToken(tokenDigest:string): Promise<IntakeToken|null> {
    {
      const rows=await this.query<TokenRow>(`SELECT token_digest AS "tokenDigest",stable_lead_ref AS "stableLeadId",child_slots AS "childSlots",expires_at AS "expiresAt",consumed_at AS "usedAt" FROM ls_intake.pre_enrollment_invitations WHERE workspace_id=$1 AND token_digest=$2 AND revoked_at IS NULL FOR UPDATE`,[this.workspaceId,tokenDigest]);
      if(rows.length!==1)return null; const row=rows[0]!;return {tokenDigest:row.tokenDigest,stableLeadId:row.stableLeadId,childSlotIds:slots(row.childSlots),expiresAt:new Date(row.expiresAt),usedAt:row.usedAt?new Date(row.usedAt):null};
    }
  }
  async findReceiptByIdempotency(tokenDigest:string,idempotencyKey:string){const rows=await this.query<{receiptId:string;receivedAt:Date;payloadDigest:string}>(`SELECT r.receipt_id AS "receiptId",r.received_at AS "receivedAt",r.payload_digest AS "payloadDigest" FROM ls_intake.pre_enrollment_receipts r JOIN ls_intake.pre_enrollment_invitations i ON i.workspace_id=r.workspace_id AND i.invitation_id=r.invitation_id WHERE r.workspace_id=$1 AND i.token_digest=$2 AND r.idempotency_key=$3`,[this.workspaceId,tokenDigest,idempotencyKey]);return rows[0]??null;}
  async insertReceipt(row:Parameters<PreEnrollmentRepository["insertReceipt"]>[0]){
    {const result=await this.query<{receiptId:string;receivedAt:Date}>(`INSERT INTO ls_intake.pre_enrollment_receipts(workspace_id,receipt_id,invitation_id,idempotency_key,payload_ciphertext,payload_digest,consent_version,consent_hash,received_at) SELECT $1,$2,i.invitation_id,$3,$4,$5,$6,$7,$8 FROM ls_intake.pre_enrollment_invitations i WHERE i.workspace_id=$1 AND i.token_digest=$9 ON CONFLICT(workspace_id,invitation_id,idempotency_key) DO NOTHING RETURNING receipt_id AS "receiptId",received_at AS "receivedAt"`,[this.workspaceId,row.receiptId,row.idempotencyKey,row.payloadCiphertext,row.payloadDigest,row.consentVersion,row.consentHash,row.receivedAt,row.tokenDigest]);return result[0]?"inserted" as const:"mismatch" as const;}
  }
  async consumeToken(tokenDigest:string,at:Date):Promise<boolean>{return (await this.query(`UPDATE ls_intake.pre_enrollment_invitations SET consumed_at=$3 WHERE workspace_id=$1 AND token_digest=$2 AND consumed_at IS NULL AND revoked_at IS NULL RETURNING invitation_id`,[this.workspaceId,tokenDigest,at])).length===1;}
}
