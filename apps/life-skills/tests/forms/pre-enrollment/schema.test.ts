import { describe, expect, it } from "vitest";
import { digestPreEnrollment, parsePreEnrollment, policyTextHash } from "@/features/forms/pre-enrollment/schema.ts";

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
  consentAcknowledged: true as const,
  signerName: "Synthetic Signer",
};

describe("P1 pre-enrollment contract", () => {
  it("round-trips the full field set and hashes policy text", () => {
    const parsed = parsePreEnrollment(valid);
    expect(parsed.children[0]?.childSlotId).toBe("00000000-0000-4000-8000-000000000001");
    expect(digestPreEnrollment(parsed)).toMatch(/^[a-f0-9]{64}$/);
    expect(policyTextHash("synthetic policy")).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([
    ["false acknowledgement", { consentAcknowledged: false }],
    ["blank signer", { signerName: "   " }],
    ["free-text contact preference", { willingToBeContacted: "maybe" }],
    ["missing child slot", { children: [{ firstName: "x", age: 8 }] }],
  ])("rejects %s", (_name, change) => {
    expect(() => parsePreEnrollment({ ...valid, ...change })).toThrow();
  });
});
