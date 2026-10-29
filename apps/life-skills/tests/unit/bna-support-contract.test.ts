import {expect,it} from "vitest";
import {BNA_SUPPORT_NOTICE,BNA_SUPPORT_UPDATES_NOTICE,bnaSupportFieldsSchema} from "../../src/features/bna-inquiry/support-contract.ts";
const fields={name:"Synthetic supporter",contactChannel:"phone",contact:"+12025550129",purpose:"support_conversation",language:"en",siteLanguage:"he",emailUpdates:false,
 permission:{confirmed:true,version:BNA_SUPPORT_NOTICE.version,language:"he"}};
it("accepts an adult phone-only support conversation without requiring child or donor facts",()=>{
 expect(bnaSupportFieldsSchema.safeParse(fields).success).toBe(true);
 for(const extra of [{childAges:[10]},{childName:"Synthetic"},{donationAmount:100},{donorConfirmed:true},{program:"bna_learning_coop"}])expect(bnaSupportFieldsSchema.safeParse({...fields,...extra}).success).toBe(false);
});
it("requires an explicit current email-channel permission for project updates",()=>{
 const updates={...fields,contactChannel:"email",contact:"support@example.invalid",purpose:"project_updates",emailUpdates:true,
  updatesPermission:{confirmed:true,channel:"email",version:BNA_SUPPORT_UPDATES_NOTICE.version,language:"he"}};
 expect(bnaSupportFieldsSchema.safeParse(updates).success).toBe(true);
 for(const changed of [{updatesPermission:undefined},{emailUpdates:false},{contactChannel:"phone",contact:fields.contact},{updatesPermission:{...updates.updatesPermission,confirmed:false}},{updatesPermission:{...updates.updatesPermission,language:"en"}},{updatesPermission:{...updates.updatesPermission,channel:"sms"}},{permission:{...fields.permission,language:"en"}}])expect(bnaSupportFieldsSchema.safeParse({...updates,...changed}).success).toBe(false);
});
