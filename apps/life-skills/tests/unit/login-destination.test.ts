import { describe, expect, it } from "vitest";
import { destinationForRole } from "../../src/features/identity/login-client.tsx";

describe("shared private-app sign-in destination", () => {
  it("routes each enabled account type to its own workspace", () => {
    expect(destinationForRole("he", "practitioner")).toBe("/he/app");
    expect(destinationForRole("en", "parent")).toBe("/en/family");
    expect(destinationForRole("he", "adult_client")).toBe("/he/client");
  });
  it("does not introduce independent student access", () => {
    expect(destinationForRole("en", "child")).toBeNull();
  });
});
