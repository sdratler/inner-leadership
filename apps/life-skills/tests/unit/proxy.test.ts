import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { publicStaticAsset } from "../../src/proxy.ts";

describe("public static perimeter", () => {
  it("serves only the shipped app fonts via GET or HEAD", () => {
    for (const name of ["Heebo-wght.ttf", "FrankRuhlLibre-wght.ttf"]) {
      expect(existsSync(new URL(`../../public/fonts/${name}`, import.meta.url))).toBe(true);
      expect(publicStaticAsset(`/fonts/${name}`, "GET")).toBe(true);
      expect(publicStaticAsset(`/fonts/${name}`, "HEAD")).toBe(true);
      expect(publicStaticAsset(`/fonts/${name}`, "POST")).toBe(false);
    }
    for (const path of ["/fonts/other.ttf", "/fonts/private/Heebo-wght.ttf", "/fonts/../api/prospects", "/api/prospects"])
      expect(publicStaticAsset(path, "GET")).toBe(false);
  });
});
