import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CalendarAgenda, CalendarBoard } from "../../../src/features/calendar/views.tsx";
import type { InternalTask } from "../../../src/features/calendar/tasks.ts";

const task: InternalTask = {
  id: "00000000-0000-4000-8000-000000000001" as InternalTask["id"],
  caseId: null,
  title: "SYNTHETIC-ID · Respond to inbound WhatsApp inquiry",
  note: null,
  sourcePath: "/he/app/clients?section=prospects&leadId=synthetic",
  sourceKind: "crm_followup",
  dueDate: "2026-09-30",
  dueTime: null,
  state: "open",
  version: 1,
  createdAt: "2026-09-30T06:00:00.000Z",
  updatedAt: "2026-09-30T06:00:00.000Z",
};

describe("Calendar administrative display", () => {
  it("renders generated inquiry tasks in Hebrew in both grid and agenda, without changing English", () => {
    const common = { items: [], tasks: [task], names: {}, onOpen: () => {} };
    const hebrewGrid = renderToStaticMarkup(createElement(CalendarBoard, { ...common, dates: [task.dueDate], locale: "he", view: "week" }));
    const hebrewAgenda = renderToStaticMarkup(createElement(CalendarAgenda, { ...common, locale: "he" }));
    const englishGrid = renderToStaticMarkup(createElement(CalendarBoard, { ...common, dates: [task.dueDate], locale: "en", view: "week" }));
    expect(hebrewGrid).toContain("SYNTHETIC-ID · מענה לפניית WhatsApp נכנסת");
    expect(hebrewAgenda).toContain("SYNTHETIC-ID · מענה לפניית WhatsApp נכנסת");
    expect(englishGrid).toContain(task.title);
    expect(hebrewGrid).not.toContain("Respond to inbound WhatsApp inquiry");
  });

  it("leaves an unlinked practitioner task title untouched", () => {
    const manual = { ...task, sourceKind: null, title: "SYNTHETIC-ID · Respond to inbound WhatsApp inquiry" };
    const html = renderToStaticMarkup(createElement(CalendarBoard, { items: [], tasks: [manual], dates: [task.dueDate], locale: "he", view: "week", names: {}, onOpen: () => {} }));
    expect(html).toContain(manual.title);
  });
});
