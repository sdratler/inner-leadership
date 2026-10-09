import {expect,test,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
vi.mock("server-only",()=>({}));
import {AcquisitionWorkspace,AcquisitionReviewCard,AcquisitionWindowSummary,AcquisitionSignIn} from "../../../src/features/contact-ops/acquisition-workspace.tsx";
import {acquisitionDecisionSchema,acquisitionPageSchema,acquisitionDecisionResultSchema,type AcquisitionReviewItem} from "../../../src/features/contact-ops/core/acquisition.ts";
import {practitionerContext,breadcrumbItems} from "../../../src/ui/workspace/navigation-model.ts";
import {practitionerReturnPath,loginReturnDestination} from "../../../src/features/identity/login-return.ts";
const item:AcquisitionReviewItem={id:"00000000-0000-4000-8000-000000000001",source:"organic_whatsapp",phone:"+15550001001",displayName:"Synthetic אדם",
 occurredAt:"2026-10-02T10:00:00.000Z",state:"NEEDS_REVIEW",matching:{state:"unmatched",people:[]}};
test.each(["en","he"] as const)("%s call review shows genuine source, ringing caveat and collapsed owner actions",locale=>{
 const html=renderToStaticMarkup(createElement(AcquisitionReviewCard,{item:{...item,source:"android_nomad",callState:"incoming",durationSeconds:0},locale,epoch:3,remember:()=>{},saved:()=>{},denied:()=>{},refresh:()=>{}}));
 expect(html).toContain(locale==="en"?"Incoming call notification · Nomad":"הודעה על שיחה נכנסת · Nomad");expect(html).not.toContain("Organic WhatsApp");
 expect(html).toContain(locale==="en"?"Captured/reported time":"זמן קליטה מדווח");
 expect(html).toContain(locale==="en"?"may be a previous caller":"עלולה להיות של מתקשר קודם");
 expect(html).toContain(locale==="en"?"Confirm independently before matching or promoting":"יש לאמת בנפרד לפני שיוך או קידום");
 expect(html).toContain(locale==="en"?"no audio, verified call start":"ללא שמע, זמן תחילת שיחה מאומת");
 expect(html).toContain("<details>");expect(html).not.toContain("<details open");expect(html).not.toContain("href=\"https://wa.me");
});
test.each(["en","he"] as const)("%s expired acquisition sign-in retains its validated page",locale=>{
 const html=renderToStaticMarkup(createElement(AcquisitionSignIn,{locale,page:"2",search:""}));
 const href=html.match(/href="([^"]+)"/)![1]!.replaceAll("&amp;","&");
 const target=new URL(href,"https://synthetic.invalid").searchParams.get("next")!;
 expect(target).toBe(`/${locale}/app/clients?section=needs_review&page=2`);
 expect(loginReturnDestination(locale,"practitioner",target)).toBe(target);
 for(const page of ["0","-2","2x","100000"]){const bad=renderToStaticMarkup(createElement(AcquisitionSignIn,{locale,page,search:""}));expect(decodeURIComponent(bad)).not.toContain("&page=");}
});
test.each(["en","he"] as const)("%s review is one contextual view with collapsed administrative actions",locale=>{
 const html=renderToStaticMarkup(createElement(AcquisitionWorkspace,{locale}));expect(html).toContain(locale==="he"?'dir="rtl"':'dir="ltr"');
 expect(html).toContain('type="search" dir="auto"');
 expect((html.match(/<form/g)??[])).toHaveLength(1);expect(html).not.toContain("Synthetic אדם");expect(html).not.toContain("role-switch");
 const card=renderToStaticMarkup(createElement(AcquisitionReviewCard,{item,locale,epoch:3,remember:()=>{},saved:()=>{},denied:()=>{},refresh:()=>{}}));
 expect(card).toContain("<details>");expect(card).not.toContain("<details open");expect(card).toContain("+15550001001");expect(card).toContain('type="date"');
 expect(card).not.toContain('href="https://wa.me');expect(card).not.toContain("caseId");expect(card).not.toContain("Join meeting");
});
test("existing reserved/demo number cannot expose a promotion or matching action",()=>{
 const html=renderToStaticMarkup(createElement(AcquisitionReviewCard,{item:{...item,matching:{state:"reserved",people:[]}},locale:"en",epoch:3,remember:()=>{},saved:()=>{},denied:()=>{},refresh:()=>{}}));
 expect(html).toContain("promotion is blocked");expect(html).not.toContain("Promote to lead — administrative fields only");expect(html).not.toContain("<select");
});
test("existing match has an explicit selection and never a second create form",()=>{
 const html=renderToStaticMarkup(createElement(AcquisitionReviewCard,{item:{...item,matching:{state:"existing",people:[{personId:item.id,displayName:"Existing synthetic person",version:2,eligible:true}]}},locale:"en",epoch:3,remember:()=>{},saved:()=>{},denied:()=>{},refresh:()=>{}}));
 expect(html).toContain("Match existing person");expect(html).toContain("Select a person");expect(html).toContain("Matching preserves the existing name, notes and status");expect(html).not.toContain("<textarea");
});
test("DEMO review never mixes actual inbound records or offers live effects",()=>{
 const html=renderToStaticMarkup(createElement(AcquisitionWorkspace,{locale:"en",mode:"demo"}));expect(html).toContain("Live inbound candidates are not shown in DEMO");expect(html).not.toContain("<form");expect(html).not.toContain("Delete Demo");
});
test.each(["en","he"] as const)("%s restores the explicit match selection after conflict refresh without replaying the stale command",locale=>{
 const draft={fields:{name:"Synthetic",stage:"New inquiry",language:"" as const,note:"Keep authored note",nextAction:"",dueDate:""},person:item.id,pending:null,conflict:false};
 const html=renderToStaticMarkup(createElement(AcquisitionReviewCard,{item:{...item,matching:{state:"existing",people:[{personId:item.id,displayName:"Existing synthetic person",version:3,eligible:true}]}},locale,epoch:4,draft,remember:()=>{},saved:()=>{},denied:()=>{},refresh:()=>{}}));
 expect(html).toContain(`<option value="${item.id}" selected="">`);
 expect(html).not.toContain(locale==="en"?"Retry this decision":"ניסיון חוזר של ההחלטה");
});
test.each(["en","he"] as const)("%s Needs review menu, breadcrumb and login return preserve real section/deep-link context",locale=>{
 const nav=practitionerContext(`/${locale}/app/clients`,null),review=nav.find(value=>value.key==="needs_review")!;
 expect(review.query).toEqual({section:"needs_review"});expect(nav.map(v=>v.path)).not.toContain("app/marketing");
 expect(breadcrumbItems(locale,"practitioner",`/${locale}/app/clients`,"needs_review").at(-1)?.label).toBe(locale==="he"?"לבדיקה":"Needs review");
 const path=practitionerReturnPath(locale,"clients",{section:"needs_review",search:"Synthetic",page:"2"});
 expect(path).toContain("section=needs_review");expect(loginReturnDestination(locale,"practitioner",path)).toBe(path);expect(loginReturnDestination(locale,"parent",path)).not.toBe(path);
});
test("promotion preserves owner note and normal name, while excluding external-status/auth assertions",()=>{
 const command={candidateId:item.id,operationId:"00000000-0000-4000-8000-000000000002",expectedEpoch:3,action:"promote",
  fields:{name:"  Normal synthetic name  ",stage:"  Owner status  ",language:"he",note:"  Keep exact note\nשורה שנייה  ",nextAction:"Owner next action",dueDate:"2026-10-03"}};
 const parsed=acquisitionDecisionSchema.parse(command);expect(parsed.action).toBe("promote");if(parsed.action!=="promote")throw Error("WRONG_ACTION");
 expect(parsed.fields.note).toBe(command.fields.note);expect(parsed.fields.name).toBe("Normal synthetic name");
 for(const bad of [{...command,send:true},{...command,fields:{...command.fields,whatsappLabel:"applied"}},{...command,fields:{...command.fields,caseId:item.id}}])expect(acquisitionDecisionSchema.safeParse(bad).success).toBe(false);
});
test("malformed or over-broad metadata cannot masquerade as a loaded review page",()=>{
 const page={items:[item],total:1,page:1,pages:1,authorityEpoch:3,hasMore:false};expect(acquisitionPageSchema.safeParse(page).success).toBe(true);
 for(const bad of [{...page,total:0},{...page,pages:2},{...page,items:[{...item,messageText:"private body"}]},
  {...page,items:[{...item,matching:{state:"existing",people:[{personId:item.id,displayName:"Synthetic",version:1,eligible:true,role:"child"}]}}]}])expect(acquisitionPageSchema.safeParse(bad).success).toBe(false);
});

test("bounded review windows carry explicit completeness without increasing the response envelope",()=>{
 const page={items:[item],total:1000,page:1,pages:84,authorityEpoch:3,hasMore:true};
 expect(acquisitionPageSchema.safeParse(page).success).toBe(true);
 expect(acquisitionPageSchema.safeParse({...page,items:[],total:0,pages:1}).success).toBe(true); // Search may match none of this partial window.
 const missing={items:page.items,total:page.total,page:page.page,pages:page.pages,authorityEpoch:page.authorityEpoch};expect(acquisitionPageSchema.safeParse(missing).success).toBe(false);
 for(const bad of [{...page,total:1001},{...page,hasMore:"true"},{...page,hasMore:undefined},{...page,items:Array.from({length:13},()=>item)}])expect(acquisitionPageSchema.safeParse(bad).success).toBe(false);
});

test.each(['en','he'] as const)('%s renders explicit partial-search scope even for no matches, not a false total or failure',locale=>{
 const partial=renderToStaticMarkup(createElement(AcquisitionWindowSummary,{locale,total:0,hasMore:true}));
 expect(partial).toContain('role="status"');expect(partial).toContain('1,000');expect(partial).toContain(locale==='en'?'Search and counts apply to this window':'החיפוש והספירה מתייחסים לחלון הזה');
 expect(partial).toContain(locale==='en'?'older pending records appear as decisions are saved':'רשומות קודמות יופיעו ככל שהחלטות יישמרו');
 const complete=renderToStaticMarkup(createElement(AcquisitionWindowSummary,{locale,total:1,hasMore:false}));expect(complete).not.toContain('role="status"');expect(complete).not.toContain('1,000');
});
test("a save acknowledgement cannot fabricate an applied label, account grant or inconsistent person",()=>{
 const result={candidateId:item.id,state:"NOT_A_LEAD",personId:null,version:null,authorityEpoch:3,replayed:false,projections:null};
 expect(acquisitionDecisionResultSchema.safeParse(result).success).toBe(true);
 for(const bad of [{...result,state:"PROMOTED"},{...result,accountId:item.id},{...result,personId:item.id},
  {...result,state:"PROMOTED",personId:item.id,version:1,projections:{google:"applied",whatsapp:"applied",reason:"provider_applied"}}])expect(acquisitionDecisionResultSchema.safeParse(bad).success).toBe(false);
});
