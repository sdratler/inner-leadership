import {readFileSync} from "node:fs";
import {expect,test} from "@playwright/test";

const workspaceCss=readFileSync(new URL("../../../src/ui/workspace/workspace.css",import.meta.url),"utf8");
const peopleCss=readFileSync(new URL("../../../src/features/contact-ops/native-people.css",import.meta.url),"utf8");

for(const locale of ["en","he"] as const){
 for(const width of [340,390]){
  test(`${locale} ${width}px People pagination is readable and keyboard-reachable`,async({page},testInfo)=>{
   await page.setViewportSize({width,height:844});
   const previous=locale==="he"?"הקודם":"Previous",next=locale==="he"?"הבא":"Next";
   await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><div class="lsw lsu" dir="${locale==="he"?"rtl":"ltr"}"><main class="lsw-main lsu-clients-directory"><section class="lsu-native-people"><nav class="lsw-actions" aria-label="Pagination"><button class="lsw-button lsw-button--secondary" disabled>${previous}</button><span>1 / 2</span><button class="lsw-button lsw-button--secondary">${next}</button></nav></section></main></div>`);
   await page.addStyleTag({content:workspaceCss});
   await page.addStyleTag({content:peopleCss});
   const nav=page.getByRole("navigation",{name:"Pagination"}),buttons=nav.getByRole("button");
   await expect(buttons).toHaveCount(2);
   await expect(buttons.first()).toBeDisabled();
   for(const button of await buttons.all()){
    await expect(button).toHaveCSS("white-space","nowrap");
    const rect=await button.evaluate(node=>node.getBoundingClientRect());
    expect(rect.width).toBeGreaterThanOrEqual(88);
    expect(rect.height).toBeGreaterThanOrEqual(44);
    expect(rect.height).toBeLessThan(60);
   }
   expect(await nav.evaluate(node=>node.scrollWidth-node.clientWidth)).toBeLessThanOrEqual(1);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth)).toBeLessThanOrEqual(1);
   await buttons.last().focus();
   await expect(buttons.last()).toBeFocused();
   await page.screenshot({path:testInfo.outputPath(`${locale}-${width}-people-pagination.png`)});
  });
 }
}
