import { expect, test } from "vitest";
import { occurrenceRange, shiftOccurrenceDay } from "../../../src/features/home-practice/occurrence-range.ts";

test("occurrence ranges are bounded civil dates, inclusive/exclusive and DST independent", () => {
  expect(occurrenceRange("2026-10-01", "2026-11-12")).toEqual({ from: "2026-10-01", to: "2026-11-12" });
  expect(shiftOccurrenceDay("2026-10-24", 2)).toBe("2026-10-26");
  expect(shiftOccurrenceDay("2028-02-28", 2)).toBe("2028-03-01");
});
test.each([
  ["2026-02-30", "2026-03-01"], ["2026-09-29", "2026-09-29"],
  ["2026-09-30", "2026-09-29"], ["2026-01-01", "2026-02-13"],
  ["2026-09-29T00:00:00Z", "2026-09-30"], ["2026-9-29", "2026-09-30"],
])("reject invalid range %s to %s", (from, to) => {
  expect(() => occurrenceRange(from, to)).toThrow("INVALID_REQUEST");
});
