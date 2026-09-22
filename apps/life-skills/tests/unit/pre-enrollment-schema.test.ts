import { describe, expect, it } from "vitest";
import { parsePreEnrollment } from "../../src/features/forms/pre-enrollment/schema.ts";

const input = (age: number) => ({
  parentName: "Synthetic Parent", contactNumber: "+972500000000", preferredLanguage: "he",
  email: "", children: [{ childSlotId: "00000000-0000-4000-8000-000000000001", firstName: "Synthetic Child", age }],
  locationPreference: "coordinate", arrivalNeeds: "", availableDays: ["sun"], timeWindows: ["afternoon"], availabilityNote: "", privateContext: "",
  cp01: "not_now", willingToBeContacted: "yes", accessSupportNeeded: "no", consentAcknowledgements: [true, true, true],
  consentVersion: "SYNTHETIC-TEST", consentHash: "a".repeat(64), signerName: "Synthetic Signer",
});

describe("pre-enrollment age contract", () => {
  it("accepts only finite whole or half-year ages from zero through 25", () => {
    expect(parsePreEnrollment(input(9.5)).children[0]?.age).toBe(9.5);
    for (const age of [-0.5, 9.25, 25.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => parsePreEnrollment(input(age))).toThrow();
    }
  });
});
