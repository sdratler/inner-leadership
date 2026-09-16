import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AppError } from "../../../lib/errors.ts";
import { seal } from "../../identity/crypto.ts";
import type { Keyring } from "../../identity/crypto.ts";
import { parsePreEnrollment, digestPreEnrollment, type PreEnrollmentInput } from "./schema.ts";

export type IntakeToken = Readonly<{ tokenDigest: string; stableLeadId: string; expiresAt: Date; usedAt: Date | null }>;
export type IntakeReceipt = Readonly<{ receiptId: string; stableLeadId: string; receivedAt: string; duplicate: boolean }>;
export interface PreEnrollmentRepository {
  transaction<T>(work: (tx: PreEnrollmentRepository) => Promise<T>): Promise<T>;
  findToken(tokenDigest: string): Promise<IntakeToken | null>;
  findReceiptByIdempotency(tokenDigest: string, idempotencyKey: string): Promise<{ receiptId: string; stableLeadId: string; receivedAt: Date; payloadDigest: string } | null>;
  insertReceipt(row: { receiptId: string; stableLeadId: string; tokenDigest: string; payloadCiphertext: string; payloadDigest: string; idempotencyKey: string; receivedAt: Date }): Promise<"inserted" | { kind: "duplicate"; receiptId: string; receivedAt: Date } | "mismatch">;
  consumeToken(tokenDigest: string, at: Date): Promise<boolean>;
}

export function issueToken(stableLeadId: string, now: Date, ttlMs = 7 * 24 * 60 * 60 * 1000): { token: string; tokenDigest: string; stableLeadId: string; expiresAt: Date } {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(stableLeadId)) throw new AppError("INVALID_REQUEST");
  const token = randomBytes(32).toString("base64url");
  return { token, tokenDigest: createHash("sha256").update(token).digest("hex"), stableLeadId, expiresAt: new Date(now.getTime() + ttlMs) };
}

export class PreEnrollmentService {
  constructor(private readonly repository: PreEnrollmentRepository, private readonly keyring: Keyring, private readonly now: () => Date = () => new Date(), private readonly enabled = false) {}

  /** Exchange the fragment-held token in a POST body; callers must not put it in a URL. */
  async exchange(token: string): Promise<{ stableLeadId: string; expiresAt: string }> {
    if (!this.enabled || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError("NOT_FOUND");
    const row = await this.repository.findToken(createHash("sha256").update(token).digest("hex"));
    const at = this.now();
    if (!row || row.usedAt || row.expiresAt.getTime() <= at.getTime()) throw new AppError("NOT_FOUND");
    return { stableLeadId: row.stableLeadId, expiresAt: row.expiresAt.toISOString() };
  }

  async submit(token: string, idempotencyKey: string, raw: unknown): Promise<IntakeReceipt> {
    if (!this.enabled) throw new AppError("NOT_FOUND");
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)) throw new AppError("INVALID_REQUEST");
    const tokenDigest = createHash("sha256").update(token).digest("hex");
    const input = parsePreEnrollment(raw);
    const at = this.now();
    return this.repository.transaction(async (tx) => {
      const issued = await tx.findToken(tokenDigest);
      const payload = JSON.stringify(input);
      const digest = digestPreEnrollment(input);
      const prior = await tx.findReceiptByIdempotency(tokenDigest, idempotencyKey);
      if (prior) {
        if (prior.payloadDigest !== digest) throw new AppError("CONFLICT");
        return { receiptId: prior.receiptId, stableLeadId: prior.stableLeadId, receivedAt: prior.receivedAt.toISOString(), duplicate: true };
      }
      if (!issued || issued.usedAt || issued.expiresAt.getTime() <= at.getTime()) throw new AppError("NOT_FOUND");
      const receiptId = randomUUID();
      const result = await tx.insertReceipt({ receiptId, stableLeadId: issued.stableLeadId, tokenDigest, payloadCiphertext: seal(payload, `pre-enrollment:${issued.stableLeadId}:${receiptId}`, this.keyring), payloadDigest: digest, idempotencyKey, receivedAt: at });
      if (result === "mismatch") throw new AppError("CONFLICT");
      if (typeof result === "object") return { receiptId: result.receiptId, stableLeadId: issued.stableLeadId, receivedAt: result.receivedAt.toISOString(), duplicate: true };
      if (!await tx.consumeToken(tokenDigest, at)) throw new AppError("CONFLICT");
      return { receiptId, stableLeadId: issued.stableLeadId, receivedAt: at.toISOString(), duplicate: false };
    });
  }
}
