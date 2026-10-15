import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {expect,test} from "vitest";
import {CommunityReadingAid,CommunityPostMetadata,communityStatusLabel} from "../../../src/features/community-reply/inbox-presentation.tsx";

test.each(["en","he"] as const)("%s localizes reading-aid chrome without translating or replacing the captured English aid",locale=>{
 const lines=["Synthetic English summary only.","Keep the original source authoritative."],before=structuredClone(lines);
 const html=renderToStaticMarkup(React.createElement(CommunityReadingAid,{locale,lines}));
 expect(html).toContain(`lang="${locale}" dir="${locale==="he"?"rtl":"ltr"}"`);
 expect(html).toContain('<ul lang="en" dir="ltr">');
 for(const line of lines)expect(html).toContain(line);
 expect(html).toContain(locale==="he"?"עזר קריאה באנגלית":"English reading aid");
 expect(html).toContain(locale==="he"?"הקטע המקורי נשאר המקור הקובע":"The original excerpt remains authoritative");
 expect(lines).toEqual(before);
 if(locale==="he")expect(html).not.toContain("Convenience summary");
});
test.each(["en","he"] as const)("%s absent/empty aid stays honest and does not synthesize content",locale=>{
 for(const lines of[undefined,[]]){
  const html=renderToStaticMarkup(React.createElement(CommunityReadingAid,{locale,lines}));
  expect(html).not.toContain("<ul");expect(html).toContain(locale==="he"?"אינה מפעילה ניתוח בתשלום":"does not run a paid analysis");
 }
});
test.each(["new","ready","replied","follow_up","lead","skipped"])("known %s display is localized without changing stored/filter values",status=>{
 expect(communityStatusLabel(status,"en")).not.toBe(communityStatusLabel(status,"he"));
 const post={status,postedAt:"2026-10-15T08:00:00Z",capturedAt:null},before=structuredClone(post);
 const html=renderToStaticMarkup(React.createElement(CommunityPostMetadata,{locale:"he",post}));
 expect(html).toContain(`<bdi>${communityStatusLabel(status,"he")}</bdi>`);expect(html).toContain("<bdi>2026-10-15T08:00:00Z</bdi>");
 expect(html).toContain("תגובות לא נקלטו");expect(post).toEqual(before);
});
test.each(["constructor","__proto__","toString","unknown-state","מצב לא מוכר"])("preserves unknown status %s as text, not an inherited-property lookup",status=>{
 for(const locale of["en","he"] as const)expect(communityStatusLabel(status,locale)).toBe(status);
});
test("source timestamp fallback is preserved, including unknown provider text; HTML remains escaped",()=>{
 for(const [postedAt,capturedAt,value]of[[null,null,"—"],[null,"provider timestamp","provider timestamp"],["<script>","unused","&lt;script&gt;"]] as const){
  const html=renderToStaticMarkup(React.createElement(CommunityPostMetadata,{locale:"en",post:{status:"<unsafe>",postedAt,capturedAt}}));
  expect(html).toContain(`<bdi>${value}</bdi>`);expect(html).toContain("&lt;unsafe&gt;");expect(html).not.toContain("<script>");
 }
});
