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
