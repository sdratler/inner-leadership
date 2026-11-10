import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import type {PGlite} from '@electric-sql/pglite';
import {asId} from '../../src/lib/ids.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {seal} from '../../src/features/identity/crypto.ts';
import {currentTrip390Fields} from './trip390-current.ts';
import {ContactCutoverStore} from '../../src/features/contact-ops/server/cutover-store.ts';
import {AcademyCrmStore} from '../../src/features/contact-ops/server/academy-crm-store.ts';
import {PublicGroupApplicationStore} from '../../src/features/group-application/store.ts';
import {FishingBillingInquiryFamilyProposals} from '../../src/lib/fishing-billing-inquiry-family-proposal.ts';
import {NATIVE_FAMILY_VERSION} from '../../src/features/fishing-billing/native-family-contract-v1.ts';
import {FishingGroupPreparationStore} from '../../src/features/fishing-billing/group-preparation-store.ts';
import {GROUP_PREPARATION_VERSION} from '../../src/features/fishing-billing/group-preparation-contract.ts';
import {FishingProgramSourceNativeV3} from '../../src/features/fishing-billing/program-source-native-v3.ts';
import {PROGRAM_SOURCE_V3,type ProgramSourceCommandV3} from '../../src/features/fishing-billing/program-source-contract-v3.ts';
import {FishingBillingGuestOwnerStore} from '../../src/lib/fishing-billing-guest-owner-store.ts';
import {ANCHORED_OFFER_V3} from '../../src/features/fishing-billing/child-period-provenance-v3.ts';
import {syntheticDefinition} from '../../src/features/fishing-billing/fixtures.ts';
import type {BillingAuthority} from '../../src/features/fishing-billing/native.ts';

export const programNow=new Date('2035-01-02T15:00:00Z'),programClock={now:()=>new Date(programNow)};
export const programRing={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}};
export const programKey='SYNTHETIC-FLORIDA-PROGRAM-SOURCE-UNAPPROVED';
export async function initializeProgramSchema(engine:PGlite){
 await engine.exec('CREATE SCHEMA ls_control');
 for(const name of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0030_ls_calendar_attendance_20260907.sql','0097_ls_demo_provenance.sql',
  '0101_ls_contact_operations.sql','0105_ls_contact_authority.sql','0110_ls_contact_outbound_projection.sql','0116_ls_acquisition_candidates.sql',
  '0124_ls_group_interest.sql','0131_ls_public_group_applications.sql','0133_ls_fishing_lead_memberships.sql','0135_ls_inquiry_email_outbox.sql','0138_ls_academy_crm.sql'])
  await engine.exec(await readFile('migrations/'+name,'utf8'));
 await engine.exec(await readFile('tests/fixtures/fishing-billing.sql','utf8'));
 for(const name of ['UNNUMBERED_ls_fishing_inquiry_family_proposals.sql','UNNUMBERED_ls_fishing_billing_guest_v3.sql'])await engine.exec(await readFile('migrations/proposals/'+name,'utf8'));
 await engine.exec(await readFile('migrations/0153_ls_fishing_group_preparations.sql','utf8'));
 await engine.exec(await readFile('migrations/proposals/UNNUMBERED_ls_fishing_program_source_v3.sql','utf8'));
}
export async function nativeProgramFixture(engine:PGlite){
 const db:IdentityStore={transaction:work=>engine.transaction(tx=>work({query:async<T extends object>(sql:string,v:readonly unknown[]=[])=>
  (await tx.query<T>(sql,[...v])).rows} as SqlSession))};
 const workspace=asId(randomUUID(),'workspace'),ring=programRing,key=programKey,clock=programClock;
 await engine.query('INSERT INTO ls_identity.workspaces VALUES($1,$2)',[workspace,programNow]);
 async function actor(role:'practitioner'|'parent'){
  const id=asId(randomUUID(),'account'),personId=asId(randomUUID(),'person'),digest=createHash('sha256').update(id).digest('hex');
  await engine.query("INSERT INTO ls_identity.people VALUES($1,$2,'adult',$3,$4)",[personId,workspace,seal(JSON.stringify({displayName:'SYNTHETIC '+role}),`person:${workspace}:${personId}`,ring),programNow]);
  await engine.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'SYNTHETIC',$5,'SYNTHETIC',$5,$5)",[id,workspace,role,digest,programNow]);
  await engine.query('INSERT INTO ls_identity.account_subjects VALUES($1,$2,$3)',[workspace,id,personId]);
  await engine.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[digest,workspace,id,programNow,new Date('2036-01-01T00:00:00Z')]);
  return {id,workspaceId:workspace,personId,role,state:'active',locale:'en',sessionDigest:digest,expiresAt:Date.parse('2036-01-01T00:00:00Z')} as Actor;
 }
 const owner=await actor('practitioner'),parent=await actor('parent');
 await new ContactCutoverStore(db,ring,key,clock).initializeAcademy(owner,{operationId:randomUUID(),expectedEpoch:0,observedNativeWritesSinceSwitch:0,decisionId:'ACADEMY-ONLY-CRM-20261028-01',
  evidence:{retiredSourcesFence:'a'.repeat(64),retiredSchedulesFence:'b'.repeat(64),retainedAcademyRecords:'c'.repeat(64),queueReconciliation:'d'.repeat(64),restorePlan:'e'.repeat(64)}});
 const fields={...currentTrip390Fields(),email:'synthetic-'+randomUUID()+'@example.invalid',children:[
  {id:randomUUID(),name:'SYNTHETIC One',ageYears:11,experience:'new' as const},{id:randomUUID(),name:'SYNTHETIC Two',ageYears:13,experience:'some' as const}]};
 const inquiry=await new PublicGroupApplicationStore(db,workspace,ring,key,clock).submit({operationId:randomUUID(),fields});
 const crm=new AcademyCrmStore(db,ring,key,clock),preview=await crm.previewInquiry(owner,inquiry.item.id,1);
 await crm.execute(owner,{action:'from_inquiry',operationId:randomUUID(),expectedEpoch:1,sourceApplicationId:inquiry.item.id,sourceDigest:preview.sourceDigest,
  fields:{stage:'SYNTHETIC',notes:'',nextAction:null,followUpDate:null}});
 const families=new FishingBillingInquiryFamilyProposals(db,workspace,ring,key,clock);
 const family=(await families.createNativeFamily(owner,{version:NATIVE_FAMILY_VERSION,operationId:randomUUID(),reference:inquiry.item.id,expectedEpoch:1,expectedSourceDigest:preview.sourceDigest,
  ownerReviewedMapping:true,familyId:randomUUID(),familyLabel:'SYNTHETIC family',children:fields.children.map(c=>({applicationChildId:c.id,nativeChildId:randomUUID()}))})).record;
 const groupId=randomUUID();
 await new FishingGroupPreparationStore(db,workspace,ring,key,{isCurrentOwner:async(_tx,scope)=>scope.accountId===owner.id},clock).save(owner,
  {version:GROUP_PREPARATION_VERSION,action:'create',expectedRevision:0,operationId:randomUUID(),groupId,fields:{label:'SYNTHETIC preparation',timeZone:'America/New_York'}});
 const source=(binder:IdentityStore=db)=>new FishingProgramSourceNativeV3(binder,workspace,ring,key,owner.id,clock);
 const command=(kind:ProgramSourceCommandV3['kind'],id:string,fields:unknown,expectedRevision=0)=>({version:PROGRAM_SOURCE_V3,operationId:randomUUID(),groupId,id,kind,fields,expectedRevision});
 const group=()=>command('group',groupId,{state:'forming',location:'SYNTHETIC actual planned Florida site',venueSource:{id:'SYNTHETIC-UNAPPROVED-SITE',sha256:'c'.repeat(64)}});
 const lesson=(id:string,sequence:number,startsAt:string,expectedRevision=0,state='scheduled')=>command('lesson',id,{state,sequence,startsAt,endsAt:new Date(Date.parse(startsAt)+3_600_000).toISOString(),timeZone:'America/New_York'},expectedRevision);
 const progression=(index:number,eligibleFrom:string,readiness='needs_foundation',expectedRevision=0)=>command('progression',family.command.selection.children[index]!.nativeChildId,
  {state:'planned',familyId:family.command.selection.familyId,proposalId:family.id,reference:inquiry.item.id,expectedEpoch:1,eligibleFrom,readiness,
   evidence:readiness==='needs_foundation'?null:{id:'SYNTHETIC-OWNER-VERIFIED-SKILLS',sha256:'d'.repeat(64)}},expectedRevision);
 const authority:BillingAuthority={authorize:async(c,_action,scope)=>{
  const data=await families.readCurrentDataInTransaction(c.tx,{proposalId:family.id,reference:inquiry.item.id,expectedEpoch:1,lock:'shared'});
  if(scope.familyId!==data.proposal.command.selection.familyId||scope.childIds.some(id=>!data.proposal.command.selection.children.some(child=>child.nativeChildId===id)))throw Error('SYNTHETIC_SCOPE_DENIED');
 },reminderPermission:async()=>{throw Error('NO_SENDER');}};
 const billing=(program=source())=>new FishingBillingGuestOwnerStore(db,workspace,ring,Buffer.from(key),clock,authority,program);
 const definition={...syntheticDefinition(),id:randomUUID(),publishedBy:owner.id};
 await engine.query('INSERT INTO ls_fishing_billing.definitions VALUES($1,$2,$3,$4)',[workspace,definition.id,seal(JSON.stringify(definition),`ls_fishing_billing/v1/definition/${workspace}/${definition.id}`,ring),definition.publishedAt]);
 const offer=(lessons:string[])=>({version:ANCHORED_OFFER_V3,operationId:randomUUID(),id:randomUUID(),familyId:family.command.selection.familyId,definitionId:definition.id,override:null,
  children:family.command.selection.children.map((child,index)=>({lineId:randomUUID(),childId:child.nativeChildId,periodId:randomUUID(),groupId,firstEligibleLessonId:lessons[index]!,expectedLessonRevision:1,dueAt:'2035-01-20T21:00:00Z'}))});
 return {db,workspace,owner,parent,family,groupId,source,command,group,lesson,progression,billing,offer};
}
