import {readFileSync} from "node:fs";
import {expect,test} from "@playwright/test";

const workspaceCss=readFileSync(new URL("../../../src/ui/workspace/workspace.css",import.meta.url),"utf8");
const calendarCss=readFileSync(new URL("../../../src/features/calendar/calendar.css",import.meta.url),"utf8");

for(const locale of ["en","he"] as const){
 for(const width of [340,390]){
  test(`${locale} ${width}px Calendar views stay legible and keyboard-reachable`,async({page},testInfo)=>{
   await page.setViewportSize({width,height:844});
   const labels=locale==="he"?["יום","שבוע","חודש","רשימה"]:["Day","Week","Month","Agenda"];
   const viewKeys=["day","week","month","agenda"];
   const nav=viewKeys.map((view,index)=>`<a href="/${locale}/app/calendar?view=${view}"${view==="agenda"?' aria-current="page"':''}>${labels[index]}</a>`).join("");
   await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><div class="lsw lsu" dir="${locale==="he"?"rtl":"ltr"}"><main class="ls-cal"><section class="lsw-calendar lsw-calendar--agenda"><header class="lsw-calendar-toolbar"><h2>${locale==="he"?"ספטמבר 2026":"September 2026"}</h2><nav aria-label="Calendar">${nav}</nav><nav><a href="#previous">Previous</a><a href="#today">Today</a><a href="#next">Next</a></nav><span class="lsw-help" dir="ltr">Asia/Jerusalem</span></header></section></main></div>`);
   await page.addStyleTag({content:workspaceCss});
   await page.addStyleTag({content:calendarCss});
   const viewNav=page.locator(".lsw-calendar-toolbar>nav").first(),links=viewNav.locator("a");
   await expect(links).toHaveCount(4);
   await expect(viewNav).toHaveCSS("overflow-x","auto");
   for(const link of await links.all()){
    await expect(link).toHaveCSS("white-space","nowrap");
    const height=await link.evaluate(node=>node.getBoundingClientRect().height);
    expect(height).toBeGreaterThanOrEqual(44);
    expect(height).toBeLessThan(55);
    expect(await link.evaluate(node=>node.getBoundingClientRect().width)).toBeGreaterThanOrEqual(44);
   }
   expect(await viewNav.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
   const agenda=links.last();
   await expect(agenda).toHaveAttribute("aria-current","page");
   await expect(agenda).toHaveCSS("background-color","rgb(36, 81, 89)");
   await expect(agenda).toHaveCSS("color","rgb(255, 255, 255)");
   await links.first().focus();
   for(let index=0;index<3;index++)await page.keyboard.press("Tab");
   await expect(agenda).toBeFocused();
   await page.screenshot({path:testInfo.outputPath(`${locale}-${width}-calendar-toolbar.png`)});
  });
 }
}
