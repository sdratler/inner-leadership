import {createElement} from "react";
import {readFileSync} from "node:fs";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,test} from "vitest";
import {CreativePreview} from "../../../src/ui/revamp/creative-preview.tsx";
import type {CreativeVersion} from "../../../src/features/marketing-overview/contracts.ts";
const asset:CreativeVersion={assetId:"DEMO-image",revision:1,locale:"he",width:1080,height:1920,imageUrl:"https://drive.google.com/file/d/synthetic_file/view",title:"Synthetic review image",caption:"",contentDigest:"a".repeat(64),review:"in_review",approvedDigest:null,libraryState:"CURRENT_REVIEW"};
test.each(["he","en"] as const)("%s an unregistered revision explains the missing binding without a broken image or retry",locale=>{
 const html=renderToStaticMarkup(createElement(CreativePreview,{asset:{...asset,registeredRevision:false},locale}));
 expect(html).toContain(locale==='en'?'The exact media revision is not registered':'גרסת המדיה המדויקת אינה רשומה');expect(html).not.toContain('<img');expect(html).not.toContain('<dialog');expect(html).not.toContain('download=1');
});
test.each(["he","en"] as const)("%s full preview retains native dialog/keyboard controls and an exact private original link",locale=>{
 const html=renderToStaticMarkup(createElement(CreativePreview,{asset,locale}));expect(html).toContain("<dialog");expect(html).toContain('aria-haspopup="dialog"');expect(html).toContain('/api/marketing/assets/DEMO-image?revision=1');expect(html).toContain('download=1');expect(html).not.toContain("drive.google.com");expect(html).toContain(locale==="he"?"הצגת התמונה המלאה":"View full image");expect(html).toContain("CURRENT_REVIEW");expect(html).not.toContain("Approve");
 const css=readFileSync(new URL("../../../src/ui/revamp/styles.css",import.meta.url),"utf8");expect(css).toContain(".lsr-creative-preview img{display:block;width:100%;height:auto;max-height:70vh;object-fit:contain}");
});
