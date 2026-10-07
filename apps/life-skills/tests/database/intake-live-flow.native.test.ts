import {randomUUID} from "node:crypto";
import {afterAll,expect,test,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "./calendar/fixture.ts";
import {PreEnrollmentStaffService} from "../../src/features/forms/pre-enrollment/staff.ts";
import {PreEnrollmentService} from "../../src/features/forms/pre-enrollment/service.ts";
import {SqlPreEnrollmentRepository} from "../../src/features/forms/pre-enrollment/repository.ts";
import {publicConsentHash} from "../../src/features/forms/pre-enrollment/consent.ts";
import {respondentLink} from "../../src/features/forms/pre-enrollment/staff-link.ts";
import {readProspectJourneys} from "../../src/features/prospects/journey-read.ts";

const fixtures:Fixture[]=[];
afterAll(async()=>{for(const f of fixtures)await f.pool.end();vi.unstubAllEnvs();});

const consent={version:"synthetic-native-intake-20261007",sourceHashes:["a".repeat(64),"b".repeat(64)],
 displayText:["Synthetic consent paragraph."],acknowledgements:["One.","Two.","Three."],
 translations:{en:{displayText:["Synthetic English consent paragraph."],acknowledgements:["One.","Two.","Three."]}}};

test("fragment invitation -> native receipt -> awaiting payment -> practitioner readback",async()=>{
 vi.stubEnv("LS_INTAKE_PUBLIC_CONSENT_JSON",JSON.stringify(consent));
 const f=await fixture();fixtures.push(f);const store=poolStore(f.pool),now=new Date(),leadId="LS-LEAD-synthetic-native-intake";
 const staff=new PreEnrollmentStaffService(store,f.keyring,()=>now),issued=await staff.issue(f.practitioner.actor,leadId,1);
 const href=respondentLink("https://life-skills.bneineviimacademy.org",issued.token,"en");
 expect(href).toBe(`https://life-skills.bneineviimacademy.org/en/intake#${issued.token}`);
 expect(href).not.toContain("?token=");
 const publicFlow=new PreEnrollmentService(new SqlPreEnrollmentRepository(store,f.workspaceId),f.keyring,()=>now,true,f.workspaceId);
 const exchange=await publicFlow.exchange(issued.token);expect(exchange.childSlotIds).toHaveLength(1);
 const input={parentName:"Synthetic Parent",contactNumber:"+15555550126",preferredLanguage:"en",email:"parent@example.invalid",
  children:[{childSlotId:exchange.childSlotIds[0]!,firstName:"Synthetic Child",age:8}],locationPreference:"Synthetic park",
  arrivalNeeds:"",availableDays:["sun"],timeWindows:["evening"],availabilityNote:"",privateContext:"Synthetic private context",
  cp01:"not_now",willingToBeContacted:"yes",accessSupportNeeded:"no",consentVersion:consent.version,
  consentHash:publicConsentHash(consent),consentAcknowledgements:[true,true,true],consentLanguage:"en",signerName:"Synthetic Signer"};
 const receipt=await publicFlow.submit(issued.token,randomUUID(),input);
 expect(receipt).toMatchObject({stableLeadId:leadId,duplicate:false});
 expect(await readProspectJourneys(store,f.workspaceId,[leadId])).toEqual(new Map([[leadId,
  {journeyState:"awaiting_payment",paymentVerified:false,bookingConfirmed:false}]]));
 expect(await staff.list(f.practitioner.actor)).toContainEqual(expect.objectContaining({receiptId:receipt.receiptId,amendmentCount:0}));
 expect(await staff.history(f.practitioner.actor,receipt.receiptId)).toMatchObject([{kind:"original",input:{parentName:"Synthetic Parent",
  children:[{firstName:"Synthetic Child"}]},consent:{version:consent.version,hash:publicConsentHash(consent)}}]);
 await expect(staff.history(f.parent.actor,receipt.receiptId)).rejects.toMatchObject({code:"FORBIDDEN"});
 const persisted=(await f.pool.query<{payload:string;consumedAt:Date|null}>(`SELECT r.payload_ciphertext AS payload,i.consumed_at AS "consumedAt"
  FROM ls_intake.pre_enrollment_receipts r JOIN ls_intake.pre_enrollment_invitations i
  ON i.workspace_id=r.workspace_id AND i.invitation_id=r.invitation_id WHERE r.workspace_id=$1 AND r.receipt_id=$2`,
  [f.workspaceId,receipt.receiptId])).rows[0]!;
 expect(persisted.payload).not.toContain("Synthetic Parent");expect(persisted.payload).not.toContain("Synthetic Child");
 expect(persisted.consumedAt).toBeInstanceOf(Date);
 expect((await f.pool.query("SELECT * FROM ls_contact_ops.outbound_projections WHERE workspace_id=$1",[f.workspaceId])).rows).toHaveLength(0);
});
