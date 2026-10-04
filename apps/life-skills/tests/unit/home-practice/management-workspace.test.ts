import { createElement } from "react";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: vi.fn(), push: vi.fn() }) }));
import { PracticeAuthoringForm, PracticeManagementWorkspace, practiceDraftIsDirty } from "../../../src/features/home-practice/management-workspace.tsx";
import {blankResponsibility} from "../../../src/features/home-practice/responsibility-editor.tsx";
const draft = { title: "", reference: "", instructions: "Retained unsaved input", startsOn: "2026-10-02", endsOn: "", goalId: "", commitmentId: "", revision: null };
const data = { practice: { items: [], hasMore: false }, goals: [], commitments: [] };
const props = { draft, data, locked: false, busy: false, onChange: () => {}, onSave: () => {}, onCancel: () => {} };
test("responsibility-only drafts require the same discard/navigation protection as legacy input", () => {
 const empty={...draft,instructions:"",startsOn:""};
 expect(practiceDraftIsDirty(empty)).toBe(false);
 expect(practiceDraftIsDirty({...empty,responsibility:blankResponsibility()})).toBe(true);
 expect(practiceDraftIsDirty({...empty,responsibility:{...blankResponsibility(),localTime:"19:15",weekdays:[1,3]}})).toBe(true);
 expect(practiceDraftIsDirty({...empty,responsibility:undefined})).toBe(false);
 for(const field of ["title","reference","instructions","startsOn","endsOn","goalId","commitmentId"] as const)expect(practiceDraftIsDirty({...empty,[field]:"retained"})).toBe(true);
});
test.each(["en","he"] as const)("%s timed practice marks end date required while preserving oversized unsaved input",locale=>{
 const retained="Synthetic long input ".repeat(110),html=renderToStaticMarkup(createElement(PracticeAuthoringForm,{...props,locale,kind:"home-practice",draft:{...draft,instructions:retained,responsibility:blankResponsibility()}}));
 expect(html).toContain(retained);expect(html).toContain('maxLength="2000"');expect(html).toContain(locale==="he"?"מסתיים בתאריך (חובה)":"Ends on (required)");expect(html).not.toContain(locale==="he"?"מסתיים בתאריך (רשות)":"Ends on (optional)");
 expect(html.match(/type="date"[^>]*required=""/g)).toHaveLength(2);
});
test("practice management has a scoped readable single-column list and mobile date fields", () => {
  const html = renderToStaticMarkup(createElement(PracticeManagementWorkspace, { locale: "en", kind: "home-practice", caseId: "123e4567-e89b-12d3-a456-426614174000" }));
  expect(html).toContain('lsw-practice-management');
  const css = readFileSync(new URL('../../../src/ui/workspace/professional-ui.css', import.meta.url), 'utf8');
  expect(css).toContain('.lsw.lsu .lsw-practice-management .lsw-card-list{grid-template-columns:minmax(0,1fr);list-style:none;padding:0;');
  expect(css).toContain('@media(max-width:600px){.lsw.lsu .lsw-practice-management .lsw-two-fields{grid-template-columns:minmax(0,1fr)}}');
});
test.each(["en", "he"] as const)("%s authoring requires actual case context and retains ordinary labeled form controls", locale => {
  const missing = renderToStaticMarkup(createElement(PracticeManagementWorkspace, { locale, kind: "home-practice" }));
  expect(missing).toContain(`/${locale}/app/clients`); expect(missing).not.toContain("<form");
  const html = renderToStaticMarkup(createElement(PracticeAuthoringForm, { ...props, locale, kind: "home-practice" }));
  expect(html).toContain("Retained unsaved input"); expect(html).toContain('type="date" required=""');
  for(const label of locale==='he'?['הנחיות','מטרה','מחויבות']:['Instructions','Goal','Commitment'])expect(html).toContain(`aria-label="${label}"`);
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
