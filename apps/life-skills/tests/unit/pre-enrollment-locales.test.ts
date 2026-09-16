import { describe, expect, it } from "vitest";
import { historicalDays, newAmendmentDays, staffLocales } from "../../src/features/forms/pre-enrollment/staff-locales.ts";
import { respondentLink } from "../../src/features/forms/pre-enrollment/staff-link.ts";

describe("staff intake locale contract", () => {
  it("keeps Hebrew and English dictionaries structurally aligned and populated", () => {
    const he = staffLocales.he as unknown as Record<string, unknown>;
    const en = staffLocales.en as unknown as Record<string, unknown>;
    expect(Object.keys(he).sort()).toEqual(Object.keys(en).sort());
    for (const locale of [staffLocales.he, staffLocales.en]) {
      for (const value of Object.values(locale)) {
        if (typeof value === "string") expect(value.trim()).not.toBe("");
      }
      for (const value of Object.values(locale.days)) expect(value.trim()).not.toBe("");
      for (const value of Object.values(locale.windows)) expect(value.trim()).not.toBe("");
      for (const value of Object.values(locale.errors)) expect(value.trim()).not.toBe("");
    }
  });
  it("allows Fri/Sat in history but excludes them from new amendments", () => {
    expect(historicalDays).toEqual(["sun", "mon", "tue", "wed", "thu", "fri", "sat"]);
    expect(newAmendmentDays).toEqual(["sun", "mon", "tue", "wed", "thu"]);
  });
  it("uses the configured parent origin and locale, keeping the credential in the fragment", () => {
    const token = "a".repeat(43);
    expect(respondentLink("https://intake.example.test", token, "en")).toBe("https://intake.example.test/en/intake#" + token);
    expect(respondentLink("https://intake.example.test", token)).toBe("https://intake.example.test/he/intake#" + token);
    expect(respondentLink("https://intake.example.test", "invalid", "en")).toBeNull();
  });
});
