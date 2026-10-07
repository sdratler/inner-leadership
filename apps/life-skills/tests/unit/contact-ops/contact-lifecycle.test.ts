import {expect,test} from "vitest";
import {changeAdministrativeArchive,contactLifecycleSchema} from "../../../src/features/contact-ops/core/contact-lifecycle.ts";
const at=new Date("2026-10-07T14:00:00Z");
const profile:{administrativeArchive?:{archivedAt:string};stage:string;notes:string;nextAction:string;followUpDate:string;doNotContact:boolean;legacyIds:string[];caseIds:string[]}={stage:"Custom owner stage",notes:"Original\nהערה",nextAction:"Call",followUpDate:"2026-10-08",doNotContact:true,legacyIds:["LS-LEAD-synthetic"],caseIds:["synthetic-case"]};
test("archive and restore preserve stage, notes, dates, suppression and linked identities without mutating the input",()=>{
 const before=structuredClone(profile),archived=changeAdministrativeArchive(profile,"archive",at);
 expect(profile).toEqual(before);expect(archived.administrativeArchive).toEqual({archivedAt:at.toISOString()});
 const restored=changeAdministrativeArchive(archived,"restore",at);
 expect(restored).toEqual(Object.fromEntries(Object.entries(profile).filter(([key])=>key!=="administrativeArchive")));
 expect(archived.administrativeArchive).toBeDefined();expect(restored.doNotContact).toBe(true);
});
test("restore refuses a legacy stage/identity archive without a recoverable administrative marker",()=>{
 expect(()=>changeAdministrativeArchive({...profile,stage:"Archived"},"restore",at)).toThrow("CONFLICT");
 expect(()=>changeAdministrativeArchive(changeAdministrativeArchive(profile,"archive",at),"archive",at)).toThrow("CONFLICT");
});
test("lifecycle commands are bounded and reject caller-supplied linked records, role, mode or prior stage",()=>{
 const command={action:"archive",personId:"00000000-0000-4000-8000-000000000001",expectedEpoch:3,expectedVersion:1,operationId:"00000000-0000-4000-8000-000000000002"};
 expect(contactLifecycleSchema.parse(command)).toEqual(command);
 for(const extra of [{role:"practitioner"},{mode:"demo"},{caseIds:[]},{stage:"New inquiry"},{action:"delete"},{expectedVersion:0}])
  expect(contactLifecycleSchema.safeParse({...command,...extra}).success).toBe(false);
});
