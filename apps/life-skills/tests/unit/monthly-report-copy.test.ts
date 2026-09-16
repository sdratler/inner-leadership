import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { calendarCopy } from "../../src/features/calendar/copy";
import messages from "../../src/ui/workspace/messages.json";

describe("monthly report and intake-call copy", () => {
  it("removes the obsolete recurring fifteen-minute promise from visible copy", () => {
    const visible = JSON.stringify({ calendarCopy, messages });
    expect(visible).not.toMatch(/15 minutes|15 דקות|Joint-parent check-in|שיחת הורים משותפת/);
  });

  it("keeps the legacy appointment kind as an optional intake call", () => {
    expect(calendarCopy.en.parent_guidance).toBe("Optional parent intake call");
    expect(calendarCopy.he.parent_guidance).toBe("שיחת קליטה להורים, לפי בחירה");
    expect(messages.en.parentGuidance).toBe("Optional parent intake call");
    expect(messages.he.parentGuidance).toBe("שיחת קליטה להורים, לפי בחירה");
  });

  it("labels the gallery attention example as a monthly progress report", () => {
    const gallery = readFileSync(resolve(process.cwd(), "src/ui/workspace/gallery-frame.tsx"), "utf8");
    expect(gallery).toMatch(/monthly progress report/);
    expect(gallery).toMatch(/דוח התקדמות חודשי/);
    expect(gallery).not.toMatch(/15 minutes|15 דקות/);
  });
});
