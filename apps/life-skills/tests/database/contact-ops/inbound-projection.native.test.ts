import {afterAll,expect,test,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
vi.mock('server-only',()=>({}));
import {fixture,poolStore,type Fixture} from '../calendar/fixture.ts';
import type {IdentityStore} from '../../../src/features/identity/store.ts';
import {seal} from '../../../src/features/identity/crypto.ts';
import {ContactInboundStore,inboundBindingDigest} from '../../../src/features/contact-ops/server/inbound-store.ts';
import {ContactCutoverStore,type CutoverEvidence} from '../../../src/features/contact-ops/server/cutover-store.ts';
import {OperationalNativeCrmStore} from '../../../src/features/contact-ops/server/operational-store.ts';
import {NativeCrmStore,crmProfileAad} from '../../../src/features/contact-ops/server/native-store.ts';
import {AcquisitionCandidateStore} from '../../../src/features/contact-ops/server/acquisition-store.ts';
const fixtures:Fixture[]=[];afterAll(async()=>{for(const f of fixtures)await f.pool.end();});
const key='synthetic-inbound-projection-integrity-20260929';
const inquiry={provider:'whapi' as const,channelId:'synthetic-projection-channel',businessNumber:'+972501234567',
 providerEventId:'synthetic-event-1',providerMessageId:'synthetic-message-1',providerThreadId:'synthetic-thread-1',
 eventType:'inbound_message' as const,fromMe:false as const,fromNumber:'+972501234568',pushName:'Synthetic inquiry',
 messageType:'text',messageText:'Synthetic incoming inquiry',occurredAt:'2026-09-28T02:00:00Z',media:[],
 // Explicit provider-attributed fixture; organic/unknown denial is separately
 // exercised against this same retained native implementation below.
 ctwaAttribution:{clickId:'synthetic-provider-click',adId:'synthetic-provider-ad',attributed:true as const,sourceType:'ad' as const}};
// These proof booleans are isolated fixtures, NOT evidence of a live switch.
const proof=(epoch:number,writes=0):CutoverEvidence=>({batchId:'synthetic-projection-batch',sourceFileId:'synthetic-workbook',
 sourceRevision:'synthetic-frozen-revision',expectedEpoch:epoch,observedNativeWritesSinceSwitch:writes,
 backupRestored:true,snapshotMatched:true,imported:true,rowContentMatched:true,allRowsAccounted:true,identityConflicts:0,
 paymentsReconciled:true,writersFenced:true,inboundDurable:true,deltaDrained:true,consumersRepointed:true,
 sheetConsumersRepointed:true,nativeBrowserVerified:true,oldSchedulesDisabled:true,sourceFrozen:true,restorePlanReady:true});
async function setup(options:{demoFirst?:boolean}={}){
 const f=await fixture(options);fixtures.push(f);const db=poolStore(f.pool),actor=f.practitioner.actor;
 const authority=new ContactCutoverStore(db,f.keyring,key),crm=new OperationalNativeCrmStore(db,f.keyring,key);
 const store=new ContactInboundStore(db,f.workspaceId,f.keyring,key,inboundBindingDigest(inquiry));
 async function prepare(){await authority.advance(actor,{action:'prepare',proof:proof(0),operationId:'prepare'});
  await authority.advance(actor,{action:'freeze',proof:proof(1),operationId:'freeze'});}
 async function activate(){await prepare();await authority.advance(actor,{action:'switch_native',proof:proof(2),operationId:'activate'});}
 const list=()=>crm.list(actor,{view:'prospects',search:'',today:'2026-09-29',page:1,pageSize:100},3);
 const count=async(table:string)=>(await f.pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE workspace_id=$1`,[f.workspaceId])).rows[0].n;
 return {f,db,actor,authority,crm,store,prepare,activate,list,count};
}
test('first inquiry -> one native person/Today follow-up; second/replay preserves notes and one identity',async()=>{
 const {f,actor,authority,crm,store,activate,list,count}=await setup();await activate();
 const people=await count('ls_identity.people'),accounts=await count('ls_identity.accounts'),cases=await count('ls_cases.cases');
 expect((await store.capture(inquiry)).replayed).toBe(false);
 const first=(await list()).items[0]!;expect((await list()).total).toBe(1);
 expect(first.references[0]).toMatchObject({source:'WhatsApp',nativeOrigin:'native_whatsapp',sourceFileId:null,sourceSheetId:null,sourceRevision:null});
 expect(first.nextAction).toBe('Respond to inbound WhatsApp inquiry');
 expect(first.followUpDate).toBe(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(new Date()));
 expect(first.inboundActivity).toMatchObject({messageCount:1,firstInboundAt:'2026-09-28T02:00:00.000Z'});
 const leadId=first.references[0]!.leadId;
 await crm.updateProspectFields(actor,leadId,{notes:'Authored original note\nKeep both paragraphs',nextAction:'Practitioner-selected next step',dueDate:'2026-10-01'},first.version!,randomUUID(),3);
 const second={...inquiry,providerEventId:'synthetic-event-2',providerMessageId:'synthetic-message-2',messageText:'Second actual synthetic message',occurredAt:'2026-09-28T03:00:00Z'};
 await store.capture(second);await store.capture(second);
 await store.capture({...second,providerEventId:'same-message-different-event',pushName:'Changed provider display name'});
 const after=(await list()).items[0]!;expect(after.personId).toBe(first.personId);expect(after.notes).toBe('Authored original note\nKeep both paragraphs');
 expect(after.nextAction).toBe('Practitioner-selected next step');expect(after.followUpDate).toBe('2026-10-01');expect(after.inboundActivity?.messageCount).toBe(2);
 expect(await count('ls_contact_ops.inbound_projections')).toBe(2);expect(await count('ls_contact_ops.message_receipts')).toBe(3);
 expect(await count('ls_identity.people')).toBe(people+1);expect(await count('ls_identity.accounts')).toBe(accounts);expect(await count('ls_cases.cases')).toBe(cases);
 expect((await authority.read(actor)).nativeWritesSinceSwitch).toBe(3); // 2 messages + 1 authored edit, never replays
 const prospects=await crm.prospects(actor,3);expect(prospects).toHaveLength(1);
 expect(prospects[0]).toMatchObject({leadId,notes:after.notes,lastContact:'2026-09-28T03:00:00.000Z',lastInboundAt:'2026-09-28T03:00:00.000Z',paymentVerified:false,bookingConfirmed:false,caseId:''});
 await expect(store.capture({...second,providerEventId:'conflicting-message-new-event',messageText:'Changed content under same message ID'})).rejects.toThrow('CONFLICT');
 expect(await count('ls_contact_ops.message_receipts')).toBe(3);expect((await list()).items[0]?.inboundActivity?.messageCount).toBe(2);
 await expect(store.recent(f.parent.actor)).rejects.toThrow('FORBIDDEN');
});

test('unknown shared-number messages persist metadata candidates, not active leads, identities, tasks or clinical data',async()=>{
 const {f,db,actor,authority,store,activate,list,count}=await setup();await activate();
 const {ctwaAttribution:_ad,...organic}=inquiry;void _ad;
 const before=await Promise.all(['ls_identity.people','ls_identity.accounts','ls_cases.cases','ls_calendar.tasks'].map(count));
 const candidates=new AcquisitionCandidateStore(db,f.keyring,key);
 await Promise.all(Array.from({length:6},()=>store.capture({...organic,messageText:'Synthetic private body must not enter acquisition metadata'})));
 await store.capture({...organic,providerEventId:'organic-redelivery',messageText:'Synthetic private body must not enter acquisition metadata',pushName:'Changed provider display name'});
 expect(await count('ls_contact_ops.message_receipts')).toBe(2);
 expect(await count('ls_contact_ops.inbound_activity_candidates')).toBe(1);
 expect(await count('ls_contact_ops.inbound_projections')).toBe(0);expect((await list()).total).toBe(0);
 expect(await Promise.all(['ls_identity.people','ls_identity.accounts','ls_cases.cases','ls_calendar.tasks'].map(count))).toEqual(before);
 const saved=await candidates.recent(actor);expect(saved.hasMore).toBe(false);expect(saved.items).toHaveLength(1);
 expect(saved.items[0]).toMatchObject({source:'organic_whatsapp',phone:organic.fromNumber,displayName:organic.pushName,state:'NEEDS_REVIEW'});
 expect(JSON.stringify(saved)).not.toContain('private body');expect(Object.keys(saved.items[0]!).sort()).toEqual(['id','source','phone','displayName','occurredAt','state'].sort());
 expect((await authority.read(actor)).nativeWritesSinceSwitch).toBe(1);
 await expect(store.capture({...organic,providerEventId:'organic-changed-replay',messageText:'Changed content'})).rejects.toThrow('CONFLICT');
 expect(await count('ls_contact_ops.message_receipts')).toBe(2);
 await expect(candidates.recent(f.parent.actor)).rejects.toThrow('FORBIDDEN');
 await expect(candidates.recent(f.parentTwo.actor)).rejects.toThrow('FORBIDDEN');
 await expect(candidates.recent({...actor,workspaceId:randomUUID() as typeof actor.workspaceId})).rejects.toThrow();
 await f.pool.query('UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1',[actor.sessionDigest]);
 await expect(candidates.recent(actor)).rejects.toThrow('UNAUTHENTICATED');
});

test('organic frozen receipts drain once to Needs review and never silently create a prospect',async()=>{
 const {f,db,actor,authority,store,prepare,list,count}=await setup();const {ctwaAttribution:_ad,...organic}=inquiry;void _ad;
 await store.capture(organic);await prepare();expect(await count('ls_contact_ops.inbound_activity_candidates')).toBe(0);
 await authority.advance(actor,{action:'switch_native',proof:proof(2),operationId:'activate'});
 expect(await store.drain(actor,3)).toMatchObject({processed:1,projected:0,needsResolution:0,needsReview:1,replayed:0});
 expect(await store.drain(actor,3)).toMatchObject({processed:1,projected:0,needsResolution:0,needsReview:0,replayed:1});
 expect((await list()).total).toBe(0);expect((await new AcquisitionCandidateStore(db,f.keyring,key).recent(actor)).items).toHaveLength(1);
 expect((await authority.read(actor)).nativeWritesSinceSwitch).toBe(1);
});

test('candidate transaction failure preserves no half receipt or candidate; original metadata remains append-only and encrypted',async()=>{
 const {f,db,actor,authority,store,activate,count}=await setup();await activate();const {ctwaAttribution:_ad,...organic}=inquiry;void _ad;
 const failing:IdentityStore={transaction:work=>db.transaction(async tx=>{await work(tx);throw Error('SYNTHETIC_CANDIDATE_COMMIT_FAILURE');})};
 await expect(new ContactInboundStore(failing,f.workspaceId,f.keyring,key,inboundBindingDigest(organic)).capture(organic)).rejects.toThrow('SYNTHETIC_CANDIDATE_COMMIT_FAILURE');
 expect(await count('ls_contact_ops.message_receipts')).toBe(0);expect(await count('ls_contact_ops.inbound_activity_candidates')).toBe(0);
 expect((await authority.read(actor)).nativeWritesSinceSwitch).toBe(0);await store.capture(organic);
 const row=(await f.pool.query('SELECT metadata_ciphertext FROM ls_contact_ops.inbound_activity_candidates WHERE workspace_id=$1',[f.workspaceId])).rows[0];
 expect(row.metadata_ciphertext).not.toContain(organic.fromNumber);expect(row.metadata_ciphertext).not.toContain(organic.pushName);
 await expect(f.pool.query("UPDATE ls_contact_ops.inbound_activity_candidates SET metadata_ciphertext='changed' WHERE workspace_id=$1",[f.workspaceId])).rejects.toMatchObject({code:'23514'});
 await expect(f.pool.query('DELETE FROM ls_contact_ops.inbound_activity_candidates WHERE workspace_id=$1',[f.workspaceId])).rejects.toMatchObject({code:'23514'});
 const role='synthetic_acq_denied_'+randomUUID().replaceAll('-','');
 await f.pool.query(`CREATE ROLE ${role} NOLOGIN`);
 try{await f.pool.query(`GRANT USAGE ON SCHEMA ls_contact_ops TO ${role}`);const client=await f.pool.connect();
  try{await client.query(`SET ROLE ${role}`);await expect(client.query('SELECT metadata_ciphertext FROM ls_contact_ops.inbound_activity_candidates')).rejects.toMatchObject({code:'42501'});}
  finally{await client.query('RESET ROLE');client.release();}}
 finally{await f.pool.query(`REVOKE USAGE ON SCHEMA ls_contact_ops FROM ${role}`);await f.pool.query(`DROP ROLE ${role}`);}
});
test('sheet/frozen receipts do not change CRM; exact native drain projects each message once',async()=>{
 const {actor,authority,store,prepare,list,count}=await setup();
 await store.capture(inquiry);expect(await count('ls_contact_ops.profiles')).toBe(0);await prepare();
 await store.capture({...inquiry,providerEventId:'frozen-second',providerMessageId:'frozen-second',occurredAt:'2026-09-28T03:00:00Z'});
 await expect(store.drain(actor,2)).rejects.toThrow('CONFLICT');expect(await count('ls_contact_ops.profiles')).toBe(0);
 await authority.advance(actor,{action:'switch_native',proof:proof(2),operationId:'activate'});
 await expect(store.drain(actor,2)).rejects.toThrow('CONFLICT');
 const first=await store.drain(actor,3,1);expect(first).toMatchObject({processed:1,projected:1,needsResolution:0,replayed:0,hasMore:true});
 expect(first.cursor?.storedAt).toMatch(/\.\d{6}Z$/);
 const second=await store.drain(actor,3,1,first.cursor);expect(second).toMatchObject({processed:1,projected:1,needsResolution:0,replayed:0,hasMore:false});
 expect(await store.drain(actor,3,1,second.cursor)).toEqual({processed:0,projected:0,needsResolution:0,needsReview:0,replayed:0,cursor:second.cursor,hasMore:false});
 expect(await store.drain(actor,3)).toMatchObject({processed:2,projected:0,needsResolution:0,replayed:2});
 expect((await list()).total).toBe(1);expect((await list()).items[0]?.inboundActivity?.messageCount).toBe(2);
 const drained=(await list()).items[0]!;
 expect(drained.references[0]?.nativeCreatedAt).toBe('2026-09-28T02:00:00.000Z');
 expect(drained.inboundActivity?.firstInboundAt).toBe('2026-09-28T02:00:00.000Z');
 expect((await authority.read(actor)).nativeWritesSinceSwitch).toBe(2);
});
test.each([1,50])('drain preflights conflicting frozen envelopes before committing even with page size %i',async(limit)=>{
 const {store,prepare,authority,actor,count}=await setup();await store.capture(inquiry);await prepare();
 await store.capture({...inquiry,providerEventId:'frozen-conflicting-envelope',messageText:'Conflicting content under the same provider message ID'});
 await authority.advance(actor,{action:'switch_native',proof:proof(2),operationId:'activate'});
 await expect(store.drain(actor,3,limit)).rejects.toThrow('CONFLICT');
 expect(await count('ls_contact_ops.message_receipts')).toBe(2);expect(await count('ls_contact_ops.inbound_projections')).toBe(0);
 expect(await count('ls_contact_ops.profiles')).toBe(0);expect((await authority.read(actor)).nativeWritesSinceSwitch).toBe(0);
});
test('parallel replays/different event envelopes create one contact/projection and stable late-message chronology',async()=>{
 const {store,activate,list,count,actor,authority}=await setup();await activate();
 const result=await Promise.all(Array.from({length:8},()=>store.capture(inquiry)));expect(result.filter(r=>!r.replayed)).toHaveLength(1);
 await Promise.all(Array.from({length:6},(_,i)=>store.capture({...inquiry,providerEventId:'semantic-replay-'+i})));
 expect(await count('ls_contact_ops.inbound_projections')).toBe(1);expect((await list()).items[0]?.inboundActivity?.messageCount).toBe(1);
 await store.capture({...inquiry,providerEventId:'late-event',providerMessageId:'late-message',occurredAt:'2026-09-27T02:00:00Z'});
 expect((await list()).items[0]?.inboundActivity).toMatchObject({firstInboundAt:'2026-09-27T02:00:00.000Z',lastInboundAt:'2026-09-28T02:00:00.000Z',messageCount:2});
 expect((await authority.read(actor)).nativeWritesSinceSwitch).toBe(2);
});
test('commit failure rolls back receipt/person/thread/projection/counter, then exact retry succeeds',async()=>{
 const {f,db,store,activate,actor,authority,count}=await setup();await activate();const people=await count('ls_identity.people');
 const failing:IdentityStore={transaction:work=>db.transaction(async tx=>{await work(tx);throw Error('SYNTHETIC_PROJECTION_COMMIT_FAILURE');})};
 const failed=new ContactInboundStore(failing,f.workspaceId,f.keyring,key,inboundBindingDigest(inquiry));
 await expect(failed.capture(inquiry)).rejects.toThrow('SYNTHETIC_PROJECTION_COMMIT_FAILURE');
 for(const table of ['message_receipts','inbound_threads','inbound_projections','profiles'])expect(await count('ls_contact_ops.'+table)).toBe(0);
 expect(await count('ls_identity.people')).toBe(people);expect((await authority.read(actor)).nativeWritesSinceSwitch).toBe(0);
 expect((await store.capture(inquiry)).replayed).toBe(false);expect((await authority.read(actor)).nativeWritesSinceSwitch).toBe(1);
});
test('unverified/shared/inactive endpoints require resolution; a unique verified account routes admin data without clinical grants',async()=>{
 const {f,store,activate,list,count}=await setup();await activate();
 const phone=async(id:string,number:string,verified:boolean)=>f.pool.query('UPDATE ls_identity.accounts SET phone_ciphertext=$2,phone_verified_at=$3 WHERE id=$1',
  [id,seal(number,`phone:${f.workspaceId}:${id}`,f.keyring),verified?new Date():null]);
 await phone(f.parent.actor.id,inquiry.fromNumber,false);const people=await count('ls_identity.people'),cases=await count('ls_cases.cases');
 await store.capture(inquiry);expect((await list()).total).toBe(0);expect(await count('ls_identity.people')).toBe(people);
 expect((await f.pool.query('SELECT state,reason,person_id FROM ls_contact_ops.inbound_projections WHERE workspace_id=$1',[f.workspaceId])).rows[0]).toMatchObject({state:'needs_resolution',reason:'ambiguous_endpoint',person_id:null});
 await phone(f.parent.actor.id,'+972501234571',true);
 await store.capture({...inquiry,fromNumber:'+972501234571',providerEventId:'verified',providerMessageId:'verified',providerThreadId:'verified'});
 const matched=(await list()).items[0]!;expect(matched.personId).toBe(f.parent.actor.personId);expect(await count('ls_identity.people')).toBe(people);expect(await count('ls_cases.cases')).toBe(cases);
 await phone(f.parentTwo.actor.id,'+972501234571',true);
 await store.capture({...inquiry,fromNumber:'+972501234571',providerEventId:'shared',providerMessageId:'shared',providerThreadId:'shared'});
 await phone(f.outsider.actor.id,'+972501234572',true);await f.pool.query("UPDATE ls_identity.accounts SET state='revoked' WHERE id=$1",[f.outsider.actor.id]);
 await store.capture({...inquiry,fromNumber:'+972501234572',providerEventId:'inactive',providerMessageId:'inactive',providerThreadId:'inactive'});
 expect((await list()).total).toBe(1);expect(await count('ls_identity.people')).toBe(people);
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.inbound_projections WHERE workspace_id=$1 AND state='needs_resolution'",[f.workspaceId])).rows[0].n).toBe(3);
});
test('verified existing person gets a separate WhatsApp inquiry without smearing historical/manual reference activity',async()=>{
 const {f,db,actor,crm,store,activate,list,count}=await setup(),personId=f.parent.actor.personId!;
 const legacyIds=['LS-LEAD-preserved-reference-a','LS-LEAD-preserved-reference-b'];
 const manualId='LS-LEAD-native-'+personId;
 await new NativeCrmStore(db,f.keyring,key).create(actor,{personId,stage:'Contacted',nextAction:'Authored next action',
  followUpDate:'2026-10-01',notes:'Original authored notes — הערה שמורה',legacyIds,
  nativeInquiry:{origin:'native_manual',leadId:manualId,phone:'+972501234580',language:'en',
   source:'Synthetic manual inquiry',createdAt:'2026-09-20T00:00:00.000Z'}},randomUUID());
 for(const [i,leadId] of legacyIds.entries()){
  const sourceFields={'Lead ID':leadId,Phone:'+97250123458'+(i+2),'Last contact':'2026-09-10',
   'First inbound at':'2026-09-01','Last inbound at':'2026-09-02','Message receipt':'historical-'+i};
  const snapshot={sourceRow:i+2,payload:{displayName:'Synthetic historical inquiry',language:'en',stageText:'Contacted',sourceFields}};
  await f.pool.query(`INSERT INTO ls_contact_ops.legacy_links(workspace_id,source_file_id,source_sheet_id,source_tab_title,
   legacy_lead_id,person_id,source_revision,row_digest,snapshot_ciphertext) VALUES($1,'synthetic-reference-workbook',1,'Synthetic Leads',$2,$3,'preserved-revision',$4,$5)`,
   [f.workspaceId,leadId,personId,'a'.repeat(64),seal(JSON.stringify(snapshot),
    `ls_contact_ops/legacy/v1/${f.workspaceId}/synthetic-reference-workbook/1/${leadId}`,f.keyring)]);
 }
 await f.pool.query('UPDATE ls_identity.accounts SET phone_ciphertext=$2,phone_verified_at=clock_timestamp() WHERE id=$1',
  [f.parent.actor.id,seal(inquiry.fromNumber,`phone:${f.workspaceId}:${f.parent.actor.id}`,f.keyring)]);
 await activate();const people=await count('ls_identity.people'),cases=await count('ls_cases.cases');
 await store.capture(inquiry);await store.capture({...inquiry,providerEventId:'reference-second',providerMessageId:'reference-second',occurredAt:'2026-09-28T03:00:00Z'});
 const rows=await crm.prospects(actor,3);expect(rows).toHaveLength(4);
 for(const [i,leadId] of legacyIds.entries())expect(rows.find(r=>r.leadId===leadId)).toMatchObject({
  lastContact:'2026-09-10',firstInboundAt:'2026-09-01',lastInboundAt:'2026-09-02',messageReceipt:'historical-'+i});
 expect(rows.find(r=>r.leadId===manualId)).toMatchObject({receivedAt:'2026-09-20T00:00:00.000Z',lastContact:'',firstInboundAt:'',lastInboundAt:'',messageReceipt:''});
 const received=rows.find(r=>r.leadId==='LS-WAPI-native-'+personId)!;
 expect(received).toMatchObject({receivedAt:'2026-09-28T02:00:00.000Z',firstInboundAt:'2026-09-28T02:00:00.000Z',
  lastInboundAt:'2026-09-28T03:00:00.000Z',lastContact:'2026-09-28T03:00:00.000Z',notes:'Original authored notes — הערה שמורה',
  nextAction:'Authored next action',dueDate:'2026-10-01'});
 expect(received.messageReceipt).toMatch(/^[a-f0-9]{64}$/);
 expect((await list()).total).toBe(1);expect(await count('ls_identity.people')).toBe(people);expect(await count('ls_cases.cases')).toBe(cases);
 // A newly verified endpoint may not relabel this first immutable conversation.
 await f.pool.query('UPDATE ls_identity.accounts SET phone_ciphertext=$2,phone_verified_at=clock_timestamp() WHERE id=$1',
  [f.parent.actor.id,seal('+972501234578',`phone:${f.workspaceId}:${f.parent.actor.id}`,f.keyring)]);
 await store.capture({...inquiry,fromNumber:'+972501234578',providerEventId:'new-existing-endpoint',providerMessageId:'new-existing-endpoint',providerThreadId:'new-existing-thread'});
 expect((await list()).items[0]?.inboundActivity?.messageCount).toBe(2);
 expect((await f.pool.query("SELECT state,reason,person_id FROM ls_contact_ops.inbound_projections WHERE workspace_id=$1 AND state='needs_resolution'",[f.workspaceId])).rows).toEqual([
  {state:'needs_resolution',reason:'ambiguous_endpoint',person_id:null}]);
 expect((await crm.prospects(actor,3)).find(r=>r.leadId===received.leadId)).toMatchObject({phone:inquiry.fromNumber,notes:received.notes,lastInboundAt:received.lastInboundAt});
});
test('immutable imported Outcome/stage opt-outs remain review-only for first and subsequent inbound messages',async()=>{
 for(const restriction of [{outcome:'Do not contact — synthetic owner restriction',stage:'New inquiry'},
  {outcome:'Opted out',stage:'New inquiry'},{outcome:'',stage:'Do-not-contact'}]){
  const {f,db,actor,crm,store,activate,count}=await setup(),personId=f.parent.actor.personId!;
  const leadId='LS-LEAD-imported-opt-out';
  await new NativeCrmStore(db,f.keyring,key).create(actor,{personId,stage:'New inquiry',nextAction:null,
   followUpDate:null,notes:'Preserve imported administrative note — לא ליצור קשר',legacyIds:[leadId]},randomUUID());
  const snapshot={sourceRow:2,payload:{displayName:'Synthetic opted-out inquiry',language:'en',stageText:restriction.stage,
   sourceFields:{'Lead ID':leadId,Phone:'+972501234585',Outcome:restriction.outcome}}};
  const ciphertext=seal(JSON.stringify(snapshot),`ls_contact_ops/legacy/v1/${f.workspaceId}/synthetic-opt-out-workbook/1/${leadId}`,f.keyring);
  await f.pool.query(`INSERT INTO ls_contact_ops.legacy_links(workspace_id,source_file_id,source_sheet_id,source_tab_title,
   legacy_lead_id,person_id,source_revision,row_digest,snapshot_ciphertext) VALUES($1,'synthetic-opt-out-workbook',1,'Synthetic Leads',$2,$3,'preserved-opt-out-revision',$4,$5)`,
   [f.workspaceId,leadId,personId,'b'.repeat(64),ciphertext]);
  await f.pool.query('UPDATE ls_identity.accounts SET phone_ciphertext=$2,phone_verified_at=clock_timestamp() WHERE id=$1',
   [f.parent.actor.id,seal(inquiry.fromNumber,`phone:${f.workspaceId}:${f.parent.actor.id}`,f.keyring)]);
  await activate();const people=await count('ls_identity.people'),accounts=await count('ls_identity.accounts'),cases=await count('ls_cases.cases');
  const all=()=>crm.list(actor,{view:'all',search:'',today:'2026-09-29',page:1,pageSize:100,personId},3);
  expect((await all()).items[0]?.doNotContact).toBe(true);
  await store.capture(inquiry);await store.capture({...inquiry,providerEventId:'opt-out-second',providerMessageId:'opt-out-second',occurredAt:'2026-09-28T03:00:00Z'});
  const row=(await all()).items[0]!;expect(row).toMatchObject({personId,doNotContact:true,nextAction:'Review inbound inquiry',
   notes:'Preserve imported administrative note — לא ליצור קשר',inboundActivity:{messageCount:2}});
  expect(row.followUpDate).toBe(new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jerusalem'}).format(new Date()));
  expect((await crm.prospects(actor,3)).every(r=>r.stage==='Do not contact'&&r.nextAction==='Review inbound inquiry')).toBe(true);
  expect((await f.pool.query('SELECT snapshot_ciphertext FROM ls_contact_ops.legacy_links WHERE workspace_id=$1',[f.workspaceId])).rows[0].snapshot_ciphertext).toBe(ciphertext);
  expect(await count('ls_identity.people')).toBe(people);expect(await count('ls_identity.accounts')).toBe(accounts);expect(await count('ls_cases.cases')).toBe(cases);
 }
});
test('multi-page endpoint matching groups bounded links once per locked drain and never reuses stale claims across transactions',async()=>{
 const {f,db,actor,crm,store,prepare,authority,count}=await setup();
 for(let i=0;i<101;i++){
  const personId=randomUUID(),legacyIds=['LS-LEAD-linear-'+i+'-a','LS-LEAD-linear-'+i+'-b'];
  await f.pool.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult',$3,clock_timestamp())",
   [personId,f.workspaceId,seal(JSON.stringify({displayName:'Synthetic indexed contact '+i}),`person:${f.workspaceId}:${personId}`,f.keyring)]);
  await f.pool.query("INSERT INTO ls_contact_ops.profiles(workspace_id,person_id,payload_ciphertext,record_mode,demo_batch_id) VALUES($1,$2,$3,'live',NULL)",
   [f.workspaceId,personId,seal(JSON.stringify({personId,stage:'New inquiry',nextAction:null,followUpDate:null,notes:'Keep indexed note '+i,legacyIds}),crmProfileAad(f.workspaceId,personId),f.keyring)]);
  for(const leadId of legacyIds){
   const snapshot={sourceRow:i+2,payload:{displayName:'Synthetic indexed contact '+i,language:'en',stageText:'New inquiry',
    sourceFields:{'Lead ID':leadId,Phone:'+97250'+String(1000000+i)}}};
   await f.pool.query(`INSERT INTO ls_contact_ops.legacy_links(workspace_id,source_file_id,source_sheet_id,source_tab_title,
    legacy_lead_id,person_id,source_revision,row_digest,snapshot_ciphertext) VALUES($1,'synthetic-indexed-workbook',1,'Synthetic Leads',$2,$3,'indexed-revision',$4,$5)`,
    [f.workspaceId,leadId,personId,'c'.repeat(64),seal(JSON.stringify(snapshot),`ls_contact_ops/legacy/v1/${f.workspaceId}/synthetic-indexed-workbook/1/${leadId}`,f.keyring)]);
  }
 }
 await store.capture(inquiry);await prepare();
 await store.capture({...inquiry,providerEventId:'indexed-second',providerMessageId:'indexed-second',occurredAt:'2026-09-28T03:00:00Z'});
 await store.capture({...inquiry,providerEventId:'indexed-new-thread',providerMessageId:'indexed-new-thread',providerThreadId:'indexed-new-thread'});
 await authority.advance(actor,{action:'switch_native',proof:proof(2),operationId:'activate'});
 const observed={profilePages:0,linkPages:0,accountScans:0,limits:[] as number[]};
 const instrumented:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async <R extends object>(sql:string,values:readonly unknown[]=[])=>{
  if(sql.includes('FROM ls_contact_ops.profiles')&&sql.includes('ORDER BY person_id LIMIT $3')){observed.profilePages++;expect(values[2]).toBe(100);}
  if(sql.includes('FROM ls_contact_ops.legacy_links')&&sql.includes('jsonb_array_elements_text')){observed.linkPages++;observed.limits.push(Number(values[2]));}
  if(sql.includes('LEFT JOIN ls_identity.account_subjects'))observed.accountScans++;
  return tx.query<R>(sql,values);
 }}))};
 const drain=new ContactInboundStore(instrumented,f.workspaceId,f.keyring,key,inboundBindingDigest(inquiry));
 expect(await drain.drain(actor,3)).toMatchObject({processed:3,projected:2,needsResolution:1,replayed:0,hasMore:false});
 expect(observed).toEqual({profilePages:2,linkPages:2,accountScans:1,limits:[10001,101]});
 expect(await count('ls_contact_ops.profiles')).toBe(102);expect(await count('ls_contact_ops.legacy_links')).toBe(202);
 const all=await crm.list(actor,{view:'all',search:inquiry.fromNumber,today:'2026-09-29',page:1,pageSize:100},3);
 expect(all.items).toHaveLength(1);expect(all.items[0]?.inboundActivity?.messageCount).toBe(2);
 // The newly created unverified endpoint also protects a different thread in
 // this same batch; it must not produce a second person from the cached scan.
 await f.pool.query('UPDATE ls_identity.accounts SET phone_ciphertext=$2,phone_verified_at=clock_timestamp() WHERE id=$1',
  [f.parent.actor.id,seal(inquiry.fromNumber,`phone:${f.workspaceId}:${f.parent.actor.id}`,f.keyring)]);
 await store.capture({...inquiry,providerEventId:'indexed-fresh-shared',providerMessageId:'indexed-fresh-shared'});
 expect(await count('ls_contact_ops.profiles')).toBe(102);
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_contact_ops.inbound_projections WHERE workspace_id=$1 AND state='needs_resolution'",[f.workspaceId])).rows[0].n).toBe(2);
});
test('demo account endpoints cannot create live contacts, and ordinary profile edits cannot rewrite provider provenance/activity',async()=>{
 const {f,db,actor,store,activate,list,count}=await setup({demoFirst:true});await activate();
 await f.pool.query('UPDATE ls_identity.accounts SET phone_ciphertext=$2,phone_verified_at=clock_timestamp() WHERE id=$1',
  [f.parent.actor.id,seal(inquiry.fromNumber,`phone:${f.workspaceId}:${f.parent.actor.id}`,f.keyring)]);
 await store.capture(inquiry);expect(await count('ls_contact_ops.profiles')).toBe(0);
 await store.capture({...inquiry,fromNumber:'+972501234573',providerEventId:'live-unknown',providerMessageId:'live-unknown',providerThreadId:'live-unknown'});
 const item=(await list()).items[0]!,profiles=new NativeCrmStore(db,f.keyring,key),saved=await profiles.read(actor,item.personId);
 expect(saved).not.toBeNull();
 await expect(profiles.create(actor,{...saved!.profile,personId:f.outsider.actor.personId,
  whatsappInquiry:{...saved!.profile.whatsappInquiry!,leadId:'LS-WAPI-native-'+f.outsider.actor.personId}},randomUUID())).rejects.toThrow('PROVIDER_FIELDS_REQUIRE_INBOUND_RECEIPT');
 await expect(profiles.update(actor,{...saved!.profile,inboundActivity:{...saved!.profile.inboundActivity!,messageCount:99}},saved!.version,randomUUID())).rejects.toThrow('INBOUND_ACTIVITY_IMMUTABLE');
 await expect(profiles.update(actor,{...saved!.profile,whatsappInquiry:{...saved!.profile.whatsappInquiry!,phone:'+972501234574'}},saved!.version,randomUUID())).rejects.toThrow('INQUIRY_ORIGIN_IMMUTABLE');
 expect((await list()).items[0]?.inboundActivity?.messageCount).toBe(1);
});
test('a stable provider thread cannot rebind its sender or ignore a new conflicting endpoint claim',async()=>{
 const {f,actor,crm,store,activate,list,count}=await setup();await activate();await store.capture(inquiry);
 const original=(await list()).items[0]!;await crm.updateProspectFields(actor,original.references[0]!.leadId,{notes:'Preserve original administrative note'},original.version!,randomUUID(),3);
 await expect(store.capture({...inquiry,fromNumber:'+972501234575',providerEventId:'rebound-sender',providerMessageId:'rebound-sender'})).rejects.toThrow('CONFLICT');
 expect(await count('ls_contact_ops.message_receipts')).toBe(1);
 await f.pool.query('UPDATE ls_identity.accounts SET phone_ciphertext=$2,phone_verified_at=clock_timestamp() WHERE id=$1',
  [f.parent.actor.id,seal(inquiry.fromNumber,`phone:${f.workspaceId}:${f.parent.actor.id}`,f.keyring)]);
 await store.capture({...inquiry,providerEventId:'new-endpoint-claim',providerMessageId:'new-endpoint-claim'});
 expect((await list()).items[0]).toMatchObject({personId:original.personId,notes:'Preserve original administrative note',inboundActivity:{messageCount:1}});
 expect((await f.pool.query("SELECT state,person_id FROM ls_contact_ops.inbound_projections WHERE workspace_id=$1 AND state='needs_resolution'",[f.workspaceId])).rows).toEqual([{state:'needs_resolution',person_id:null}]);
});
test('fresh role, cross-workspace and corrupt authority denial preserves durable state',async()=>{
 const {f,actor,store,activate,count}=await setup();await activate();
 await expect(store.drain(f.parent.actor,3)).rejects.toThrow('FORBIDDEN');
 await expect(store.drain({...actor,workspaceId:randomUUID() as typeof actor.workspaceId},3)).rejects.toThrow('FORBIDDEN');
 await f.pool.query('UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE token_digest=$1',[actor.sessionDigest]);
 await expect(store.drain(actor,3)).rejects.toThrow('UNAUTHENTICATED');
 await f.pool.query("UPDATE ls_contact_ops.cutover SET state_ciphertext='corrupt-synthetic-state' WHERE workspace_id=$1",[f.workspaceId]);
 await expect(store.capture(inquiry)).rejects.toThrow('UNAVAILABLE');expect(await count('ls_contact_ops.message_receipts')).toBe(0);
});
