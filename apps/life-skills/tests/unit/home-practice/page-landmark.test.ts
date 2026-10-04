import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, test } from "vitest";
import { Ls040FeaturePage } from "../../../src/features/home-practice/feature-page.tsx";

const variants = (["en", "he"] as const).flatMap(locale =>
  (["parent", "child", "adult_client", "practitioner"] as const).flatMap(role =>
    (["home-practice", "goals", "commitments", "checkins"] as const).map(kind => ({ locale, role, kind }))));

test.each(variants)("$locale $role $kind has one named real main landmark", ({ locale, role, kind }) => {
  const html = renderToStaticMarkup(createElement(Ls040FeaturePage, { locale, role, kind }));
  expect((html.match(/<main\b/g) ?? []).length).toBe(1);
  expect((html.match(/<\/main>/g) ?? []).length).toBe(1);
  expect(html).toContain('aria-labelledby="ls-practice-page-title"');
  expect(html).toContain('<h1 id="ls-practice-page-title">');
  expect(html).toContain('id="current-items"');
  expect(html).not.toContain('role="switch"');
});

test.each(variants.filter(value => value.kind === "checkins"))("$locale $role check-ins have one contextual return route and no nested outer card", ({ locale, role, kind }) => {
  const html = renderToStaticMarkup(createElement(Ls040FeaturePage, { locale, role, kind, caseId: "case-one", audienceId: "audience-one" }));
  expect(html).toContain('lsw-practice-checkins');
  expect(html).toContain('<section class="lsw-stack" aria-labelledby="current-items">');
  expect(html).toContain('class="lsw-practice-visually-hidden"');
  expect(html).toContain('lsw-practice-range');
  expect(html).toContain('id="practice-from"');
  expect(html).toContain('caseId=case-one&amp;audienceId=audience-one');
  expect(html).not.toContain('Back to instructions');
  expect(html).not.toContain('חזרה להנחיות');
  expect(html).not.toContain('lsw-eyebrow');
});
