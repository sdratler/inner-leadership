import { afterEach, describe, expect, it } from "vitest";
import { publicConsentHash, runtimePublicConsent } from "../../src/features/forms/pre-enrollment/consent.ts";

const config = {
  version: "source-20260916",
  sourceHashes: ["701cce537e8cc14f94b593cc6c321330ee0275207386ff8137f259630ca5e073", "3d9dc543abeee4d168130d3ab63d6a66b9367aab218868f30b05b78bfbc1f73d"],
  displayText: ["Source-controlled display text."],
  acknowledgements: ["Acknowledgement one.", "Acknowledgement two.", "Acknowledgement three."],
};

afterEach(() => { delete process.env.LS_INTAKE_PUBLIC_CONSENT_JSON; });

describe("runtime public consent", () => {
  it("hashes every displayed field and only accepts three acknowledgements", () => {
    const consent = runtimePublicConsent(JSON.stringify(config));
    expect(consent.hash).toBe(publicConsentHash(config));
    expect(consent.hash).not.toBe(publicConsentHash({ ...config, displayText: ["Changed display text."] }));
    expect(() => runtimePublicConsent(JSON.stringify({ ...config, acknowledgements: config.acknowledgements.slice(0, 2) }))).toThrow();
  });
  it("does not fall back to wording when the release configuration is absent", () => {
    expect(() => runtimePublicConsent()).toThrow();
  });
});
