import { createHash, randomBytes, randomUUID } from "node:crypto";
import { AppError } from "../../../lib/errors.ts";
import { seal } from "../../identity/crypto.ts";
import type { Keyring } from "../../identity/crypto.ts";
import { parsePreEnrollment, digestPreEnrollment } from "./schema.ts";
import { runtimePublicConsent, type PublicConsent } from "./consent.ts";

export type IntakeToken = Readonly<{ tokenDigest: string; stableLeadId: string; childSlotIds: readonly string[]; expiresAt: Date; usedAt: Date | null }>;
export type IntakeReceipt = Readonly<{ receiptId: string; receivedAt: string; duplicate: boolean }>;
export interface PreEnrollmentRepository {
  transaction<T>(work: (tx: PreEnrollmentRepository) => Promise<T>): Promise<T>;
  findToken(tokenDigest: string): Promise<IntakeToken | null>;
  findReceiptByIdempotency(tokenDigest: string, idempotencyKey: string): Promise<{ receiptId: string; receivedAt: Date; payloadDigest: string } | null>;
  insertReceipt(row: { receiptId: string; tokenDigest: string; payloadCiphertext: string; payloadDigest: string; idempotencyKey: string; receivedAt: Date; consentVersion: string; consentHash: string }): Promise<"inserted" | { kind: "duplicate"; receiptId: string; receivedAt: Date } | "mismatch">;
  consumeToken(tokenDigest: string, at: Date): Promise<boolean>;
}

export function issueToken(stableLeadId: string, now: Date, ttlMs = 7 * 24 * 60 * 60 * 1000): { token: string; tokenDigest: string; stableLeadId: string; expiresAt: Date } {
  if (!/^[A-Za-z0-9_-]{8,128}$/.test(stableLeadId)) throw new AppError("INVALID_REQUEST");
  const token = randomBytes(32).toString("base64url");
  return { token, tokenDigest: createHash("sha256").update(token).digest("hex"), stableLeadId, expiresAt: new Date(now.getTime() + ttlMs) };
}

export class PreEnrollmentService {
  constructor(private readonly repository: PreEnrollmentRepository, private readonly keyring: Keyring, private readonly now: () => Date = () => new Date(), private readonly enabled = false, private readonly workspaceId: string) {
    if (!/^[0-9a-f-]{36}$/i.test(workspaceId)) throw new AppError("INVALID_REQUEST");
  }

  /** Exchange the fragment-held token in a POST body; callers must not put it in a URL. */
  async exchange(token: string): Promise<{ childSlotIds: readonly string[]; expiresAt: string; consent: PublicConsent }> {
    if (!this.enabled || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new AppError("NOT_FOUND");
    const row = await this.repository.findToken(createHash("sha256").update(token).digest("hex"));
    const at = this.now();
    if (!row || row.usedAt || row.expiresAt.getTime() <= at.getTime()) throw new AppError("NOT_FOUND");
    return { childSlotIds: row.childSlotIds, expiresAt: row.expiresAt.toISOString(), consent: runtimePublicConsent() };
  }

  async submit(token: string, idempotencyKey: string, raw: unknown): Promise<IntakeReceipt> {
    if (!this.enabled) throw new AppError("NOT_FOUND");
    if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !/^[0-9a-f-]{36}$/i.test(idempotencyKey)) throw new AppError("INVALID_REQUEST");
    const tokenDigest = createHash("sha256").update(token).digest("hex");
    const input = parsePreEnrollment(raw);
    const consent = runtimePublicConsent();
    if (input.consentVersion !== consent.version || input.consentHash !== consent.hash || input.consentAcknowledgements.length !== 3) throw new AppError("INVALID_REQUEST");
    const at = this.now();
    return this.repository.transaction(async (tx) => {
      const issued = await tx.findToken(tokenDigest);
      const digest = digestPreEnrollment(input);
      const prior = await tx.findReceiptByIdempotency(tokenDigest, idempotencyKey);
      if (prior) {
        if (prior.payloadDigest !== digest) throw new AppError("CONFLICT");
        return { receiptId: prior.receiptId, receivedAt: prior.receivedAt.toISOString(), duplicate: true };
      }
      if (!issued || issued.usedAt || issued.expiresAt.getTime() <= at.getTime()) throw new AppError("NOT_FOUND");
      if (input.children.length !== issued.childSlotIds.length || new Set(input.children.map(child=>child.childSlotId)).size !== issued.childSlotIds.length || input.children.some(child => !issued.childSlotIds.includes(child.childSlotId))) throw new AppError("NOT_FOUND");
      const receiptId = randomUUID();
      const accepted = { input, consent: { version: consent.version, hash: consent.hash, sourceHashes: consent.sourceHashes, displayText: consent.displayText, acknowledgements: consent.acknowledgements } };
      const result = await tx.insertReceipt({ receiptId, tokenDigest, payloadCiphertext: seal(JSON.stringify(accepted), `pre-enrollment:${this.workspaceId}:${issued.stableLeadId}:${receiptId}:original`, this.keyring), payloadDigest: digest, idempotencyKey, receivedAt: at, consentVersion: consent.version, consentHash: consent.hash });
      if (result === "mismatch") throw new AppError("CONFLICT");
      if (typeof result === "object") return { receiptId: result.receiptId, stableLeadId: issued.stableLeadId, receivedAt: result.receivedAt.toISOString(), duplicate: true };
      if (!await tx.consumeToken(tokenDigest, at)) throw new AppError("CONFLICT");
      return { receiptId, receivedAt: at.toISOString(), duplicate: false };
    });
  }
}
