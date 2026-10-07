import {readFileSync} from "node:fs";
import {dirname} from "node:path";
import {createRequire} from "node:module";
import {fileURLToPath,pathToFileURL} from "node:url";
import {createElement,type ComponentType} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,test} from "@playwright/test";
import type {AcquisitionReviewItem} from "../../../src/features/contact-ops/core/acquisition.ts";

const tokensCss=readFileSync(new URL("../../../src/ui/tokens.css",import.meta.url),"utf8");
const heebo=readFileSync(new URL("../../../public/fonts/Heebo-wght.ttf",import.meta.url)).toString("base64");
const frank=readFileSync(new URL("../../../public/fonts/FrankRuhlLibre-wght.ttf",import.meta.url)).toString("base64");
const globalsCss=readFileSync(new URL("../../../src/app/globals.css",import.meta.url),"utf8").replace(/^@import[^;]+;\s*/,"")
 .replace('url("/fonts/Heebo-wght.ttf")',`url("data:font/ttf;base64,${heebo}")`)
 .replace('url("/fonts/FrankRuhlLibre-wght.ttf")',`url("data:font/ttf;base64,${frank}")`);
const workspaceCss=readFileSync(new URL("../../../src/ui/workspace/workspace.css",import.meta.url),"utf8").replace(/^@import[^;]+;\s*/,"");
const w4Css=readFileSync(new URL("../../../src/ui/workspace/w4-v2.css",import.meta.url),"utf8");
const professionalCss=readFileSync(new URL("../../../src/ui/workspace/professional-ui.css",import.meta.url),"utf8");
const peopleCss=readFileSync(new URL("../../../src/features/contact-ops/native-people.css",import.meta.url),"utf8");
const item:AcquisitionReviewItem={
 id:"00000000-0000-4000-8000-000000000181",source:"android_nomad",phone:"+972528528899",displayName:"Synthetic Nomad review",
 occurredAt:"2026-10-08T06:15:00.000Z",state:"NEEDS_REVIEW",callState:"incoming",durationSeconds:0,
 matching:{state:"existing",people:[{personId:"00000000-0000-4000-8000-000000000182",displayName:"Synthetic existing person",version:4,eligible:true}]},
};
type ViteServer={ssrLoadModule:(path:string)=>Promise<Record<string,unknown>>;close:()=>Promise<void>};
let vite:ViteServer,ReviewCard:ComponentType<Record<string,unknown>>;
test.beforeAll(async()=>{
 const require=createRequire(import.meta.url),vitestPackage=require.resolve("vitest/package.json"),viteEntry=require.resolve("vite",{paths:[dirname(vitestPackage)]});
 const {createServer}=await import(pathToFileURL(viteEntry).href) as {createServer:(options:Record<string,unknown>)=>Promise<ViteServer>};
 vite=await createServer({root:fileURLToPath(new URL("../../..",import.meta.url)),appType:"custom",server:{middlewareMode:true}});
 ReviewCard=(await vite.ssrLoadModule("/src/features/contact-ops/acquisition-workspace.tsx")).AcquisitionReviewCard as ComponentType<Record<string,unknown>>;
});
test.afterAll(async()=>{await vite.close();});

for(const locale of ["en","he"] as const){
 for(const width of [390,1440]){
  test(`${locale} ${width}px owner review keeps an unqualified Nomad notification in review`,async({page},testInfo)=>{
   await page.setViewportSize({width,height:width===390?844:900});
   const card=renderToStaticMarkup(createElement(ReviewCard,{item,epoch:9,locale,remember:()=>{},saved:()=>{},denied:()=>{},refresh:()=>{}}));
   await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><div class="lsw lsu lsu--practitioner" lang="${locale}" dir="${locale==="he"?"rtl":"ltr"}"><main class="lsw-main lsu-clients-directory"><section class="lsu-native-people"><p>${locale==="he"?"לבדיקה — לא מתעניינים פעילים":"Needs review — not active prospects"}</p>${card}</section></main></div>`);
   await page.addStyleTag({content:tokensCss});
   await page.addStyleTag({content:globalsCss});
   await page.addStyleTag({content:workspaceCss});
   await page.addStyleTag({content:w4Css});
   await page.addStyleTag({content:professionalCss});
   await page.addStyleTag({content:peopleCss});
   await page.evaluate(()=>document.fonts.ready);
   if(locale==="he"){
    await expect(page.locator(".lsw")).toHaveCSS("font-family",/Heebo/);
    await expect(page.getByRole("heading",{name:"Synthetic Nomad review"})).toHaveCSS("font-family",/Frank Ruhl Libre/);
   }

   await expect(page.getByText(locale==="he"?"לבדיקה — לא מתעניינים פעילים":"Needs review — not active prospects",{exact:true})).toBeVisible();
   await expect(page.getByText(locale==="he"?/הודעה על שיחה נכנסת · Nomad · זמן קליטה מדווח/:/Incoming call notification · Nomad · Captured\/reported time/)).toBeVisible();
   await expect(page.getByText(locale==="he"?/עלולה להיות של מתקשר קודם/:/may be a previous caller/)).toBeVisible();
   const phone=page.locator("bdi",{hasText:"+972528528899"});
   await expect(phone).toBeVisible();
   expect(await phone.evaluate(node=>node.tagName)).toBe("BDI");

   const details=page.locator("details"),summary=details.locator("summary");
   await expect(details).not.toHaveAttribute("open","");
   await expect(page.getByRole("button",{name:locale==="he"?"שיוך לאיש קשר קיים":"Match existing person"})).not.toBeVisible();
   await summary.focus();await expect(summary).toBeFocused();await summary.press("Enter");
   await expect(details).toHaveAttribute("open","");
   await expect(page.getByRole("button",{name:locale==="he"?"שיוך לאיש קשר קיים":"Match existing person"})).toBeDisabled();
   await expect(page.locator('a[href^="https://wa.me"]')).toHaveCount(0);

   expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
   for(const element of await page.locator("main *:visible").all()){
    const box=await element.boundingBox();if(!box)continue;
    expect(box.x).toBeGreaterThanOrEqual(-1);expect(box.x+box.width).toBeLessThanOrEqual(width+1);
   }
   await page.screenshot({path:testInfo.outputPath(`${locale}-${width}-nomad-needs-review.png`),fullPage:true});
  });
 }
}
