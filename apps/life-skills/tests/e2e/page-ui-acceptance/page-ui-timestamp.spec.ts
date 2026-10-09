import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";

const configuredEvidenceDir=process.env.PAGE_UI_EVIDENCE_DIR;
const sourceHead=process.env.PAGE_UI_SOURCE_HEAD;
const sourceTree=process.env.PAGE_UI_SOURCE_TREE;
const supplied=[configuredEvidenceDir,sourceHead,sourceTree].filter(Boolean).length;
if(supplied>0&&supplied<3)throw new Error("PAGE_UI_EVIDENCE_DIR, PAGE_UI_SOURCE_HEAD and PAGE_UI_SOURCE_TREE must be supplied together");
const configured=supplied===3;
test.skip(!configured,"development-only Page timestamp evidence run requires evidence directory and exact source identity");
const evidenceDir:string=configuredEvidenceDir??process.cwd();
if(configuredEvidenceDir)mkdirSync(evidenceDir,{recursive:true});

test("unknown Page activity uses localized Jerusalem time with bidi isolation",async({page})=>{
 const captures=[];
 for(const locale of ["en","he"] as const){
  await page.setViewportSize({width:390,height:844});
  const url=`/${locale}/dev/ui/workspace?role=practitioner&page=app%2Fmarketing&section=content_calendar&scenario=unknown&layout=month&month=2026-10&date=2026-10-08`;
  await page.goto(url);
  const time=page.locator(".lsr-page-publication-state bdi time");
  await expect(time).toHaveAttribute("datetime","2026-10-08T17:05:00.000Z");
  await expect(time).toHaveAttribute("dir","ltr");
  await expect(time).toContainText("GMT");
  const status=await page.locator(".lsr-page-publication-state").innerText();
  expect(status).not.toContain("2026-10-08T17:05:00.000Z");
  const file=`${locale}-unknown-time-390x844.png`;
  await page.locator(".lsr-page-publication-state").screenshot({path:join(evidenceDir,file)});
  captures.push({locale,file,url:page.url(),canonicalInstant:await time.getAttribute("datetime"),display:await time.innerText(),sha256:createHash("sha256").update(readFileSync(join(evidenceDir,file))).digest("hex")});
 }
 writeFileSync(join(evidenceDir,"timestamp-evidence.json"),JSON.stringify({generatedAt:new Date().toISOString(),sourceHead,sourceTree,kind:"development-only composed synthetic timestamp repair",providerAction:false,captures},null,2)+"\n");
});
