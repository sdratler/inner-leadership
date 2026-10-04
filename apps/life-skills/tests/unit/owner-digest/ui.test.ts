import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,it} from "vitest";
import {OwnerDigestSummary} from "../../../src/ui/revamp/owner-digest-summary.tsx";
import {actionText,buildOwnerDigest} from "../../../src/features/owner-digest/model.ts";
it.each(["en","he"] as const)("keeps %s overview compact and honest about unknowns and delivery",locale=>{
 const d=buildOwnerDigest({now:new Date("2026-10-02T06:00:00Z"),marketing:{source:"registry_only",fetchedAt:null,creatives:[],publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:"unbound"}},followups:null,tasks:null,journeysAvailable:false,locale});
  const html=renderToStaticMarkup(React.createElement(OwnerDigestSummary,{digest:d,locale}));expect(html).toContain('<details>');expect(html).toContain('href="/api/owner-digest"');expect(html).toContain(locale==="en"?"Unknown":"לא ידוע");expect(html).not.toContain(locale==="en"?"No dated follow-ups":"אין מעקב עם תאריך");expect(html).not.toContain("Delete Demo");
  expect(d.actions).toEqual(['crm_unavailable','tasks_unavailable','journeys_unavailable','content_unavailable','meta_unavailable']);for(const code of d.actions)expect(html).toContain(actionText[locale][code]);
});
