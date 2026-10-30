import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
vi.mock('server-only',()=>({}));
import {BnaInquiryStore} from '../../src/features/bna-inquiry/store.ts';
import {BNA_COOP_NOTICE,BNA_COOP_PROGRAM} from '../../src/features/bna-inquiry/coop-contract.ts';
import {BNA_SUPPORT_NOTICE,BNA_SUPPORT_PROGRAM,BNA_SUPPORT_UPDATES_NOTICE} from '../../src/features/bna-inquiry/support-contract.ts';
import {BnaAcknowledgmentStore,configuredBnaAcknowledgmentQueue} from '../../src/features/bna-communications/acknowledgment-store.ts';
import {BnaPreferenceStore} from '../../src/features/bna-communications/preferences-store.ts';
import {BnaOptionalCalendarStore,type BnaOptionalAdmission} from '../../src/features/bna-communications/optional-calendar-store.ts';
import {BnaReplyStore,type BnaReplyMailboxAdmission} from '../../src/features/bna-communications/reply-store.ts';
import {BnaReplySourceCatalog} from '../../src/features/bna-communications/reply-source-catalog.ts';
import {BnaReplyMonitorStore,type BnaReplyMonitorAdmission} from '../../src/features/bna-communications/reply-monitor-store.ts';
import type {BnaReceivedReply,BnaSentReplySource} from '../../src/features/bna-communications/reply-contract.ts';
import {BNA_EMAIL_SOURCE} from '../../src/features/bna-communications/delivery-policy.ts';
import {bnaEmailCandidates} from '../../src/features/bna-communications/email-candidates.ts';
import {asId} from '../../src/lib/ids.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
const db=new PGlite(),workspace=asId(randomUUID(),'workspace'),owner=randomUUID(),other=randomUUID(),base=new Date('2026-10-30T00:00:00Z'),DAY=86400000;
let now=base;const clock={now:()=>now},ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,31)}},key='synthetic-mailbox-replies-private-key';
const adapter:IdentityStore={transaction:fn=>db.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>
 (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const inquiries=new BnaInquiryStore(adapter,workspace,ring,key,owner,clock,configuredBnaAcknowledgmentQueue({LS_BNA_EMAIL_QUEUE_ENABLED:'true',LS_BNA_EMAIL_QUEUE_SINCE:base.toISOString(),LS_BNA_EMAIL_SOURCE_SHA256:BNA_EMAIL_SOURCE},ring,key));
const acknowledgment=new BnaAcknowledgmentStore(adapter,workspace,owner,ring,key,clock),basePrefs=new BnaPreferenceStore(adapter,workspace,owner,ring,key,clock,inquiries);
const optionalAdmission:BnaOptionalAdmission={sourceSha256:BNA_EMAIL_SOURCE,postalAddress:'SYNTHETIC ONLY, 123 Test Street, Example',approvedCopies:Object.fromEntries(bnaEmailCandidates.messages.map(m=>[m.id,m.copySha256]))};
const optionalSources=new BnaOptionalCalendarStore(adapter,workspace,owner,ring,key,clock,inquiries,basePrefs,()=>optionalAdmission);
const sourceStores={service:acknowledgment,optional:optionalSources};
let admission:BnaReplyMailboxAdmission|null={primaryMailbox:'synthetic-mailbox@example.invalid',monitorFrom:base.toISOString()};
const replies=new BnaReplyStore(adapter,workspace,owner,ring,key,clock,sourceStores,()=>admission);
const prefs=new BnaPreferenceStore(adapter,workspace,owner,ring,key,clock,inquiries,replies);
const calendar=new BnaOptionalCalendarStore(adapter,workspace,owner,ring,key,clock,inquiries,prefs,()=>optionalAdmission);
const actor=(id:string)=>({id,workspaceId:workspace,personId:id,role:id===owner?'practitioner':'parent',state:'active',locale:'en',sessionDigest:id.replaceAll('-','').padEnd(64,'0'),expiresAt:new Date('2035-01-01').getTime()}) as Actor;
const ownerActor=actor(owner),otherActor=actor(other);
async function inquiry(email=randomUUID()+'@example.invalid',updates=true,support=false){
 const shared={name:'SYNTHETIC ADULT',contactChannel:'email' as const,contact:email,emailUpdates:updates,language:'en' as const,siteLanguage:'en' as const};
 return (await inquiries.submit({operationId:randomUUID(),fields:support?{...shared,purpose:'support_conversation',permission:{confirmed:true,version:BNA_SUPPORT_NOTICE.version,language:'en'},...(updates?{updatesPermission:{confirmed:true as const,channel:'email' as const,version:BNA_SUPPORT_UPDATES_NOTICE.version,language:'en' as const}}:{})}:
 {...shared,townOrZip:'DO NOT COPY TOWN',childAges:[10],question:'DO NOT COPY CHILD NOTE',permission:{confirmed:true,version:BNA_COOP_NOTICE.version,language:'en'}}},support?BNA_SUPPORT_PROGRAM:BNA_COOP_PROGRAM)).reference;
}
async function sent(id:string){const row=await acknowledgment.readForInquiry(ownerActor,id);if(!('messageId' in row))throw Error('synthetic queue missing');
 expect(await acknowledgment.dispatch(row.messageId,{mode:'controlled_test',authorize:()=>true,send:async()=>({state:'accepted',providerId:'synthetic-sent-'+randomUUID()})})).toBe('sent');return {kind:'service' as const,messageId:row.messageId};}
const incoming=(source:BnaSentReplySource,providerId='synthetic-reply-'+randomUUID()):BnaReceivedReply=>({inquiryId:source.inquiryId,program:source.program,originalMessageId:source.messageId,providerMessageId:providerId,providerThreadId:'synthetic-thread',receivedAt:now.toISOString()});
const reader=(providerId='synthetic-reply-'+randomUUID())=>({readRepliesForBinding:async(sources:readonly BnaSentReplySource[],binding:BnaReplyMailboxAdmission)=>{expect(binding).toEqual(admission);expect(JSON.stringify(sources)).not.toMatch(/DO NOT COPY|subject|text|payload|childAges/);return sources.map(s=>incoming(s,providerId));}});
const count=async()=>({receipts:(await db.query<{n:number}>('SELECT count(*)::int AS n FROM ls_service_interest.bna_mailbox_reply_receipts')).rows[0]!.n,
 reviews:(await db.query<{n:number}>('SELECT count(*)::int AS n FROM ls_service_interest.bna_mailbox_reply_reviews')).rows[0]!.n});
beforeAll(async()=>{
 await db.exec('CREATE SCHEMA ls_control');
 for(const file of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0124_ls_group_interest.sql','0131_ls_public_group_applications.sql','0139_ls_bna_inquiries.sql','0142_ls_bna_coop_interest.sql','0144_ls_bna_support_interest.sql','0146_ls_bna_communication_delivery.sql','0148_ls_bna_email_preferences.sql','0149_ls_bna_optional_calendar.sql','0150_ls_bna_mailbox_replies.sql'])await db.exec(await readFile('migrations/'+file,'utf8'));
 await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,base]);
 for(const id of [owner,other]){
  const digest=id.replaceAll('-','').padEnd(64,'0');
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspace,base]);
  await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$5,'active','en',$3,'synthetic',$4,'synthetic',$4,$4)",[id,workspace,digest,base,id===owner?'practitioner':'parent']);
  await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)',[workspace,id]);
  await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[digest,workspace,id,base,new Date('2035-01-01')]);
 }
},30000);
beforeEach(()=>{now=base;admission={primaryMailbox:'synthetic-mailbox@example.invalid',monitorFrom:base.toISOString()};});afterAll(()=>db.close());
function monitor(ids:string[],store=adapter){
 admission={primaryMailbox:randomUUID()+'@example.invalid',monitorFrom:base.toISOString()};
 let admitted:BnaReplyMonitorAdmission|null={...admission,sourceSince:base.toISOString(),inquiryIds:ids,policyDigest:'a'.repeat(64)};
 const catalog=new BnaReplySourceCatalog(workspace,owner,key,clock),journal=new BnaReplyMonitorStore(store,workspace,owner,ring,key,clock,catalog,replies,()=>admitted);
 return {journal,catalog,get admitted(){return admitted;},set admitted(value:BnaReplyMonitorAdmission|null){admitted=value;}};
}
const quietReader=()=>({readRepliesForBinding:vi.fn(async()=>[] as BnaReceivedReply[]),verifyMailboxForBinding:vi.fn(async()=>({verified:true as const}))});
it('does not claim an empty mailbox check until a real profile probe has succeeded; errors contain no provider data',async()=>{
 const id=await inquiry(),f=monitor([id]),r=quietReader();
 expect(await f.journal.status(ownerActor)).toEqual({state:'unconnected',lastCheckedAt:null,coverageFrom:null});
 await expect(f.journal.status(otherActor)).rejects.toMatchObject({code:'NOT_FOUND'});
 r.verifyMailboxForBinding.mockRejectedValueOnce(Error('SYNTHETIC_SECRET_DO_NOT_LOG'));
 expect(await f.journal.runBatch(r)).toEqual({state:'failed'});expect((await f.journal.status(ownerActor)).state).toBe('failed');
 expect(r.readRepliesForBinding).not.toHaveBeenCalled();expect(r.verifyMailboxForBinding).toHaveBeenCalledTimes(1);
 now=new Date(base.getTime()+1000);expect(await f.journal.runBatch(r)).toEqual({state:'completed',received:0,replayed:0,reconciled:false});
 expect(await f.journal.status(ownerActor)).toEqual({state:'connected',lastCheckedAt:now.toISOString(),coverageFrom:base.toISOString()});
 const raw=(await db.query('SELECT payload_ciphertext FROM ls_service_interest.bna_mailbox_monitor_events WHERE mailbox_key=(SELECT mailbox_key FROM ls_service_interest.bna_mailbox_monitor_events ORDER BY recorded_at DESC LIMIT 1)')).rows;
 expect(JSON.stringify(raw)).not.toMatch(/SYNTHETIC_SECRET|example.invalid|DO NOT COPY/);
});
it('invalidates completed coverage for a new native accepted send, changed policy, elapsed age or pause',async()=>{
 const id=await inquiry(),f=monitor([id]),r=quietReader();await f.journal.runBatch(r);expect((await f.journal.status(ownerActor)).state).toBe('connected');
 await sent(id);expect((await f.journal.status(ownerActor)).state).toBe('stale');await f.journal.runBatch(r);
 expect(r.readRepliesForBinding).toHaveBeenCalledTimes(1);expect((await f.journal.status(ownerActor)).state).toBe('connected');
 now=new Date(base.getTime()+180001);expect((await f.journal.status(ownerActor)).state).toBe('stale');
 f.admitted={...f.admitted!,policyDigest:'b'.repeat(64)};expect((await f.journal.status(ownerActor)).state).toBe('unconnected');
 f.admitted=null;expect((await f.journal.status(ownerActor)).state).toBe('paused');await expect(f.journal.runBatch(r)).rejects.toThrow();
});
it('holds one read lease; receipt, initial review and scan advancement commit atomically',async()=>{
 const id=await inquiry(),selection=await sent(id),f=monitor([id]),r=quietReader();now=new Date(base.getTime()+1000);
 let release!:(value:BnaReceivedReply[])=>void,started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
 const reading={...r,readRepliesForBinding:async(sources:readonly BnaSentReplySource[])=>{expect(sources.map(s=>s.messageId)).toEqual([selection.messageId]);started();return new Promise<BnaReceivedReply[]>(resolve=>{release=resolve;});}};
 const run=f.journal.runBatch(reading);await ready;expect((await f.journal.status(ownerActor)).state).toBe('checking');
 expect(await f.journal.runBatch(r)).toEqual({state:'busy'});expect(r.readRepliesForBinding).not.toHaveBeenCalled();
 const source=await adapter.transaction(tx=>acknowledgment.replySource(tx,selection.messageId));release([incoming(source)]);
 expect(await run).toMatchObject({state:'completed',received:1});expect((await f.journal.status(ownerActor)).state).toBe('connected');
 // Select this mailbox's completed proof via its digest, independently of
 // another synthetic test's identical clock value.
 const sourceSnapshot=await adapter.transaction(tx=>f.catalog.snapshot(tx,f.admitted!));
 const exact=(await db.query<{cycleId:string;bindingDigest:string}>('SELECT cycle_id AS "cycleId",binding_digest AS "bindingDigest" FROM ls_service_interest.bna_mailbox_monitor_events WHERE source_digest=$1 AND state=\'completed\'',[sourceSnapshot.digest])).rows[0]!;
 await expect(f.journal.verifyControlledCycle(exact)).resolves.toBeUndefined();
 await expect(f.journal.verifyControlledCycle({...exact,bindingDigest:'0'.repeat(64)})).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect((await prefs.readOwner(ownerActor,id)).preferences.replyPending).toBe(true);
 f.admitted=null;expect((await prefs.readOwner(ownerActor,id)).preferences.replyPending).toBe(true);
});
it('reclaims an expired read without letting the stale worker save any receipt or advance its cursor',async()=>{
 const id=await inquiry(),selection=await sent(id),f=monitor([id]),r=quietReader();now=new Date(base.getTime()+1000);
 const source=await adapter.transaction(tx=>acknowledgment.replySource(tx,selection.messageId)),before=await count();
 let release!:(value:BnaReceivedReply[])=>void,started!:()=>void;const ready=new Promise<void>(resolve=>{started=resolve;});
 const run=f.journal.runBatch({...r,readRepliesForBinding:async()=>{started();return new Promise<BnaReceivedReply[]>(resolve=>{release=resolve;});}});await ready;
 now=new Date(now.getTime()+300001);expect((await f.journal.status(ownerActor)).state).toBe('stale');
 expect(await f.journal.runBatch(r)).toMatchObject({state:'completed',received:0});release([incoming(source)]);
 expect(await run).toEqual({state:'superseded'});expect(await count()).toEqual(before);
 expect((await f.journal.status(ownerActor)).state).toBe('stale'); // oldest batch read exceeds the freshness budget
 await f.journal.runBatch(r);expect((await f.journal.status(ownerActor)).state).toBe('connected');
});
it('resumes a failed 25-source batch from its saved cursor instead of restarting the cycle',async()=>{
 const ids:string[]=[];for(let i=0;i<26;i++){const id=await inquiry();ids.push(id);await sent(id);}
 const f=monitor(ids),r=quietReader();now=new Date(base.getTime()+1000);const sizes:number[]=[];
 r.readRepliesForBinding.mockImplementation(async(...args:unknown[])=>{sizes.push((args[0] as BnaSentReplySource[]).length);if(sizes.length===2)throw Error('synthetic outage');return [];});
 expect(await f.journal.runBatch(r)).toMatchObject({state:'batch_saved'});expect((await f.journal.status(ownerActor)).state).toBe('checking');
 expect(await f.journal.runBatch(r)).toEqual({state:'failed'});expect(await f.journal.runBatch(r)).toMatchObject({state:'completed'});
 expect(sizes).toEqual([25,1,1]);expect((await f.journal.status(ownerActor)).state).toBe('connected');
 const binding=f.admitted!;const snap=await adapter.transaction(tx=>f.catalog.snapshot(tx,binding));expect(snap.selectors).toHaveLength(26);
 const rows=(await db.query<{cursor:number;code:string}>('SELECT cursor,code FROM ls_service_interest.bna_mailbox_monitor_events WHERE source_digest=$1 ORDER BY version',[snap.digest])).rows;
 expect(rows.map(x=>[x.cursor,x.code])).toEqual([[0,'CYCLE_STARTED'],[25,'BATCH_SAVED'],[25,'READ_RESERVED'],[25,'READ_FAILED'],[25,'READ_RETRY'],[26,'CYCLE_COMPLETED']]);
});
it('reconciles a committed empty-catalog completion after a lost database response',async()=>{
 const id=await inquiry();let lose=true;
 const uncertain:IdentityStore={transaction:async fn=>{const value=await adapter.transaction(fn);if(lose&&(await db.query("SELECT 1 FROM ls_service_interest.bna_mailbox_monitor_events WHERE owner_account_id=$1 AND state='completed' AND recorded_at=$2",[owner,new Date(base.getTime()+2345)])).rows.length){lose=false;throw Error('synthetic lost commit result');}return value;}};
 const f=monitor([id],uncertain);now=new Date(base.getTime()+2345);const r=quietReader();expect(await f.journal.runBatch(r)).toEqual({state:'completed',received:0,replayed:0,reconciled:true});
 expect(r.verifyMailboxForBinding).toHaveBeenCalledTimes(1);expect((await f.journal.status(ownerActor)).state).toBe('connected');
});
it('rolls back provider receipts if the protected binding changes during the read',async()=>{
 const id=await inquiry(),selection=await sent(id),f=monitor([id]),r=quietReader(),before=await count();now=new Date(base.getTime()+1000);
 const source=await adapter.transaction(tx=>acknowledgment.replySource(tx,selection.messageId));
 const read={...r,readRepliesForBinding:async()=>{f.admitted={...f.admitted!,policyDigest:'c'.repeat(64)};return [incoming(source)];}};
 expect(await f.journal.runBatch(read)).toEqual({state:'superseded'});expect(await count()).toEqual(before);
 expect((await f.journal.status(ownerActor)).state).toBe('unconnected');expect(await f.journal.runBatch(r)).toMatchObject({state:'completed'});
});
it('pausing during a read prevents receipt/cursor writes and reports paused without changing stored holds',async()=>{
 const id=await inquiry(),selection=await sent(id),f=monitor([id]),r=quietReader(),before=await count();now=new Date(base.getTime()+1000);
 const source=await adapter.transaction(tx=>acknowledgment.replySource(tx,selection.messageId));
 expect(await f.journal.runBatch({...r,readRepliesForBinding:async()=>{f.admitted=null;return [incoming(source)];}})).toEqual({state:'superseded'});
 expect(await count()).toEqual(before);expect((await f.journal.status(ownerActor)).state).toBe('paused');
});
it('atomically saves one encrypted receipt and a provider-sourced pending review without creating People or preferences',async()=>{
 const id=await inquiry(undefined,false),selection=await sent(id);now=new Date(base.getTime()+1000);const before=await count(),r=reader();
 expect(await replies.ingest([selection],r)).toEqual({received:1,replayed:0});expect(await count()).toEqual({receipts:before.receipts+1,reviews:before.reviews+1});
 const review=await replies.readOwner(ownerActor,id);expect(review.items).toHaveLength(1);expect(review.items[0]).toMatchObject({version:1,state:'pending',sourceKind:'service'});
 expect((await prefs.readOwner(ownerActor,id)).preferences).toMatchObject({version:0,permissionGrantedAt:null,replyPending:true});
 const raw=(await db.query('SELECT payload_ciphertext,mailbox_key,provider_message_key FROM ls_service_interest.bna_mailbox_reply_receipts WHERE inquiry_id=$1',[id])).rows;
 expect(JSON.stringify(raw)).not.toMatch(/DO NOT COPY|SYNTHETIC ADULT|example.invalid|synthetic-reply|synthetic-thread/);
 expect((await db.query('SELECT actor_account_id,state FROM ls_service_interest.bna_mailbox_reply_reviews WHERE receipt_id=$1',[review.items[0]!.id])).rows).toEqual([{actor_account_id:null,state:'pending'}]);
 expect((await db.query('SELECT count(*)::int AS n FROM ls_identity.people')).rows).toEqual([{n:2}]);
 expect((await db.query('SELECT count(*)::int AS n FROM ls_service_interest.bna_email_preference_events')).rows).toEqual([{n:0}]);
});
it('uses one recorded instant for an initial receipt and review even when the clock advances between SQL calls',async()=>{
 const id=await inquiry(),selection=await sent(id);now=new Date(base.getTime()+1000);let tick=now.getTime();
 const advancing=new BnaReplyStore(adapter,workspace,owner,ring,key,{now:()=>new Date(tick++)},sourceStores,()=>admission);
 expect(await advancing.ingest([selection],reader())).toMatchObject({received:1});
 expect((await db.query<{same:boolean}>('SELECT r.recorded_at=e.recorded_at AS same FROM ls_service_interest.bna_mailbox_reply_receipts r JOIN ls_service_interest.bna_mailbox_reply_reviews e ON e.workspace_id=r.workspace_id AND e.receipt_id=r.id AND e.version=1 WHERE r.inquiry_id=$1',[id])).rows).toEqual([{same:true}]);
});
it('replays receipts without duplicate work, preserves completed review, and opens new work only for a new message',async()=>{
 const id=await inquiry(),selection=await sent(id);now=new Date(base.getTime()+1000);const r=reader();await replies.ingest([selection],r);
 const receipt=(await replies.readOwner(ownerActor,id)).items[0]!,command={action:'mark_reviewed' as const,receiptId:receipt.id,operationId:randomUUID(),expectedVersion:1};
 await expect(replies.markReviewed(otherActor,command)).rejects.toMatchObject({code:'NOT_FOUND'});
 expect(await replies.markReviewed(ownerActor,command)).toEqual({state:'reviewed',version:2,replayed:false});
 expect(await replies.markReviewed(ownerActor,command)).toEqual({state:'reviewed',version:2,replayed:true});
 expect(await replies.ingest([selection],r)).toEqual({received:0,replayed:1});expect((await prefs.readOwner(ownerActor,id)).preferences.replyPending).toBe(false);
 await expect(replies.markReviewed(ownerActor,{...command,expectedVersion:2})).rejects.toMatchObject({code:'CONFLICT'});
 now=new Date(now.getTime()+1000);await replies.ingest([selection],reader());expect((await prefs.readOwner(ownerActor,id)).preferences.replyPending).toBe(true);
 expect((await replies.readOwner(ownerActor,id)).items.map(i=>i.state)).toEqual(['pending','reviewed']);
});
it('keeps same-adult programs separate and refuses remapping one provider receipt to another program',async()=>{
 const email=randomUUID()+'@example.invalid',co=await inquiry(email),support=await inquiry(email,true,true),coSelection=await sent(co),supportSelection=await sent(support);
 now=new Date(base.getTime()+1000);const r=reader();await replies.ingest([coSelection],r);
 expect((await prefs.readOwner(ownerActor,co)).preferences.replyPending).toBe(true);expect((await prefs.readOwner(ownerActor,support)).preferences.replyPending).toBe(false);
 expect(await replies.summariesForInquiries(ownerActor,[co,support])).toEqual({[co]:{pending:1,latestReceivedAt:now.toISOString()},[support]:{pending:0,latestReceivedAt:null}});
 await expect(replies.summariesForInquiries(ownerActor,[co,randomUUID()])).rejects.toMatchObject({code:'NOT_FOUND'});
 const before=await count();await expect(replies.ingest([supportSelection],r)).rejects.toMatchObject({code:'CONFLICT'});expect(await count()).toEqual(before);
 await expect(replies.readOwner(otherActor,co)).rejects.toMatchObject({code:'NOT_FOUND'});
});
it('clearing a provider review does not clear a separate manual reply hold, withdrawal, pause or missing permission',async()=>{
 const id=await inquiry(undefined,false),selection=await sent(id);now=new Date(base.getTime()+1000);await replies.ingest([selection],reader());
 await prefs.updateOwner(ownerActor,{inquiryId:id,operationId:randomUUID(),expectedVersion:0,action:'record_reply',note:'SYNTHETIC separate owner hold'});
 await prefs.updateOwner(ownerActor,{inquiryId:id,operationId:randomUUID(),expectedVersion:1,action:'withdraw_relationship',note:'SYNTHETIC withdrawal'});
 const item=(await replies.readOwner(ownerActor,id)).items[0]!;await replies.markReviewed(ownerActor,{action:'mark_reviewed',receiptId:item.id,operationId:randomUUID(),expectedVersion:1});
 expect((await prefs.readOwner(ownerActor,id)).preferences).toMatchObject({replyPending:true,withdrawn:true,permissionGrantedAt:null});
 await prefs.updateOwner(ownerActor,{inquiryId:id,operationId:randomUUID(),expectedVersion:2,action:'triage_reply',note:'SYNTHETIC owner reply handled'});
 expect((await prefs.readOwner(ownerActor,id)).preferences).toMatchObject({replyPending:false,withdrawn:true,permissionGrantedAt:null});
});
it('new reply suppression prevents an already prepared optional send until owner review',async()=>{
 const id=await inquiry(),selection=await sent(id);now=new Date(base.getTime()+4*DAY);
 const prepared=await calendar.prepare(ownerActor,{action:'prepare',inquiryId:id,operationId:randomUUID(),expectedPreferenceVersion:0,templateId:'EMAIL-B1'});expect(prepared.messageId).toBeTruthy();
 await replies.ingest([selection],reader());expect((await calendar.readOwner(ownerActor,id)).next?.decision).toMatchObject({eligible:false,reason:'reply_pending'});
 let calls=0;const transport={authorize:()=>true,send:async()=>{calls++;return {state:'accepted' as const,providerId:'synthetic-optional-accepted'};}};
 expect(await calendar.dispatch(prepared.messageId!,transport)).toBe('prepared');expect(calls).toBe(0);
 const review=(await replies.readOwner(ownerActor,id)).items[0]!;await replies.markReviewed(ownerActor,{action:'mark_reviewed',receiptId:review.id,operationId:randomUUID(),expectedVersion:1});
 expect(await calendar.dispatch(prepared.messageId!,transport)).toBe('sent');expect(calls).toBe(1);
 now=new Date(now.getTime()+1000);await replies.ingest([{kind:'optional',messageId:prepared.messageId!}],reader());
 expect((await replies.readOwner(ownerActor,id)).items[0]).toMatchObject({state:'pending',sourceKind:'optional'});
});
it('fails closed when monitoring is not admitted, provider reading fails, or the admission changes during the read',async()=>{
 const id=await inquiry(),selection=await sent(id),before=await count();const read=vi.fn(async()=>[]);admission=null;
 await expect(replies.ingest([selection],{readRepliesForBinding:read})).rejects.toMatchObject({code:'UNAVAILABLE'});expect(read).not.toHaveBeenCalled();
 admission={primaryMailbox:'synthetic-mailbox@example.invalid',monitorFrom:base.toISOString()};
 await expect(replies.ingest([selection],{readRepliesForBinding:async()=>{throw Error('synthetic provider unavailable');}})).rejects.toThrow();
 await expect(replies.ingest([selection],{readRepliesForBinding:async sources=>{admission=null;return sources.map(s=>incoming(s));}})).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect(await count()).toEqual(before);
});
it('does not ingest queued/unknown mail or commit an earlier receipt from an invalid partial batch',async()=>{
 const id=await inquiry(),delivery=await acknowledgment.readForInquiry(ownerActor,id);if(!('messageId' in delivery))throw Error();
 const before=await count();await expect(replies.ingest([{kind:'service',messageId:delivery.messageId}],reader())).rejects.toMatchObject({code:'UNAVAILABLE'});
 const selection=await sent(id);now=new Date(base.getTime()+1000);
 await expect(replies.ingest([selection],{readRepliesForBinding:async sources=>[incoming(sources[0]!),{...incoming(sources[0]!),inquiryId:randomUUID()}]})).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect(await count()).toEqual(before);
});
it('rolls back a receipt if its initial owner-review task cannot be saved',async()=>{
 const id=await inquiry(),selection=await sent(id),before=await count();now=new Date(base.getTime()+1000);
 const failing:IdentityStore={transaction:fn=>adapter.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  if(sql.includes('INSERT INTO ls_service_interest.bna_mailbox_reply_reviews'))throw Error('synthetic review write failure');return tx.query<T>(sql,values);
 }}))};
 const failingStore=new BnaReplyStore(failing,workspace,owner,ring,key,clock,sourceStores,()=>admission);
 await expect(failingStore.ingest([selection],reader())).rejects.toThrow('synthetic review write failure');expect(await count()).toEqual(before);
});
it('rechecks active native ownership after the network read',async()=>{
 const id=await inquiry(),selection=await sent(id),before=await count();
 try{await expect(replies.ingest([selection],{readRepliesForBinding:async sources=>{await db.query("UPDATE ls_identity.accounts SET role='parent' WHERE id=$1",[owner]);return sources.map(s=>incoming(s));}})).rejects.toMatchObject({code:'UNAVAILABLE'});}
 finally{await db.query("UPDATE ls_identity.accounts SET role='practitioner' WHERE id=$1",[owner]);}
 expect(await count()).toEqual(before);
});
it('paginates actual history with inquiry-bound cursors and never discloses child content or mailbox addresses',async()=>{
 const id=await inquiry(),otherId=await inquiry(),selection=await sent(id);now=new Date(base.getTime()+1000);
 await replies.ingest([selection],{readRepliesForBinding:async sources=>Array.from({length:51},()=>incoming(sources[0]!))});
 const page=await replies.readOwner(ownerActor,id);expect(page.items).toHaveLength(50);expect(page.nextCursor).toBeTruthy();
 const next=await replies.readOwner(ownerActor,id,page.nextCursor!);expect(next.items).toHaveLength(1);expect(next.nextCursor).toBeNull();
 expect(new Set([...page.items,...next.items].map(i=>i.id)).size).toBe(51);
 expect(JSON.stringify(page)).not.toMatch(/DO NOT COPY|SYNTHETIC ADULT|example.invalid|mailboxKey|recipientKey|payload|providerMessageId/);
 await expect(replies.readOwner(ownerActor,otherId,page.nextCursor!)).rejects.toMatchObject({code:'INVALID_REQUEST'});
});
it('database rejects missing initial review, changed ownership/source and mutations of receipts or review history',async()=>{
 const id=await inquiry(),selection=await sent(id);now=new Date(base.getTime()+1000);await replies.ingest([selection],reader());const receipt=(await replies.readOwner(ownerActor,id)).items[0]!;
 await expect(db.query('UPDATE ls_service_interest.bna_mailbox_reply_receipts SET payload_ciphertext=$2 WHERE id=$1',[receipt.id,'changed'])).rejects.toThrow();
 await expect(db.query('DELETE FROM ls_service_interest.bna_mailbox_reply_reviews WHERE receipt_id=$1',[receipt.id])).rejects.toThrow();
 await expect(db.query('TRUNCATE ls_service_interest.bna_mailbox_reply_reviews')).rejects.toThrow();
 const insert=`INSERT INTO ls_service_interest.bna_mailbox_reply_receipts SELECT workspace_id,$2,owner_account_id,mailbox_key,$3,recipient_key,inquiry_id,program_key,source_kind,source_message_id,received_at,recorded_at,payload_digest,payload_ciphertext FROM ls_service_interest.bna_mailbox_reply_receipts WHERE id=$1`;
 await expect(db.query(insert,[receipt.id,randomUUID(),'a'.repeat(64)])).rejects.toThrow('BNA_MAILBOX_REPLY_INITIAL_HISTORY_REQUIRED');
 const invalid=insert.replace('source_kind,source_message_id','source_kind,$4::uuid');
 await expect(db.query(invalid,[receipt.id,randomUUID(),'b'.repeat(64),randomUUID()])).rejects.toThrow('BNA_MAILBOX_REPLY_SENT_SOURCE_REQUIRED');
});
it('verifies every encrypted review even when an earlier pending receipt already creates a hold',async()=>{
 const id=await inquiry(),selection=await sent(id);now=new Date(base.getTime()+1000);await replies.ingest([selection],reader());now=new Date(now.getTime()+1000);await replies.ingest([selection],reader());
 const item=(await replies.readOwner(ownerActor,id)).items[0]!;
 await db.exec('ALTER TABLE ls_service_interest.bna_mailbox_reply_reviews DISABLE TRIGGER bna_mailbox_reply_reviews_immutable');
 await db.query("UPDATE ls_service_interest.bna_mailbox_reply_reviews SET payload_ciphertext='corrupt' WHERE receipt_id=$1",[item.id]);
 await db.exec('ALTER TABLE ls_service_interest.bna_mailbox_reply_reviews ENABLE TRIGGER bna_mailbox_reply_reviews_immutable');
 await expect(prefs.readOwner(ownerActor,id)).rejects.toMatchObject({code:'UNAVAILABLE'});
});
