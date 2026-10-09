import { describe, it } from "vitest";
import { coreCases } from "../provider-index/core-cases.ts";
describe("R35 private provider and referral contracts", () => {
  for (const [name, run] of coreCases) it(name, run);
});
