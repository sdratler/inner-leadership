import {randomUUID} from "node:crypto";
import {expect,it} from "vitest";
import {BNA_COOP_NOTICE,type BnaCoopFields} from "../../src/features/bna-inquiry/coop-contract.ts";
import {BNA_SUPPORT_NOTICE,type BnaSupportFields} from "../../src/features/bna-inquiry/support-contract.ts";
import {decideBnaEducationalDelivery,freezeBnaAcknowledgment} from "../../src/features/bna-communications/delivery-policy.ts";

const fields:BnaCoopFields={name:"Synthetic Parent",contactChannel:"email",contact:"parent@example.invalid",emailUpdates:false,
 language:"he",siteLanguage:"en",townOrZip:"Synthetic town",childAges:[11],question:"PRIVATE CHILD NOTE MUST NOT ENTER MAIL",
 permission:{confirmed:true,version:BNA_COOP_NOTICE.version,language:"en"}};
it("freezes the exact service message in the chosen message language without child or optional-consent data",()=>{
 const ref=randomUUID(),message=freezeBnaAcknowledgment("bna_learning_coop",ref,fields)!;
 expect(message).toMatchObject({templateId:"EMAIL-B0",locale:"he",recipient:fields.contact,reference:ref});
 expect(message.text).toContain(ref);expect(message.text).toContain("שלום Synthetic Parent,");
 expect(JSON.stringify(message)).not.toMatch(/PRIVATE CHILD NOTE|Synthetic town|childAges|emailUpdates|permission/);
 const support={name:fields.name,contactChannel:"email",contact:fields.contact,purpose:"support_conversation",language:"en",siteLanguage:"en",emailUpdates:false,
  permission:{confirmed:true,version:BNA_SUPPORT_NOTICE.version,language:"en"}} as BnaSupportFields;
 expect(freezeBnaAcknowledgment("bna_support_interest",ref,support)).toMatchObject({templateId:"EMAIL-S0",locale:"en"});
});
it("does not email a phone-selected reply even if optional updates have a separate email, and does not break valid unusual names",()=>{
 expect(freezeBnaAcknowledgment("bna_learning_coop",randomUUID(),{...fields,contactChannel:"phone",contact:"+12025550123",emailUpdates:true,secondaryContact:{channel:"email",value:fields.contact}})).toBeNull();
 expect(freezeBnaAcknowledgment("bna_learning_coop",randomUUID(),{...fields,name:"Parent\n{{REFERENCE}}"})?.text.startsWith("שלום,\n")).toBe(true);
});
const permitted={templateId:"EMAIL-B1" as const,now:new Date("2026-10-10T12:00:00Z"),permissionGrantedAt:new Date("2026-10-01T12:00:00Z"),
 withdrawn:false,paused:false,replyPending:false,closed:false,invalidRecipient:false,complaint:false,unknownDelivery:false,identicalContentSent:false,educationalSentAt:[]};
it("anchors from actual permission, pauses on a reply or closed outcome and retains suppression reasons",()=>{
 expect(decideBnaEducationalDelivery({...permitted,permissionGrantedAt:null})).toEqual({eligible:false,reason:"no_permission"});
 expect(decideBnaEducationalDelivery({...permitted,permissionGrantedAt:new Date("2026-10-10T12:00:00Z")})).toEqual({eligible:false,reason:"not_due",nextEligibleAt:"2026-10-13T12:00:00.000Z"});
 for(const [field,reason] of [["withdrawn","withdrawn"],["paused","paused"],["replyPending","reply_pending"],["closed","closed"],["invalidRecipient","invalid_recipient"],["complaint","complaint"],["unknownDelivery","unknown_delivery"],["identicalContentSent","already_sent"]] as const)
  expect(decideBnaEducationalDelivery({...permitted,[field]:true})).toEqual({eligible:false,reason});
});
it("coordinates co-op/support/donor educational messages with one rolling calendar and exact 48-hour boundaries",()=>{
 const history=[new Date("2026-10-05T12:00:00Z"),new Date("2026-10-08T12:00:00Z")];
 expect(decideBnaEducationalDelivery({...permitted,templateId:"EMAIL-D1",educationalSentAt:history})).toEqual({eligible:false,reason:"weekly_cap",nextEligibleAt:"2026-10-12T12:00:00.000Z"});
 expect(decideBnaEducationalDelivery({...permitted,templateId:"EMAIL-S1",now:new Date("2026-10-12T12:00:00Z"),educationalSentAt:history}).eligible).toBe(true);
 expect(decideBnaEducationalDelivery({...permitted,educationalSentAt:[new Date("2026-10-09T12:00:00Z")]})).toEqual({eligible:false,reason:"spacing",nextEligibleAt:"2026-10-11T12:00:00.000Z"});
 expect(()=>decideBnaEducationalDelivery({...permitted,educationalSentAt:[new Date("2026-10-11T12:00:00Z")]})).toThrow("BNA_EMAIL_CALENDAR_INVALID");
});
