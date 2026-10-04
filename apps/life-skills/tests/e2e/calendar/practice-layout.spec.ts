import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { asId } from "../../../src/lib/ids.ts";
import { breadcrumbItems, workspaceHref } from "../../../src/ui/workspace/navigation-model.ts";
import type { PracticeOccurrenceItem } from "../../../src/features/home-practice/types.ts";

const css = ["../../../src/ui/workspace/workspace.css", "../../../src/ui/workspace/professional-ui.css", "../../../src/features/calendar/calendar.css"].map(path => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
const practiceCss = readFileSync(new URL("../../../src/features/home-practice/practice.css", import.meta.url), "utf8");
const id = "00000000-0000-4000-8000-000000000001";
const item: PracticeOccurrenceItem = {
  occurrence: { id: asId(id,"occurrence"), assignmentId: asId(id,"practice_assignment"), practiceVersionId: asId(id,"practice_version"), coordinationVersionId: asId(id,"coordination_version"), occursOn: "2026-10-05", period: "morning", state: "open", occursAt: "2026-10-05T04:35:00Z" },
  practice: { workspaceId: asId(id,"workspace"), caseId: asId(id,"case"), assignmentId: asId(id,"practice_assignment"), versionId: asId(id,"practice_version"), version: 1, audienceId: asId(id,"audience"), goalId: null, commitmentId: null, templateKey: "DEMO", templateVersion: "v1", instructions: "Private details belong in the dialog", startsOn: "2026-10-05", endsOn: null, publishedAt: "2026-10-01T12:00:00Z", immutableSnapshotDigest: "a".repeat(64) },
  canReport: true, ownReport: null, schedule: { participant: "client", caseKind: "minor", localTime: "07:35", timezone: "Asia/Jerusalem", timeOrigin: "practitioner" }
};

// Focused retained-component layout check, not an authenticated journey claim.
for (const locale of ["en", "he"] as const) {
  // Playwright's JSX transform produces mount descriptors, not React elements.
  // Render the retained TSX with the application's normal tsx loader instead.
  const entry = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {PracticeCalendarEntry} from './src/features/home-practice/calendar-entry.tsx';process.stdout.write(renderToStaticMarkup(createElement(PracticeCalendarEntry,{item:${JSON.stringify(item)},locale:${JSON.stringify(locale)},onOpen:()=>{}})));`
  ], {encoding:"utf8",windowsHide:true,timeout:10000});
  const breadcrumb = execFileSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import {createElement} from 'react';import {renderToStaticMarkup} from 'react-dom/server';import {Breadcrumb} from './src/ui/workspace/surfaces.tsx';process.stdout.write(renderToStaticMarkup(createElement(Breadcrumb,{label:'Location',items:[{label:${JSON.stringify(locale === "he" ? "תרגול" : "Practice")},href:'/${locale}/family/practice?caseId=case-one&audienceId=audience-one'},{label:'Check-ins'}]})));`
  ], {encoding:"utf8",windowsHide:true,timeout:10000});
  for (const width of [390, 768, 1440]) {
    test(`${locale} ${width}px practice entry preserves legible time and keyboard access`, async ({page}, testInfo) => {
      await page.setViewportSize({width,height:width===768?1024:900});
      await page.setContent(`<div class="lsw lsu" lang="${locale}" dir="${locale === "he" ? "rtl" : "ltr"}"><main class="ls-cal"><p>Asia/Jerusalem</p><div class="ls-cal-board ls-cal-board--week"><div class="ls-cal-day">${entry}</div></div><div class="ls-cal-practice-agenda">${entry}</div></main></div>`);
      await page.addStyleTag({content:css});
      const grid = page.locator(".ls-cal-board"), button = grid.getByRole("button");
      // Reproduce a narrow week column without making mobile use the desktop grid.
      await grid.evaluate(node => {node.style.minInlineSize="0";node.style.gridTemplateColumns="145px";});
      await expect(button).toHaveAccessibleName(new RegExp(`07:35.*Asia/Jerusalem.*${locale === "he" ? "פתיחת התרגול" : "Open practice"}`));
      expect(await button.evaluate(node => node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
      expect(await button.evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(170);
      // Wider system-font metrics exposed the Linux failure even though Segoe UI
      // passed on Windows. Retain the same compactness and no-clipping bounds.
      await button.evaluate(node => { node.style.fontFamily = "Verdana, sans-serif"; });
      expect(await button.evaluate(node => node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
      expect(await button.evaluate(node => node.getBoundingClientRect().height)).toBeLessThan(170);
      await button.evaluate(node => { node.style.removeProperty("font-family"); });
      await button.focus(); await expect(button).toBeFocused();
      await expect(button).toHaveCSS("outline-style", "solid");
      const agenda = page.locator(".ls-cal-practice-agenda");
      expect(await agenda.locator(".ls-cal-practice-zone").evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(50);
      await expect(agenda.locator(".ls-cal-practice-open")).toBeVisible();
      await expect(page.locator("main")).not.toContainText(item.practice.instructions);
      await page.screenshot({path:testInfo.outputPath(`practice-entry-${locale}-${width}.png`)});
      // Real shared CSS formerly hid this breadcrumb, leaving no contextual
      // return route once the redundant large back button was removed.
      await page.setContent(`<div class="lsw lsu" dir="${locale === "he" ? "rtl" : "ltr"}"><div class="lsu-content"><nav class="lsu-breadcrumbs">Generic shell breadcrumb</nav><div class="lsu-page"><main class="lsw-practice-checkins">${breadcrumb}</main></div></div></div>`);
      await page.addStyleTag({content:css+practiceCss});
      const contextual = page.locator(".lsw-practice-checkins nav");
      await expect(contextual).toBeVisible();
      await expect(page.locator(".lsu-breadcrumbs")).toBeHidden();
      const back = contextual.getByRole("link");
      await expect(back).toHaveAttribute("href", `/${locale}/family/practice?caseId=case-one&audienceId=audience-one`);
      await back.focus(); await expect(back).toBeFocused();
      expect(await back.evaluate(node=>node.getBoundingClientRect().height)).toBeGreaterThanOrEqual(44);
      const crumbs = breadcrumbItems(locale,"practitioner",`/${locale}/app/practice`,"checkins",null,false,id);
      const ownerCrumbs = crumbs.map(crumb=>crumb.path?`<a href="${workspaceHref(locale,crumb.path,id)}">${crumb.label}</a>`:`<span>${crumb.label}</span>`).join(" / ");
      await page.setContent(`<div class="lsw lsu lsu--practitioner" dir="${locale === "he" ? "rtl" : "ltr"}"><div class="lsu-content"><nav class="lsu-breadcrumbs">${ownerCrumbs}</nav><div class="lsu-page"><main class="lsw-practice-checkins">${breadcrumb}</main></div></div></div>`);
      await page.addStyleTag({content:css+practiceCss});
      await expect(page.locator(".lsw-practice-checkins nav")).toBeHidden();
      await expect(page.locator(".lsu-breadcrumbs")).toBeVisible();
      const selectedCase = page.locator(".lsu-breadcrumbs").getByRole("link", {name:locale === "he" ? "התיק הנבחר" : "Selected case",exact:true});
      await expect(selectedCase).toHaveAttribute("href",`/${locale}/app/cases/${id}?caseId=${id}`);
      await selectedCase.focus();await expect(selectedCase).toBeFocused();
    });
  }
}
