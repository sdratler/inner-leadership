import {expect,test,vi} from "vitest";
import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
vi.mock("server-only",()=>({}));
import {AcquisitionWorkspace,AcquisitionReviewCard} from "../../../src/features/contact-ops/acquisition-workspace.tsx";
import {acquisitionDecisionSchema,acquisitionPageSchema,acquisitionDecisionResultSchema,type AcquisitionReviewItem} from "../../../src/features/contact-ops/core/acquisition.ts";
import {practitionerContext,breadcrumbItems} from "../../../src/ui/workspace/navigation-model.ts";
import {practitionerReturnPath,loginReturnDestination} from "../../../src/features/identity/login-return.ts";
const item:AcquisitionReviewItem={id:"00000000-0000-4000-8000-000000000001",source:"organic_whatsapp",phone:"+15550001001",displayName:"Synthetic אדם",
 occurredAt:"2026-10-02T10:00:00.000Z",state:"NEEDS_REVIEW",matching:{state:"unmatched",people:[]}};
test.each(["en","he"] as const)("%s review is one contextual view with collapsed administrative actions",locale=>{
 const html=renderToStaticMarkup(createElement(AcquisitionWorkspace,{locale}));expect(html).toContain(locale==="he"?'dir="rtl"':'dir="ltr"');
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
 const page={items:[item],total:1,page:1,pages:1,authorityEpoch:3};expect(acquisitionPageSchema.safeParse(page).success).toBe(true);
 for(const bad of [{...page,total:0},{...page,pages:2},{...page,items:[{...item,messageText:"private body"}]},
  {...page,items:[{...item,matching:{state:"existing",people:[{personId:item.id,displayName:"Synthetic",version:1,eligible:true,role:"child"}]}}]}])expect(acquisitionPageSchema.safeParse(bad).success).toBe(false);
});
test("a save acknowledgement cannot fabricate an applied label, account grant or inconsistent person",()=>{
 const result={candidateId:item.id,state:"NOT_A_LEAD",personId:null,version:null,authorityEpoch:3,replayed:false,projections:null};
 expect(acquisitionDecisionResultSchema.safeParse(result).success).toBe(true);
 for(const bad of [{...result,state:"PROMOTED"},{...result,accountId:item.id},{...result,personId:item.id},
  {...result,state:"PROMOTED",personId:item.id,version:1,projections:{google:"applied",whatsapp:"applied",reason:"provider_applied"}}])expect(acquisitionDecisionResultSchema.safeParse(bad).success).toBe(false);
});
