/** Synthetic fixtures only. These are not client identities or production keys. */
import { asId } from '../../../src/lib/ids.ts';
import type { AccountFacts, Actor } from '../../../src/features/identity/types.ts';
import type { CaseFacts, AudienceFacts, GuardianFacts } from '../../../src/features/cases/policy.ts';
import type { Appointment, AppointmentView, CreateBooking } from '../../../src/features/calendar/types.ts';
export const uuid=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const workspace=asId(uuid(1),'workspace'),caseId=asId(uuid(2),'case'),practitionerId=asId(uuid(3),'account'),parentId=asId(uuid(4),'account'),parentTwoId=asId(uuid(5),'account'),audienceId=asId(uuid(6),'audience');
export const practitioner:AccountFacts={id:practitionerId,workspaceId:workspace,personId:asId(uuid(13),'person'),role:'practitioner',state:'active',locale:'en'};
export const parent:AccountFacts={...practitioner,id:parentId,personId:asId(uuid(14),'person'),role:'parent'};
export const parentTwo:AccountFacts={...parent,id:parentTwoId,personId:asId(uuid(15),'person')};
export const actor:Actor={...practitioner,sessionDigest:'a'.repeat(64),expiresAt:Date.parse('2026-09-08T00:00:00Z')};
export const facts:CaseFacts={id:caseId,workspaceId:workspace,clientPersonId:asId(uuid(7),'person'),practitionerAccountId:practitionerId,kind:'minor',state:'active'};
export const guardians:GuardianFacts[]=[parentId,parentTwoId].map(accountId=>({caseId,workspaceId:workspace,accountId,revoked:false}));
export const audience:AudienceFacts={id:audienceId,caseId,workspaceId:workspace,visibility:'family_full',published:true,accountIds:[parentId,parentTwoId]};
export const appointment:Appointment={id:asId(uuid(8),'appointment'),workspaceId:workspace,caseId,audienceId,engagementId:asId(uuid(9),'engagement'),practitionerId,termsVersion:'Product 2.3',kind:'individual',
 startsAt:'2026-09-08T10:00:00.000Z',endsAt:'2026-09-08T11:00:00.000Z',status:'scheduled',parentForId:null,originalId:null,parentIds:[],bufferBefore:0,bufferAfter:0,version:1,
 location:'Synthetic agreed meeting point',createdBy:practitionerId,createdAt:'2026-09-01T10:00:00.000Z'};
export const booking:CreateBooking={caseId,audienceId,kind:'individual',startsAt:appointment.startsAt,parentForId:null,parentIds:[],bufferBefore:0,bufferAfter:0,location:'Synthetic logistics only',checkinExceptionReason:null};
export const appointmentView:AppointmentView={...appointment,notice:null,attendance:null,countsAsChildSession:false,checkinNeedsReview:false,creditException:null,replacementId:null};
