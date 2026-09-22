import { describe, expect, it } from "vitest";
import { digestPreEnrollment, parseNewPreEnrollment, parsePreEnrollment, policyTextHash } from "@/features/forms/pre-enrollment/schema.ts";
import { publicConsentHash } from "@/features/forms/pre-enrollment/consent.ts";

const valid = {
  parentName: "Synthetic Parent",
  contactNumber: "+972500000000",
  preferredLanguage: "he" as const,
  email: "",
  children: [{ childSlotId: "00000000-0000-4000-8000-000000000001", firstName: "Synthetic Child", age: 8 }],
  locationPreference: "Coordinate location with Shlomo",
  arrivalNeeds: "Directions and parking/access needs to be confirmed",
  availableDays: ["sun"] as const,
  timeWindows: ["afternoon"] as const,
  availabilityNote: "Sunday 16:00-18:00",
  privateContext: "",
  cp01: "discuss_privately" as const,
  willingToBeContacted: "no" as const,
  accessSupportNeeded: "no" as const,
  consentAcknowledgements: [true, true, true] as const,
  signerName: "Synthetic Signer",
  consentLanguage: "he" as const,
  consentVersion: "synthetic-schema-v4",
  consentHash: "a".repeat(64),
};

describe("P1 pre-enrollment contract", () => {
  it("round-trips the full field set and hashes policy text", () => {
    const parsed = parsePreEnrollment(valid);
    expect(parsed.children[0]?.childSlotId).toBe("00000000-0000-4000-8000-000000000001");
    expect(digestPreEnrollment(parsed)).toMatch(/^[a-f0-9]{64}$/);
    expect(policyTextHash("synthetic policy")).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    ["false acknowledgement", { consentAcknowledgements: [true, false, true] }],
    ["blank signer", { signerName: "   " }],
    ["free-text contact preference", { willingToBeContacted: "maybe" }],
    ["missing child slot", { children: [{ firstName: "x", age: 8 }] }],
  ])("rejects %s", (_name, change) => {
    expect(() => parsePreEnrollment({ ...valid, ...change })).toThrow();
  });
  it("keeps historical Friday/Saturday records readable but rejects them for new writes", () => {
    expect(parsePreEnrollment({ ...valid, availableDays: ["fri"] })).toMatchObject({ availableDays: ["fri"] });
    expect(() => parseNewPreEnrollment({ ...valid, availableDays: ["fri"] })).toThrow();
    expect(parseNewPreEnrollment(valid).consentLanguage).toBe("he");
  });
});

describe("bilingual consent hashing", () => {
  const base = { version: "v3", sourceHashes: ["a".repeat(64)], displayText: ["עברית"], acknowledgements: ["א", "ב", "ג"] };
  it("preserves legacy hash and binds translated text when present", () => {
    const legacy = publicConsentHash(base);
    expect(publicConsentHash({ ...base, translations: { en: { displayText: ["English"], acknowledgements: ["A", "B", "C"] } } })).not.toBe(legacy);
    expect(publicConsentHash(base)).toBe(legacy);
  });
});
