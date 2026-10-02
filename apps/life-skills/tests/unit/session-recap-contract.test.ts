import {expect,test} from "vitest";
import {recapDraftSchema,recapShareInputSchema,routineRecapSchema,recapPublicationSchema,recapPracticeChoicesSchema} from "../../src/features/session-workflow/recap-contract.ts";
const id="00000000-0000-4000-8000-000000000001",other="00000000-0000-4000-8000-000000000002";
const recap={schemaVersion:1,sessionId:id,caseId:other,version:1,locale:"he",attendance:{appointmentId:other,state:"unrecorded",source:"appointment_record",revision:0,startsAt:"2026-10-01T10:00:00.000Z",arrivedAt:null},focus:["regulation"],practices:[],nextStep:"DEMO — הצעד הבא",nextAppointment:null};
test("routine projection is a strict whitelist; invalid facts and private source fields are not silently discarded",()=>{
 expect(routineRecapSchema.parse(recap)).toEqual(recap);
 for(const changed of [{...recap,analysis:[]},{...recap,transcript:{segments:[]}},{...recap,metrics:{}},{...recap,focus:["constructor"]},{...recap,focus:["regulation","regulation"]},{...recap,attendance:{...recap.attendance,startsAt:"2026-02-30T00:00:00Z"}},{...recap,nextAppointment:{id,startsAt:"2026-10-01T11:00:00Z",endsAt:"2026-10-01T10:00:00Z",timezone:"Asia/Jerusalem",source:"calendar"}}])expect(routineRecapSchema.safeParse(changed).success).toBe(false);
});
test("reviewed short instructions are bounded and source selection is unique; old empty command stays unchanged",()=>{
 const draft={locale:"en",focus:[],nextStep:"",expectedVersion:0},selection={versionId:id,expectedSourceDigest:"a".repeat(64),instructions:"DEMO — Reviewed instruction"};expect(recapDraftSchema.parse(draft)).toEqual(draft);
 expect(recapDraftSchema.parse({...draft,practiceSelections:[selection]}).practiceSelections).toEqual([selection]);
 for(const changes of [{practiceSelections:[selection,selection]},{practiceSelections:[{...selection,instructions:" "}]},{practiceSelections:[{...selection,instructions:"x".repeat(501)}]},{practiceSelections:[{...selection,assignmentId:other}]},{practices:[]},{privateNote:"no"}])expect(recapDraftSchema.safeParse({...draft,...changes}).success).toBe(false);
});
test("share receipt ties exact case/session and audience; duplicate or invented recipients fail closed",()=>{
 const share={expectedVersion:1,expectedDigest:"a".repeat(64),recipientAccountIds:[id]};expect(recapShareInputSchema.parse(share)).toEqual(share);
 for(const changes of [{recipientAccountIds:[]},{recipientAccountIds:[id,id]},{recipientAccountIds:["constructor"]},{expectedVersion:0},{expectedDigest:"ready"},{delivery:"sent"}])expect(recapShareInputSchema.safeParse({...share,...changes}).success).toBe(false);
 const publication={publicationId:id,sessionId:id,caseId:other,sharedAt:"2026-10-02T10:00:00.000Z",contentDigest:share.expectedDigest,recipientAccountIds:[id],recap};expect(recapPublicationSchema.parse(publication)).toEqual(publication);expect(recapPublicationSchema.safeParse({...publication,caseId:id}).success).toBe(false);
 expect(recapPracticeChoicesSchema.safeParse({items:[],hasMore:false,source:"mock"}).success).toBe(false);
});
