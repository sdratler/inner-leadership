import { z } from "zod";

const nonBlank = (max: number) => z.string().trim().min(1).max(max);
const bankTransferSchema = z.strictObject({
  bankName: nonBlank(160),
  bankCode: z.string().regex(/^\d{1,10}$/),
  branchNumber: z.string().regex(/^\d{1,12}$/),
  accountNumber: z.string().regex(/^\d{1,24}$/),
  accountHolder: nonBlank(160),
});

export type IntakeBankTransfer = Readonly<z.infer<typeof bankTransferSchema>>;

/** Payment account details are an operator-supplied, public display configuration.
 * An incomplete or malformed value intentionally falls back to direct coordination. */
export function runtimeIntakeBankTransfer(raw = process.env.LS_INTAKE_BANK_TRANSFER_JSON): IntakeBankTransfer | null {
  if (!raw) return null;
  try {
    const parsed = bankTransferSchema.safeParse(JSON.parse(raw));
    return parsed.success ? Object.freeze(parsed.data) : null;
  } catch { return null; }
}
