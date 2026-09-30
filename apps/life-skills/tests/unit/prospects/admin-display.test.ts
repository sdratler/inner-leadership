import { describe, expect, it } from "vitest";
import { administrativeActionLabel, administrativeStageLabel, linkedInquiryTaskTitle } from "../../../src/features/prospects/admin-display.ts";

describe("administrative presentation labels", () => {
  it("localizes only known app-owned stage values without changing the source key", () => {
    expect(administrativeStageLabel("New inquiry", "he")).toBe("פנייה חדשה");
    expect(administrativeStageLabel("Contacted", "he")).toBe("נוצר קשר");
    expect(administrativeStageLabel("Offer made", "he")).toBe("ניתנה הצעה");
    expect(administrativeStageLabel("Prospect", "he")).toBe("מתעניין/ת");
    expect(administrativeStageLabel("New inquiry", "en")).toBe("New inquiry");
    expect(administrativeStageLabel("Custom stage", "he")).toBe("Custom stage");
    expect(administrativeStageLabel("", "he")).toBe("");
  });

  it.each(["constructor", "toString", "__proto__"])(
    "preserves inherited-property-looking stage and action text: %s",
    (value) => {
      expect(administrativeStageLabel(value, "he")).toBe(value);
      expect(administrativeActionLabel(value, "he")).toBe(value);
      expect(administrativeStageLabel(value, "en")).toBe(value);
      expect(administrativeActionLabel(value, "en")).toBe(value);
      expect(linkedInquiryTaskTitle(`SYNTHETIC-ID · ${value}`, "crm_followup", "he"))
        .toBe(`SYNTHETIC-ID · ${value}`);
    },
  );

  it("leaves practitioner-authored next actions verbatim", () => {
    expect(administrativeActionLabel("Respond to inbound WhatsApp inquiry", "he")).toBe("מענה לפניית WhatsApp נכנסת");
    expect(administrativeActionLabel("Review inbound inquiry", "he")).toBe("בדיקת פנייה נכנסת");
    expect(administrativeActionLabel("Call on Tuesday about a new time", "he")).toBe("Call on Tuesday about a new time");
    expect(administrativeActionLabel("", "he")).toBe("");
    expect(administrativeActionLabel("Respond to inbound WhatsApp inquiry", "en")).toBe("Respond to inbound WhatsApp inquiry");
  });

  it("localizes a generated linked inquiry task but never a freeform task", () => {
    const title = "SYNTHETIC-ID · Respond to inbound WhatsApp inquiry";
    expect(linkedInquiryTaskTitle(title, "crm_followup", "he"))
      .toBe("SYNTHETIC-ID · מענה לפניית WhatsApp נכנסת");
    expect(linkedInquiryTaskTitle(title, null, "he")).toBe(title);
    expect(linkedInquiryTaskTitle(title, "crm_followup", "en")).toBe(title);
    expect(linkedInquiryTaskTitle("SYNTHETIC-ID · Discuss school", "crm_followup", "he"))
      .toBe("SYNTHETIC-ID · Discuss school");
  });
});
