import { describe, expect, it } from "vitest";
import { digestPreEnrollment, parsePreEnrollment, policyTextHash } from "@/features/forms/pre-enrollment/schema.ts";

const valid = {
  parentName: "Synthetic Parent",
  contactNumber: "+972500000000",
  preferredLanguage: "he" as const,
  email: "",
  children: [{ stableChildId: "synthetic-child-01", firstName: "Synthetic Child", age: 8 }],
  locationPreference: "Coordinate location with Shlomo",
  arrivalAvailability: "Directions and parking/access needs to be confirmed",
  availability: "Sunday 16:00-18:00",
  privateContext: "",
  cp01: "discuss_privately" as const,
  willingToBeContacted: "no" as const,
  accessSupportNeeded: "no" as const,
  consentPolicyVersion: "P1-OWNER-SOURCE-PENDING",
  consentPolicyHash: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  consentAcknowledged: true as const,
  signerName: "Synthetic Signer",
};

describe("P1 pre-enrollment contract", () => {
  it("round-trips the full field set and hashes policy text", () => {
    const parsed = parsePreEnrollment(valid);
    expect(parsed.children[0]?.stableChildId).toBe("synthetic-child-01");
    expect(digestPreEnrollment(parsed)).toMatch(/^[a-f0-9]{64}$/);
    expect(policyTextHash("synthetic policy")).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    ["false acknowledgement", { consentAcknowledged: false }],
    ["blank signer", { signerName: "   " }],
    ["free-text contact preference", { willingToBeContacted: "maybe" }],
    ["missing child id", { children: [{ firstName: "x", age: 8 }] }],
  ])("rejects %s", (_name, change) => {
    expect(() => parsePreEnrollment({ ...valid, ...change })).toThrow();
  });
});
