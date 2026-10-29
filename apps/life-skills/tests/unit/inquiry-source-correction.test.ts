import {randomUUID} from "node:crypto";
import {expect,it} from "vitest";
import {bnaFollowupCommandSchema} from "../../src/features/bna-inquiry/contract.ts";
import {fishingFollowupCommandSchema} from "../../src/features/group-application/fishing-followup-contract.ts";

it("requires both a source and its basis while preserving legacy follow-up commands",()=>{
 const common={operationId:randomUUID(),expectedVersion:1,status:"waiting",note:"Synthetic note",nextAction:null,dueDate:null,waitingCondition:"Await reply"};
 for(const [schema,id] of [[bnaFollowupCommandSchema,{inquiryId:randomUUID()}],[fishingFollowupCommandSchema,{applicationId:randomUUID()}]] as const){
  const command={...common,...id};expect(schema.safeParse(command).success).toBe(true);
  expect(schema.safeParse({...command,sourceCorrection:{source:"Community referral",basis:"Parent stated this"}}).success).toBe(true);
  for(const sourceCorrection of [{source:"",basis:"Parent stated this"},{source:"Community referral",basis:"  "},{source:"Community referral",basis:"Parent stated this",extra:true}])expect(schema.safeParse({...command,sourceCorrection}).success).toBe(false);
 }
});
