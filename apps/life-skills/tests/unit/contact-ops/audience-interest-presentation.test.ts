import {expect,test} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {AudienceInterestRecord} from "../../../src/features/contact-ops/audience-interest-workspace.tsx";
import type {AudienceRow} from "../../../src/features/contact-ops/core/audience-interest.ts";
const row:AudienceRow={personId:"synthetic",displayName:"Synthetic person",phone:"+972540001001",topic:"bna_content",state:"withdrawn",version:2,observedAt:"2026-10-08T00:00:00.000Z",sourceRef:"Synthetic interest source",observations:[{kind:"provider_label",evidence:"Synthetic observation",observedAt:"2026-10-07T22:00:00.000Z",sourceRef:"Synthetic observation source"}],messagingPermission:"unknown",outboundEligible:false,doNotContact:false,mode:"live"};
for(const locale of ["en","he"] as const){
 test(`${locale} distinguishes native interest provenance, observation history and permission`,()=>{
  const html=renderToStaticMarkup(createElement(AudienceInterestRecord,{row,locale,disabled:false,onChange:()=>{}}));
  expect(html).toContain("Synthetic interest source");expect(html).toContain('dateTime="2026-10-08T00:00:00.000Z"');expect(html).toContain(locale==="en"?"Interest version":"גרסת העניין");
  expect(html).toContain(locale==="en"?"Interest withdrawn":"העניין בוטל");expect(html).toContain('dir="ltr">+972540001001');expect(html).toContain("Synthetic observation source");expect(html).not.toContain("provider_label");expect(html).not.toContain("bna_content");
  expect(html.indexOf("lsu-audience-permission")).toBeLessThan(html.indexOf("<details"));expect(html).toContain(locale==="en"?"Unknown — no outbound use":"לא ידועה — אין שימוש יוצא");expect(html).toContain("lsu-audience-actions");
 });
 test(`${locale} observation-only has no invented interest provenance`,()=>{
  const html=renderToStaticMarkup(createElement(AudienceInterestRecord,{row:{...row,state:null,version:0,sourceRef:null,observedAt:null},locale,disabled:false,onChange:()=>{}}));
  expect(html).toContain(locale==="en"?"No interest recorded":"לא תועד עניין");expect(html).not.toContain(locale==="en"?"All states":"כל המצבים");expect(html).not.toContain("Synthetic interest source");expect(html).not.toContain('dateTime="2026-10-08T00:00:00.000Z"');expect(html).toContain("Synthetic observation source");expect(html).toContain("<dd>0</dd>");
 });
}
