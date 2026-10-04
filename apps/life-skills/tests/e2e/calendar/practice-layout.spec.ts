import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { asId } from "../../../src/lib/ids.ts";
import type { PracticeOccurrenceItem } from "../../../src/features/home-practice/types.ts";

const css = ["../../../src/ui/workspace/workspace.css", "../../../src/ui/workspace/professional-ui.css", "../../../src/features/calendar/calendar.css"].map(path => readFileSync(new URL(path, import.meta.url), "utf8")).join("\n");
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
      await button.focus(); await expect(button).toBeFocused();
      await expect(button).toHaveCSS("outline-style", "solid");
      const agenda = page.locator(".ls-cal-practice-agenda");
      expect(await agenda.locator(".ls-cal-practice-zone").evaluate(node => node.getBoundingClientRect().width)).toBeGreaterThan(50);
      await expect(agenda.locator(".ls-cal-practice-open")).toBeVisible();
      await expect(page.locator("main")).not.toContainText(item.practice.instructions);
      await page.screenshot({path:testInfo.outputPath(`practice-entry-${locale}-${width}.png`)});
    });
  }
}
