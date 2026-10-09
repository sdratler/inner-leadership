import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {audienceCommandSchema} from "../../../src/features/contact-ops/core/audience-interest.ts";
import {AudienceInterestWorkspace} from "../../../src/features/contact-ops/audience-interest-workspace.tsx";
import {practitionerContext,breadcrumbItems} from "../../../src/ui/workspace/navigation-model.ts";
import {loginReturnDestination} from "../../../src/features/identity/login-return.ts";

const command={action:"record_interest",topic:"bna_content",state:"expressed",operationId:"00000000-0000-4000-8000-000000000001",expectedEpoch:3,expectedVersion:null,displayName:"Synthetic reader",phone:"+972520000001",observedAt:"2026-10-08T10:00:00.000Z",sourceRef:"Synthetic owner note",observation:{kind:"article_request",evidence:"Synthetic request"}};
describe("native content audience contract",()=>{
 it("accepts only bounded interest and observation commands without permission or send fields",()=>{
  expect(audienceCommandSchema.parse(command)).toEqual(command);
  for(const patch of [{permission:"granted"},{send:true},{topic:"sales"},{state:"qualified"},{displayName:"",phone:""}])expect(audienceCommandSchema.safeParse({...command,...patch}).success).toBe(false);
  for(const kind of ["group_membership","provider_label","provider_list"] as const)expect(audienceCommandSchema.safeParse({...command,observation:{kind,evidence:"Synthetic observation"}}).success).toBe(false);
  const observation={...command,action:"record_observation",observation:{kind:"provider_label",evidence:"Synthetic observation"}} as Record<string,unknown>;delete observation.state;
  expect(audienceCommandSchema.safeParse(observation).success).toBe(true);
 });
 it.each(["en","he"] as const)("renders one %s audience toolbar with neutral copy and responsive app classes",locale=>{
  const html=renderToStaticMarkup(createElement(AudienceInterestWorkspace,{locale,epoch:3}));
  expect(html).toContain(locale==="he"?"קהל תוכן":"Content audience");
  expect(html).toContain('role="search"');expect(html.match(/lsw-toolbar/g)).toHaveLength(1);
  expect(html).toContain('aria-expanded="false"');expect(html).not.toContain("Open WhatsApp");expect(html).not.toContain("Delete Demo");
  expect(html).toContain(locale==="he"?"אינה יוצרת מתעניין":"does not create a prospect");
  expect(html).toContain(locale==="he"?"מצב העניין":"Interest state");
  if(locale==="he")expect(html).not.toContain("Do not contact");
 });
 it("keeps the audience deep link in practitioner navigation and normal login return only",()=>{
  const context=practitionerContext("/en/app/clients",null),item=context.find(value=>value.key==="audience");
  expect(item?.query).toEqual({section:"audience"});
  expect(breadcrumbItems("he","practitioner","/he/app/clients","audience").at(-1)?.label).toBe("קהל תוכן");
  expect(loginReturnDestination("en","practitioner","/en/app/clients?section=audience")).toBe("/en/app/clients?section=audience");
  expect(loginReturnDestination("en","parent","/en/app/clients?section=audience")).toBe("/en/family/schedule");
 });
});
