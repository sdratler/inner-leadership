import {afterAll,expect,test,vi} from "vitest";
import {randomUUID} from "node:crypto";
vi.mock("server-only",()=>({}));
import {fixture,poolStore,type Fixture} from "../calendar/fixture.ts";
import {ContactCutoverStore,type CutoverEvidence} from "../../../src/features/contact-ops/server/cutover-store.ts";
import {OperationalNativeCrmStore} from "../../../src/features/contact-ops/server/operational-store.ts";
import {NativeCrmStore,type CrmProfile} from "../../../src/features/contact-ops/server/native-store.ts";
import {AudienceInterestStore} from "../../../src/features/contact-ops/server/audience-interest-store.ts";
import {audienceInterestCandidateSql} from "../../../src/features/contact-ops/server/audience-interest-candidate-schema.ts";
import {seal} from "../../../src/features/identity/crypto.ts";

const fixtures:Fixture[]=[],key="synthetic-audience-integrity-only";
afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
const proof=(epoch:number,writes=0):CutoverEvidence=>({batchId:"synthetic-audience",sourceFileId:"synthetic-sheet",sourceRevision:"synthetic-revision",expectedEpoch:epoch,observedNativeWritesSinceSwitch:writes,backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true});
async function setup(options:{demoFirst?:boolean}={}){const f=await fixture(options);fixtures.push(f);await f.pool.query(audienceInterestCandidateSql);const db=poolStore(f.pool),authority=new ContactCutoverStore(db,f.keyring,key),crm=new OperationalNativeCrmStore(db,f.keyring,key),audience=new AudienceInterestStore(db,f.keyring,key);for(const [epoch,action] of (["prepare","freeze","switch_native"] as const).entries())await authority.advance(f.practitioner.actor,{action,proof:proof(epoch),operationId:"audience-"+action});return {f,db,authority,crm,audience};}
const command=(patch:Record<string,unknown>={})=>({action:"record_interest" as const,topic:"bna_content" as const,state:"expressed" as const,operationId:randomUUID(),expectedEpoch:3,expectedVersion:null,displayName:"Synthetic content reader",phone:"+972520001111",observedAt:"2026-10-08T10:00:00.000Z",sourceRef:"Synthetic owner observation",observation:{kind:"article_request" as const,evidence:"Synthetic article request"},...patch});

test("existing sales lead gains BNA interest without changing sales, callback, notes or suppression fields",async()=>{
 const s=await setup(),actor=s.f.practitioner.actor,created=await s.crm.createContact(actor,{name:"Existing synthetic lead",phone:"+972520001111",language:"he",source:"Synthetic owner entry",notes:"Preserved sales note",nextAction:"Preserved callback",dueDate:"2026-10-12"},randomUUID(),3);
 const before=await s.crm.read(actor,created.personId,3),result=await s.audience.record(actor,command());
 expect(result).toMatchObject({personId:created.personId,version:1,replayed:false});expect(await s.crm.read(actor,created.personId,3)).toEqual(before);
 const list=await s.audience.list(actor,{expectedEpoch:3,search:"Existing",state:"all",page:1,pageSize:25});expect(list.items[0]).toMatchObject({personId:created.personId,state:"expressed",messagingPermission:"unknown",outboundEligible:false});
 expect((await s.crm.list(actor,{view:"prospects",search:"",today:"2026-10-08",page:1,pageSize:25},3)).items[0]).toMatchObject({notes:"Preserved sales note",nextAction:"Preserved callback",followUpDate:"2026-10-12"});
});

test("new content-only reader creates no lead, CRM profile, enrollment, account, case or provider fact",async()=>{
 const s=await setup(),actor=s.f.practitioner.actor,before=await Promise.all(["ls_contact_ops.profiles","ls_contact_ops.legacy_links","ls_identity.accounts","ls_cases.cases","ls_onboarding.prospect_journeys"].map(async table=>(await s.f.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id=$1`,[s.f.workspaceId])).rows[0].n));
 const saved=await s.audience.record(actor,command({phone:"+972520001112",displayName:"Audience only reader"}));
 const after=await Promise.all(["ls_contact_ops.profiles","ls_contact_ops.legacy_links","ls_identity.accounts","ls_cases.cases","ls_onboarding.prospect_journeys"].map(async table=>(await s.f.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id=$1`,[s.f.workspaceId])).rows[0].n));
 expect(after).toEqual(before);expect((await s.audience.list(actor,{expectedEpoch:3,search:"Audience only",state:"expressed",page:1,pageSize:25})).items[0]?.personId).toBe(saved.personId);
 expect((await s.crm.list(actor,{view:"prospects",search:"",today:"2026-10-08",page:1,pageSize:25},3)).items.some(row=>row.personId===saved.personId)).toBe(false);
});

test("group observation and do-not-contact remain distinct from interest and unknown messaging permission",async()=>{
 const s=await setup(),actor=s.f.practitioner.actor,created=await s.crm.createContact(actor,{name:"Suppressed content reader",phone:"+972520001113",language:"en",source:"Synthetic",notes:"Keep note",nextAction:"",dueDate:""},randomUUID(),3);
 const current=(await s.crm.read(actor,created.personId,3))!;await s.crm.update(actor,{...current.profile,stage:"Do not contact",doNotContact:true},current.version,randomUUID(),3);
 await s.audience.record(actor,command({phone:"+972520001113",displayName:"Suppressed content reader",observation:{kind:"group_membership",evidence:"Observed in allowed synthetic group"}}));
 const row=(await s.audience.list(actor,{expectedEpoch:3,search:"Suppressed",state:"all",page:1,pageSize:25})).items[0]!;
 expect(row).toMatchObject({state:"expressed",doNotContact:true,messagingPermission:"unknown",outboundEligible:false,observations:[{kind:"group_membership"}]});
});

test("exact replay is stable while stale version, stale authority and changed reuse fail closed",async()=>{
 const s=await setup(),actor=s.f.practitioner.actor,first=command({phone:"+972520001114"});const saved=await s.audience.record(actor,first);
 expect(await s.audience.record(actor,first)).toMatchObject({personId:saved.personId,version:1,replayed:true});
 const second=command({personId:saved.personId,phone:"+972520001114",displayName:undefined,expectedVersion:1,state:"withdrawn",observation:undefined});expect(await s.audience.record(actor,second)).toMatchObject({version:2,replayed:false});
 expect((await s.audience.list(actor,{expectedEpoch:3,search:"",state:"withdrawn",page:1,pageSize:25})).items.map(row=>row.personId)).toContain(saved.personId);
 expect((await s.audience.list(actor,{expectedEpoch:3,search:"",state:"expressed",page:1,pageSize:25})).items.map(row=>row.personId)).not.toContain(saved.personId);
 await expect(s.audience.record(actor,command({personId:saved.personId,phone:"+972520001114",displayName:undefined,expectedVersion:1,state:"expressed",observation:undefined}))).rejects.toThrow("CONFLICT");
 await expect(s.audience.record(actor,{...first,state:"withdrawn"})).rejects.toThrow("CONFLICT");
 await expect(s.audience.record(actor,command({expectedEpoch:2,phone:"+972520001115"}))).rejects.toThrow("CONFLICT");
});

test("ambiguous, shared, cross-workspace, demo and unprivileged identity claims are rejected",async()=>{
 const s=await setup(),actor=s.f.practitioner.actor,phone="+972520001116";
 const createDuplicate=async(name:string)=>{const personId=randomUUID();await s.f.pool.query(`INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,$4)`,[personId,s.f.workspaceId,seal(JSON.stringify({displayName:name}),`person:${s.f.workspaceId}:${personId}`,s.f.keyring),new Date()]);const profile:CrmProfile={personId,stage:"New inquiry",nextAction:null,followUpDate:null,notes:"Synthetic",legacyIds:[],nativeInquiry:{origin:"native_manual",leadId:"LS-LEAD-native-"+personId,phone,language:"en",source:"Synthetic",createdAt:"2026-10-08T09:00:00.000Z"}};await new NativeCrmStore(s.db,s.f.keyring,key).create(actor,profile,randomUUID());};
 await createDuplicate("Ambiguous A");await createDuplicate("Ambiguous B");await expect(s.audience.record(actor,command({phone}))).rejects.toThrow("CONFLICT");
 const sharedPhone="+972520001117";await s.f.pool.query(`UPDATE ls_identity.accounts SET phone_ciphertext=$3 WHERE workspace_id=$1 AND id=$2`,[s.f.workspaceId,s.f.parent.actor.id,seal(sharedPhone,`phone:${s.f.workspaceId}:${s.f.parent.actor.id}`,s.f.keyring)]);await expect(s.audience.record(actor,command({phone:sharedPhone}))).rejects.toThrow("CONFLICT");
 const other=await fixture();fixtures.push(other);await expect(s.audience.record(actor,command({personId:other.parent.actor.personId,phone:"+972520001118",displayName:undefined}))).rejects.toThrow("NOT_FOUND");
 const demo=await setup({demoFirst:true});await expect(demo.audience.record(demo.f.practitioner.actor,command({personId:demo.f.parent.actor.personId,phone:"+972520001119",displayName:undefined}))).rejects.toThrow("FORBIDDEN");
 await expect(s.audience.record(s.f.parent.actor,command({phone:"+972520001120"}))).rejects.toThrow("FORBIDDEN");
});

test("provider label or list echo is observation only and cannot grant interest, qualification, permission or sends",async()=>{
 const s=await setup(),actor=s.f.practitioner.actor,observation=command({action:"record_observation",phone:"+972520001121",displayName:"Observed only",observation:{kind:"provider_label",evidence:"Synthetic provider echo"}});delete (observation as {state?:unknown}).state;
 const saved=await s.audience.record(actor,observation),row=(await s.audience.list(actor,{expectedEpoch:3,search:"Observed only",state:"all",page:1,pageSize:25})).items[0]!;
 expect(saved.version).toBe(0);expect(row).toMatchObject({state:null,version:0,messagingPermission:"unknown",outboundEligible:false,observations:[{kind:"provider_label"}]});
 expect((await s.f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.profiles WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].n).toBe(0);
 expect((await s.f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.audience_interests WHERE workspace_id=$1",[s.f.workspaceId])).rows[0].n).toBe(0);
});
