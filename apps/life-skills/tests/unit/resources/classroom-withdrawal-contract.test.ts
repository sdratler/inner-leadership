import {expect,it} from "vitest";
import {classroomWithdrawalCommandSchema,classroomWithdrawalVersion} from "../../../src/features/resources/classroom-withdrawal-contract.ts";
const id="11111111-1111-4111-8111-111111111111",input={version:classroomWithdrawalVersion,operationId:id,stageId:id,householdId:id,expectedScopeSha256:"a".repeat(64)};
it("accepts only a reviewed named scope and no caller-supplied identity, grants or revocation targets",()=>{
 expect(classroomWithdrawalCommandSchema.safeParse(input).success).toBe(true);
 for(const change of [{expectedScopeSha256:""},{householdId:"unknown"},{stageId:null},{version:"old"},{actorId:id},{role:"practitioner"},{learnerIds:[id]},{parentAccountIds:[id]},{allFamilies:true}])expect(classroomWithdrawalCommandSchema.safeParse({...input,...change}).success).toBe(false);
});
