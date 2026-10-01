import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { PracticeAuthoringForm, PracticeManagementWorkspace } from "../../../src/features/home-practice/management-workspace.tsx";
const draft = { title: "", reference: "", instructions: "Retained unsaved input", startsOn: "2026-10-02", endsOn: "", goalId: "", commitmentId: "", revision: null };
const data = { practice: { items: [], hasMore: false }, goals: [], commitments: [] };
const props = { draft, data, locked: false, busy: false, onChange: () => {}, onSave: () => {}, onCancel: () => {} };
test.each(["en", "he"] as const)("%s authoring requires actual case context and retains ordinary labeled form controls", locale => {
  const missing = renderToStaticMarkup(createElement(PracticeManagementWorkspace, { locale, kind: "home-practice" }));
  expect(missing).toContain(`/${locale}/app/clients`); expect(missing).not.toContain("<form");
  const html = renderToStaticMarkup(createElement(PracticeAuthoringForm, { ...props, locale, kind: "home-practice" }));
  expect(html).toContain("Retained unsaved input"); expect(html).toContain('type="date" required=""');
  expect(html).toContain('maxLength="8000"'); expect(html).toContain('type="submit"'); expect(html).not.toContain("Publish");
  expect(html).toContain(locale === "he" ? "שמירה אינה מפרסמת" : "Saving does not publish");
  const locked = renderToStaticMarkup(createElement(PracticeAuthoringForm, { ...props, locale, kind: "home-practice", locked: true }));
  expect(locked).toContain('disabled=""'); expect(locked).toContain("Retained unsaved input");
});
test.each(["en", "he"] as const)("%s goal/commitment UI tells the truth about shared saving and needs a linked goal", locale => {
  const html = renderToStaticMarkup(createElement(PracticeAuthoringForm, { ...props, locale, kind: "commitments" }));
  expect(html).toContain('type="submit" disabled=""'); expect(html).toContain('select required=""');
  expect(html).toContain(locale === "he" ? "צרו מטרה" : "Create a goal");
  expect(html).toContain(locale === "he" ? "שמירה מאפשרת לקהל המורשה" : "Saving makes this item available");
});
