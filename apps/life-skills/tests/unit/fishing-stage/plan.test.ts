import {it,expect,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {FishingStagePlan} from "../../../src/features/fishing-stage/plan.tsx";
import {FishingStageService} from "../../../src/features/fishing-stage/service.ts";
import {Fixture,actor,id,ref} from "./fixture.ts";
import {WeeklyProgressView} from "../../../src/features/fishing-stage/weekly-progress-view.tsx";
import type {WeeklyPublication} from "../../../src/features/fishing-stage/weekly-progress.ts";
it("retains every authorized weekly session when publications use different languages",()=>{
 const base:WeeklyPublication={id:id(800),version:3,enrollmentId:id(30),learnerId:id(3),occurrenceId:id(801),moduleId:"RM-104",moduleVersion:"synthetic-v1",locale:"en",groupWork:"English first-session update",nextStep:"Bring equipment",gearReminder:"Water",questionInvitation:"Ask the instructor",skills:[{skillId:"basic_knots",level:"practicing",observedAt:"2026-03-08T16:00:00Z"}],publishedAt:"2026-03-08T18:00:00Z"};
 const updates=[base,{...base,id:id(802),occurrenceId:id(803),locale:"he" as const,groupWork:"עדכון למפגש השני"}];
 for(const locale of["en","he"]as const){const html=renderToStaticMarkup(createElement(WeeklyProgressView,{updates,locale}));expect(html).toContain(base.groupWork);expect(html).toContain(updates[1]!.groupWork);expect(html.match(/<article /g)).toHaveLength(2);expect(html).toContain('lang="en" dir="ltr"');expect(html).toContain('lang="he" dir="rtl"');}
});
it("renders all twelve undated rows in existing UI primitives, with RTL and no fabricated event date",async()=>{
 const f=new Fixture(),app=new FishingStageService(f,{now:()=>f.now});await app.execute(actor(),ref,{action:"create",operationId:id(100),expectedRevision:0,templateVersion:f.template.version,childCapacity:4});await app.execute(actor(),ref,{action:"publish",operationId:id(101),expectedRevision:1});
 const view=(await app.read(actor("parent"),ref))!;const en=renderToStaticMarkup(createElement(FishingStagePlan,{view,locale:"en",onNotice:()=>{}})),he=renderToStaticMarkup(createElement(FishingStagePlan,{view,locale:"he"}));
 expect(en.match(/Date not yet set/g)).toHaveLength(12);expect(en).not.toContain("Next session:");
 const renderedTimes=[...en.matchAll(/<time datetime="([^"]+)"/gi)].map(match=>match[1]);
 expect(renderedTimes).toHaveLength(12);expect(new Set(renderedTimes)).toEqual(new Set([f.now.toISOString()]));
 expect(en).not.toContain("<form");expect(he).toContain('dir="rtl"');expect(he).toContain("טרם נקבע מועד");expect(en).not.toMatch(/checkout|Stripe|paid|clinical|diagnos|teacherKey/i);
});
it("rejects external/javascript lesson links and child mutation controls",async()=>{
 const f=new Fixture(),app=new FishingStageService(f,{now:()=>f.now});await app.execute(actor(),ref,{action:"create",operationId:id(100),expectedRevision:0,templateVersion:f.template.version,childCapacity:4});await app.execute(actor(),ref,{action:"publish",operationId:id(101),expectedRevision:1});const view=(await app.read(actor("child"),ref))!;
 for(const href of ["javascript:alert(1)","//example.invalid/","/\\example.invalid/"]){const html=renderToStaticMarkup(createElement(FishingStagePlan,{view,lessonHref:()=>href,onEdit:()=>{},onNotice:()=>{},onRequestMakeup:()=>{}}));expect(html).not.toContain("href=");expect(html).not.toContain("<form");expect(html).not.toContain("<button");}
});
it("shows the pending makeup request without a duplicate notice or reservation claim",async()=>{
 const f=new Fixture(),app=new FishingStageService(f,{now:()=>f.now});
 await app.execute(actor(),ref,{action:"create",operationId:id(100),expectedRevision:0,templateVersion:f.template.version,childCapacity:4});
 const occurrence=f.state!.occurrences[0]!;
 await app.execute(actor(),ref,{action:"revise",operationId:id(101),expectedRevision:1,occurrenceId:occurrence.id,expectedOccurrenceRevision:1,reason:"Synthetic date",details:{time:{kind:"scheduled",timeZone:"America/New_York",startsAt:"2026-03-08T15:00:00Z",endsAt:"2026-03-08T16:00:00Z"},location:"Synthetic site",directions:"",equipment:"",logisticalNote:"",childCapacity:4}});
 await app.execute(actor(),ref,{action:"publish",operationId:id(102),expectedRevision:2});
 await app.execute(actor("parent"),ref,{action:"notice",operationId:id(103),expectedRevision:3,occurrenceId:occurrence.id,expectedOccurrenceRevision:3,reason:"ordinary_absence"});
 const html=renderToStaticMarkup(createElement(FishingStagePlan,{view:(await app.read(actor("parent"),ref))!,onNotice:()=>{},onRequestMakeup:()=>{}}));
 expect(html).toContain("Request a makeup opportunity");expect(html).not.toContain("<form");expect(html).not.toContain("A replacement place has been confirmed");
 await app.execute(actor("parent"),ref,{action:"request_makeup",operationId:id(104),expectedRevision:4,noticeId:f.state!.makeups[0]!.notice.id});
 const pending=renderToStaticMarkup(createElement(FishingStagePlan,{view:(await app.read(actor("parent"),ref))!,onRequestMakeup:()=>{}}));
 expect(pending).toContain("awaiting confirmation");expect(pending).not.toContain("Request a makeup opportunity");expect(f.reservations.size).toBe(0);
});
it("does not promise a new schedule when every occurrence has been cancelled",async()=>{
 const f=new Fixture(),app=new FishingStageService(f,{now:()=>f.now});await app.execute(actor(),ref,{action:"create",operationId:id(100),expectedRevision:0,templateVersion:f.template.version,childCapacity:4});
 for(let index=0;index<12;index++){
  const occurrence=f.state!.occurrences[index]!;
  await app.execute(actor(),ref,{action:"cancel",operationId:id(200+index),expectedRevision:f.state!.revision,occurrenceId:occurrence.id,expectedOccurrenceRevision:occurrence.revision,reason:"Synthetic cancellation"});
 }
 const html=renderToStaticMarkup(createElement(FishingStagePlan,{view:(await app.read(actor("parent"),ref))!}));
 expect(html).toContain("No upcoming session is scheduled");expect(html).not.toContain("Dates will appear");
 expect(html.match(/service remains undelivered/g)).toHaveLength(12);
});
