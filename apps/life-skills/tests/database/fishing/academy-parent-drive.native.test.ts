/** Actual disposable native SQL/AEAD/family/session reads. Synthetic people and
 * provenance only; no HTTP mount, credit grant, provider or production proof. */
import {createHash,randomUUID} from 'node:crypto';
import {expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {academyFamilyFixture as fixture} from './academy-family-fixture.ts';
import {academyFamilyVersion,academyFamilyCommandSchema,academyFamilySavedSchema,type AcademyFamilyCommand} from '../../../src/features/fishing/academy-family-contract.ts';
import {PublicGroupApplicationStore} from '../../../src/features/group-application/store.ts';
import {floridaGroupApplicationNotice,floridaParentApplicationFieldsSchema} from '../../../src/features/group-application/contract.ts';
import {ACADEMY_INTAKE_VERSION,academyDriveMinutes,type AcademyDriveLimit} from '../../../src/features/group-application/academy-intake.ts';
import {ACADEMY_REGISTRATION_VERSION,registrationConsent} from '../../../src/features/group-application/academy-registration.ts';
import {academyRegistrationNotice} from '../../../src/features/group-application/academy-registration-notice.ts';
import {seal,unseal} from '../../../src/features/identity/crypto.ts';
import {asId} from '../../../src/lib/ids.ts';
import type {Actor} from '../../../src/features/identity/types.ts';

type F=Awaited<ReturnType<typeof fixture>>;
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const legacyFields=(driveLimit:AcademyDriveLimit,childCount=1)=>({parentName:'Synthetic private guardian',contact:'+13055550182',language:'en' as const,cityArea:'Synthetic Florida',programId:'sunday_fishing_academy' as const,scheduleContext:'program_format_interest' as const,schedulePreference:['sunday' as const],
 academyFit:{version:'RM-FIT-20261014-04-v1' as const,learners:Array.from({length:childCount},()=>({approximateAge:12,gear:'needs_advice' as const,experience:'new' as const})),...(academyDriveMinutes(driveLimit)===undefined?{}:{maximumDriveMinutes:academyDriveMinutes(driveLimit)}),parentDropoff:'yes' as const},
 academyIntake:{version:ACADEMY_INTAKE_VERSION,postalCode:'33004',driveLimit,preferredGroupLanguage:'en' as const,stagePreference:'foundation' as const,keysTravel:'parent_drive' as const,offshoreInterest:'not_interested' as const,nextStep:'enrollment_followup' as const,learners:Array.from({length:childCount},()=>({ageYears:12,gradeBand:'grade_6_8' as const,schooling:'school' as const,tackleBox:'need_advice' as const}))},permission:{confirmed:true as const,version:floridaGroupApplicationNotice.version,language:'en' as const}});
const namedFields=()=>({parentName:'Synthetic private named guardian',contact:'+13055550183',language:'en' as const,cityArea:'Synthetic Florida',programId:'sunday_fishing_academy' as const,schedulePreference:[],permission:{confirmed:true as const,version:academyRegistrationNotice.version,language:'en' as const},academyRegistration:{version:ACADEMY_REGISTRATION_VERSION,learners:[0,1].map(i=>({id:randomUUID(),fullName:'Synthetic child '+i,ageYears:12,grade:'6' as const,schooling:'school' as const,experience:'new' as const})),postalCode:'33004',driveMinutes:37,preferredDays:['sunday' as const],preferredTimes:['morning' as const],schoolHoursAvailability:'outside_school_only' as const,preferredGroupLanguage:'en' as const,stageInterest:'foundation' as const,intent:'information' as const,consent:registrationConsent('en')}});
async function activate(f:F,saved:ReturnType<typeof academyFamilySavedSchema.parse>,email:string){
 const rows=await f.pool.query("SELECT id,payload_ciphertext FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1 AND account_id=$2 AND kind='invite'",[f.workspaceId,saved.parentAccountId]);expect(rows.rows).toHaveLength(1);const row=rows.rows[0],payload=JSON.parse(unseal(row.payload_ciphertext,`auth-mail:${f.workspaceId}:${row.id}`,f.ring));
 await f.auth.consumePasswordToken('invite',payload.token,'Ab12cd',randomUUID());const token=await f.passwordLogin(email);return {token,actor:await f.sessions.actor(token)};
}
async function setup(named=false,drive:AcademyDriveLimit=30){
 const f=await fixture(),fields=floridaParentApplicationFieldsSchema.parse(named?namedFields():legacyFields(drive)),application=await f.inquiries.submit({operationId:randomUUID(),fields});await f.promote(application.item.id);
 const original=await f.command(application.item.id),command:AcademyFamilyCommand={...original,children:fields.academyRegistration?fields.academyRegistration.learners.map((c,learnerIndex)=>({learnerIndex,displayName:c.fullName,existingLearnerId:null,registrationChildId:c.id})):original.children};
 const response=await f.post(command);expect(response.status).toBe(200);const saved=academyFamilySavedSchema.parse((await response.json()).data.saved),parent=await activate(f,saved,command.parentEmail);return {f,fields,command,saved,parent};
}
const read=(f:F,parent:Actor,learnerId:string,store=f.inquiries)=>f.db.transaction(tx=>store.readAcademyParentDriveInTransaction(tx,parent,learnerId));

test('actual named registration returns exact37 and only the selected native child binding; reconstruction and owner boundary preserve history and effects',async()=>{
 const {f,fields,command,saved,parent}=await setup(true),before=await f.protectedState(),first=await read(f,parent.actor,saved.children[0]!.learnerId),second=await read(f,parent.actor,saved.children[1]!.learnerId);
 expect(first).toEqual({workspaceId:f.workspaceId,applicationId:command.applicationId,fieldsDigest:command.expectedFieldsDigest,learnerIndex:0,learnerId:saved.children[0]!.learnerId,householdId:saved.householdId,parentAccountId:saved.parentAccountId,registrationChildId:saved.children[0]!.registrationChildId,familyReceipt:{actorId:f.owner.id,operationId:command.operationId,requestDigest:hash(academyFamilyCommandSchema.parse(command))},sourceVersion:ACADEMY_REGISTRATION_VERSION,recordedDriveLimit:37,maximumOneWayMinutes:37,drivePreferenceDigest:hash({sourceVersion:ACADEMY_REGISTRATION_VERSION,recordedDriveLimit:37})});
 expect(second.learnerId).toBe(saved.children[1]!.learnerId);expect(second.learnerIndex).toBe(1);expect(second.registrationChildId).toBe(fields.academyRegistration!.learners[1]!.id);
 const serialized=JSON.stringify(first);for(const privateValue of [fields.parentName,fields.contact,...fields.academyRegistration!.learners.map(c=>c.fullName),command.verificationReference,saved.children[1]!.learnerId,command.parentEmail])expect(serialized).not.toContain(privateValue);
 const reconstructed=new PublicGroupApplicationStore(f.db,f.workspaceId,f.ring,f.config.lookupKey.toString('hex'));expect(await read(f,parent.actor,first.learnerId,reconstructed)).toEqual(first);expect(await f.protectedState()).toEqual(before);
 expect((await f.get(command.applicationId,parent.token)).status).toBe(403);await expect(read(f,f.owner,first.learnerId)).rejects.toMatchObject({code:'FORBIDDEN'});
 const counts=(await f.pool.query("SELECT (SELECT count(*)::int FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND action='academy.family.setup') AS receipts,(SELECT count(*)::int FROM ls_identity.auth_mail_outbox WHERE workspace_id=$1 AND kind='invite') AS invitations",[f.workspaceId])).rows[0];expect(counts).toEqual({receipts:1,invitations:1});
});
test.each([['up_to_30',30],['up_to_45',45],['up_to_60',60],['over_60',null],[30,30]] as const)('legacy recorded preference %s remains exact with maximum %s; over60 never becomes an invented limit',async(limit,maximum)=>{
 const {f,saved,parent}=await setup(false,limit),before=await f.protectedState(),result=await read(f,parent.actor,saved.children[0]!.learnerId);expect(result).toMatchObject({sourceVersion:ACADEMY_INTAKE_VERSION,recordedDriveLimit:limit,maximumOneWayMinutes:maximum});expect(await f.protectedState()).toEqual(before);
});
test('two real saved inquiries reusing the same child and household are ambiguous even when their recorded limits agree',async()=>{
 const {f,saved,parent}=await setup(),next=await f.inquiry('Synthetic follow-up inquiry'),base=await f.command(next),command:AcademyFamilyCommand={...base,householdId:saved.householdId,children:saved.children.map(child=>({learnerIndex:child.learnerIndex,displayName:child.displayName,existingLearnerId:child.learnerId}))};
 expect((await f.post(command)).status).toBe(200);const before=await f.protectedState();await expect(read(f,parent.actor,saved.children[0]!.learnerId)).rejects.toMatchObject({code:'CONFLICT'});expect(await f.protectedState()).toEqual(before);
});
test('actual cross-family, wrong workspace and revoked guardian reads deny before disclosing a driving preference',async()=>{
 const {f,saved,parent}=await setup(),learner=saved.children[0]!.learnerId,other=await f.account('parent');await expect(read(f,other,learner)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(read(f,{...parent.actor,workspaceId:asId(randomUUID(),'workspace')},learner)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(read(f,parent.actor,'not-a-child')).rejects.toMatchObject({code:'INVALID_REQUEST'});
 await f.pool.query('UPDATE ls_education.guardian_authorities SET active=false WHERE workspace_id=$1 AND account_id=$2 AND learner_id=$3',[f.workspaceId,parent.actor.id,learner]);const before=await f.protectedState();await expect(read(f,parent.actor,learner)).rejects.toMatchObject({code:'NOT_FOUND'});expect(await f.protectedState()).toEqual(before);
});
test.each(['session','email','membership'] as const)('current %s is required on every read, despite a valid saved family receipt',async(kind)=>{
 const {f,saved,parent}=await setup(),learner=saved.children[0]!.learnerId;await read(f,parent.actor,learner);
 if(kind==='session')await f.auth.logout(parent.actor,randomUUID());
 else if(kind==='email')await f.pool.query("UPDATE ls_identity.accounts SET email_verified_at=clock_timestamp()+interval '1 day' WHERE workspace_id=$1 AND id=$2",[f.workspaceId,parent.actor.id]);
 else await f.pool.query("DELETE FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND person_id=$3 AND role='parent'",[f.workspaceId,saved.householdId,parent.actor.personId]);
 await expect(read(f,parent.actor,learner)).rejects.toMatchObject({code:kind==='membership'?'FORBIDDEN':'UNAUTHENTICATED'});
});

/** Negative integrity fixtures append deliberately malformed synthetic input.
 * They never disable immutable triggers or change an existing historical row. */
async function malformed(kind:'command_digest'|'receipt_aad'|'fields_digest'|'inquiry_digest'|'child_mapping'){
 const f=await fixture(),family=await f.family(),fields=floridaParentApplicationFieldsSchema.parse(legacyFields(30)),submitted=await f.inquiries.submit({operationId:randomUUID(),fields});let applicationId=submitted.item.id;
 if(kind==='inquiry_digest'){
  applicationId=randomUUID();await f.pool.query('INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())',[f.workspaceId,applicationId,'f'.repeat(64),'0'.repeat(64),seal(JSON.stringify(fields),`ls_service_interest/public_application/v1/${f.workspaceId}/${applicationId}`,f.ring),fields.permission.version,'en']);
 }
 const operationId=randomUUID(),command:AcademyFamilyCommand={version:academyFamilyVersion,operationId,applicationId,expectedFieldsDigest:kind==='fields_digest'?'0'.repeat(64):hash(fields),personId:family.parent.personId,expectedEpoch:3,expectedAssociationVersion:1,parentEmail:family.parent.id+'@example.invalid',locale:'en',householdId:family.householdId,guardianVerified:true,verificationReference:'SYNTHETIC_INTEGRITY_ONLY',children:[{learnerIndex:0,displayName:'Synthetic mapped learner',existingLearnerId:family.learnerId}]};
 const saved=academyFamilySavedSchema.parse({version:academyFamilyVersion,applicationId,personId:family.parent.personId,parentAccountId:family.parent.id,householdId:family.householdId,parentState:'active',invitation:'existing_account',children:[{learnerIndex:kind==='child_mapping'?1:0,learnerId:family.learnerId,displayName:'Synthetic mapped learner'}],enrollmentCreated:false});
 const digest=kind==='command_digest'?'0'.repeat(64):hash(command),ciphertext=seal(JSON.stringify({saved,command}),`academy-family:v1:${f.workspaceId}:${kind==='receipt_aad'?randomUUID():f.owner.id}:${operationId}:${digest}`,f.ring);
 await f.pool.query("INSERT INTO ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id,action,request_sha256,result_ciphertext,recorded_at) VALUES($1,$2,$3,'academy.family.setup',$4,$5,clock_timestamp())",[f.workspaceId,f.owner.id,operationId,digest,ciphertext]);return {f,family};
}
test.each(['command_digest','receipt_aad','fields_digest','inquiry_digest','child_mapping'] as const)('native encrypted provenance rejects %s without repairing or rewriting saved input',async(kind)=>{
 const {f,family}=await malformed(kind),before=await f.protectedState();await expect(read(f,family.parent,family.learnerId)).rejects.toMatchObject({code:kind==='fields_digest'||kind==='child_mapping'?'CONFLICT':'UNAVAILABLE'});expect(await f.protectedState()).toEqual(before);
 const snapshot=(await f.pool.query('SELECT request_digest,payload_ciphertext FROM ls_service_interest.public_applications WHERE workspace_id=$1 ORDER BY id',[f.workspaceId])).rows;
 await expect(f.pool.query("UPDATE ls_service_interest.public_applications SET request_digest=$2 WHERE workspace_id=$1",[f.workspaceId,'a'.repeat(64)])).rejects.toMatchObject({code:'23514'});expect((await f.pool.query('SELECT request_digest,payload_ciphertext FROM ls_service_interest.public_applications WHERE workspace_id=$1 ORDER BY id',[f.workspaceId])).rows).toEqual(snapshot);
});
