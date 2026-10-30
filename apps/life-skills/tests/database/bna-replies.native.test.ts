import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import pg from 'pg';
vi.mock('server-only',()=>({}));
import {historicalPracticeDatabase} from './home-practice/legacy-practice-fixture.ts';
import {poolStore} from './calendar/fixture.ts';
import {migrate} from '../../src/db/migration-runner.ts';
import {bnaMailboxRepliesCatalogFingerprint,BNA_MAILBOX_REPLIES_CATALOG_SHA256,readBnaMailboxRepliesSchemaStage,bnaMailboxRepliesSchemaPlan} from '../../src/db/bna-mailbox-replies-schema-release.ts';
import {BnaInquiryStore} from '../../src/features/bna-inquiry/store.ts';
import {BnaAcknowledgmentStore,configuredBnaAcknowledgmentQueue} from '../../src/features/bna-communications/acknowledgment-store.ts';
import {BnaOptionalCalendarStore,type BnaOptionalAdmission} from '../../src/features/bna-communications/optional-calendar-store.ts';
import {BnaPreferenceStore} from '../../src/features/bna-communications/preferences-store.ts';
import {BnaReplyStore} from '../../src/features/bna-communications/reply-store.ts';
import {BnaReplySourceCatalog} from '../../src/features/bna-communications/reply-source-catalog.ts';
import {BnaReplyMonitorStore} from '../../src/features/bna-communications/reply-monitor-store.ts';
import type {IdentityStore} from '../../src/features/identity/store.ts';
import type {BnaSentReplySource} from '../../src/features/bna-communications/reply-contract.ts';
import {BNA_EMAIL_SOURCE} from '../../src/features/bna-communications/delivery-policy.ts';
import {bnaEmailCandidates} from '../../src/features/bna-communications/email-candidates.ts';
import {BNA_COOP_NOTICE,BNA_COOP_PROGRAM} from '../../src/features/bna-inquiry/coop-contract.ts';
import {BNA_SUPPORT_NOTICE,BNA_SUPPORT_PROGRAM,BNA_SUPPORT_UPDATES_NOTICE} from '../../src/features/bna-inquiry/support-contract.ts';
import {asId} from '../../src/lib/ids.ts';
import type {Actor} from '../../src/features/identity/types.ts';
it('native reply proposal is atomic/additive; concurrent receipts/reviews preserve exactly one pending task and dispatch suppression',async()=>{
 const db=await historicalPracticeDatabase('0118_ls_contact_delta_history.sql'),client=await db.pool.connect(),pool=new pg.Pool({connectionString:db.url,ssl:false,max:6});
 const query=(sql:string,values?:readonly unknown[])=>client.query(sql,values?[...values]:undefined);
 try{
  expect(db.inventory).toHaveLength(70);const index=db.inventory.findIndex(m=>m.name==='0150_ls_bna_mailbox_replies.sql');expect(index).toBe(69);
  const beforeFiles=db.inventory.slice(0,index),proposal=db.inventory[index]!;await migrate({query},beforeFiles,false);
  const baseline=(await query('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows;
  expect(await readBnaMailboxRepliesSchemaStage({query})).toBe(0);
  await query('BEGIN');try{
   await query('CREATE FUNCTION ls_service_interest.check_bna_mailbox_monitor_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$');
   await expect(readBnaMailboxRepliesSchemaStage({query})).rejects.toThrow('BNA_MAILBOX_REPLIES_SCHEMA_CATALOG_CONFLICT');
  }finally{await query('ROLLBACK');}
  const workspace=asId(randomUUID(),'workspace'),owner=randomUUID(),other=randomUUID(),ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,31)}},key='synthetic-native-reply-private-key';
  const base=new Date('2026-10-30T00:00:00Z');let now=base;const clock={now:()=>now};
  await query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,now]);
  for(const id of [owner,other]){const session=id.replaceAll('-','').padEnd(64,'0');
   await query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspace,now]);
   await query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$5,'active','en',$3,'synthetic',$4,'synthetic',$4,$4)",[id,workspace,session,now,id===owner?'practitioner':'parent']);
   await query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)',[workspace,id]);
   await query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[session,workspace,id,now,new Date('2035-01-01')]);
  }
  const actor=(id:string)=>({id,workspaceId:workspace,personId:id,role:id===owner?'practitioner':'parent',state:'active',locale:'en',sessionDigest:id.replaceAll('-','').padEnd(64,'0'),expiresAt:new Date('2035-01-01').getTime()}) as Actor;
  const ownerActor=actor(owner),store=poolStore(pool),inquiries=new BnaInquiryStore(store,workspace,ring,key,owner,clock,configuredBnaAcknowledgmentQueue({LS_BNA_EMAIL_QUEUE_ENABLED:'true',LS_BNA_EMAIL_QUEUE_SINCE:base.toISOString(),LS_BNA_EMAIL_SOURCE_SHA256:BNA_EMAIL_SOURCE},ring,key));
  const acknowledgment=new BnaAcknowledgmentStore(store,workspace,owner,ring,key,clock),basePrefs=new BnaPreferenceStore(store,workspace,owner,ring,key,clock,inquiries);
  const optionalAdmission:BnaOptionalAdmission={sourceSha256:BNA_EMAIL_SOURCE,postalAddress:'SYNTHETIC ONLY, 123 Test Street, Example',approvedCopies:Object.fromEntries(bnaEmailCandidates.messages.map(m=>[m.id,m.copySha256]))};
  const optionalSources=new BnaOptionalCalendarStore(store,workspace,owner,ring,key,clock,inquiries,basePrefs,()=>optionalAdmission);
  const replies=new BnaReplyStore(store,workspace,owner,ring,key,clock,{service:acknowledgment,optional:optionalSources},()=>({primaryMailbox:'synthetic-native-mailbox@example.invalid',monitorFrom:base.toISOString()}));
  const prefs=new BnaPreferenceStore(store,workspace,owner,ring,key,clock,inquiries,replies),calendar=new BnaOptionalCalendarStore(store,workspace,owner,ring,key,clock,inquiries,prefs,()=>optionalAdmission);
  const shared={name:'SYNTHETIC native adult',contactChannel:'email' as const,contact:'synthetic-native-adult@example.invalid',emailUpdates:true,language:'en' as const,siteLanguage:'en' as const};
  const co=await inquiries.submit({operationId:randomUUID(),fields:{...shared,townOrZip:'DO NOT COPY TOWN',childAges:[10],question:'DO NOT COPY CHILD NOTE',permission:{confirmed:true,version:BNA_COOP_NOTICE.version,language:'en'}}},BNA_COOP_PROGRAM);
  const support=await inquiries.submit({operationId:randomUUID(),fields:{...shared,purpose:'support_conversation',permission:{confirmed:true,version:BNA_SUPPORT_NOTICE.version,language:'en'},updatesPermission:{confirmed:true,channel:'email',version:BNA_SUPPORT_UPDATES_NOTICE.version,language:'en'}}},BNA_SUPPORT_PROGRAM);
  const delivery=await acknowledgment.readForInquiry(ownerActor,co.reference);if(!('messageId' in delivery))throw Error('native synthetic acknowledgment missing');
  expect(await acknowledgment.dispatch(delivery.messageId,{mode:'controlled_test',authorize:()=>true,send:async()=>({state:'accepted',providerId:'synthetic-native-send'})})).toBe('sent');
  const retained=(await query('SELECT to_jsonb(t) AS row FROM ls_service_interest.bna_inquiries t ORDER BY id')).rows;
  await expect(migrate({query},[...beforeFiles,{...proposal,sql:proposal.sql+'\nSELECT 1/0;'}],false)).rejects.toThrow('MIGRATION_FAILED');
  expect((await query("SELECT to_regclass('ls_service_interest.bna_mailbox_reply_receipts') AS relation")).rows[0].relation).toBeNull();
  expect((await query('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows).toEqual(baseline);
  expect(await migrate({query},db.inventory,false)).toEqual({applied:1,pending:0});expect(await migrate({query},db.inventory,false)).toEqual({applied:0,pending:0});
  expect(await bnaMailboxRepliesCatalogFingerprint({query})).toBe(BNA_MAILBOX_REPLIES_CATALOG_SHA256);expect(await readBnaMailboxRepliesSchemaStage({query})).toBe(1);
  expect(bnaMailboxRepliesSchemaPlan(db.inventory,baseline,0).pending.map(p=>p.name)).toEqual([proposal.name]);
  for(const change of [
   'ALTER TABLE ls_service_interest.bna_mailbox_monitor_events DISABLE TRIGGER bna_mailbox_monitor_sequence',
   'ALTER TABLE ls_service_interest.bna_mailbox_reply_reviews ALTER COLUMN recorded_at DROP NOT NULL',
   'GRANT SELECT ON ls_service_interest.bna_mailbox_reply_receipts TO PUBLIC',
   'GRANT EXECUTE ON FUNCTION ls_service_interest.check_bna_mailbox_monitor_event() TO PUBLIC',
   'ALTER FUNCTION ls_service_interest.check_bna_mailbox_reply_receipt() SECURITY DEFINER',
   'ALTER TABLE ls_service_interest.bna_mailbox_reply_receipts ENABLE ROW LEVEL SECURITY',
   'DROP TABLE ls_service_interest.bna_mailbox_monitor_events CASCADE',
  ]){await query('BEGIN');try{await query(change);await expect(readBnaMailboxRepliesSchemaStage({query})).rejects.toThrow('BNA_MAILBOX_REPLIES_SCHEMA_CATALOG_CONFLICT');}finally{await query('ROLLBACK');}}
  expect((await query('SELECT name,checksum FROM ls_control.migrations ORDER BY name')).rows.slice(0,69)).toEqual(baseline);
  now=new Date(base.getTime()+1000);const selection={kind:'service' as const,messageId:delivery.messageId};
  const reader=(providerMessageId:string,receivedAt=now.toISOString())=>({readRepliesForBinding:async(sources:readonly BnaSentReplySource[])=>sources.map(s=>({inquiryId:s.inquiryId,program:s.program,originalMessageId:s.messageId,providerMessageId,providerThreadId:'synthetic-native-thread',receivedAt}))});
  const firstReader=reader('synthetic-native-reply-one');
  const incoming=await Promise.all([replies.ingest([selection],firstReader),replies.ingest([selection],firstReader)]);
  expect(incoming.map(r=>r.received).sort()).toEqual([0,1]);expect(incoming.map(r=>r.replayed).sort()).toEqual([0,1]);
  const first=(await replies.readOwner(ownerActor,co.reference)).items[0]!;
  expect((await prefs.readOwner(ownerActor,co.reference)).preferences).toMatchObject({version:0,replyPending:true});
  expect((await prefs.readOwner(ownerActor,support.reference)).preferences.replyPending).toBe(false);
  expect(await replies.summariesForInquiries(ownerActor,[co.reference,support.reference])).toEqual({[co.reference]:{pending:1,latestReceivedAt:now.toISOString()},[support.reference]:{pending:0,latestReceivedAt:null}});
  const command={action:'mark_reviewed' as const,receiptId:first.id,operationId:randomUUID(),expectedVersion:1};now=new Date(now.getTime()+1000);
  await Promise.all([replies.markReviewed(ownerActor,command),replies.ingest([selection],reader('synthetic-native-reply-two'))]);
  expect((await replies.readOwner(ownerActor,co.reference)).items.map(r=>r.state)).toEqual(['pending','reviewed']);
  expect((await prefs.readOwner(ownerActor,co.reference)).preferences.replyPending).toBe(true);
  expect(await replies.markReviewed(ownerActor,command)).toMatchObject({replayed:true,version:2});expect(await replies.ingest([selection],firstReader)).toEqual({received:0,replayed:1});
  const second=(await replies.readOwner(ownerActor,co.reference)).items[0]!,reviewSecond={...command,receiptId:second.id,operationId:randomUUID()};
  const concurrentReview=await Promise.all([replies.markReviewed(ownerActor,reviewSecond),replies.markReviewed(ownerActor,reviewSecond)]);
  expect(concurrentReview.map(r=>r.replayed).sort()).toEqual([false,true]);expect((await prefs.readOwner(ownerActor,co.reference)).preferences.replyPending).toBe(false);
  now=new Date(base.getTime()+4*86400000);const prepared=await calendar.prepare(ownerActor,{action:'prepare',inquiryId:co.reference,operationId:randomUUID(),expectedPreferenceVersion:0,templateId:'EMAIL-B1'});expect(prepared.messageId).toBeTruthy();
  await replies.ingest([selection],reader('synthetic-native-reply-three'));
  let calls=0;const transport={authorize:()=>true,send:async()=>{calls++;return {state:'accepted' as const,providerId:'synthetic-native-optional'};}};
  expect(await calendar.dispatch(prepared.messageId!,transport)).toBe('prepared');expect(calls).toBe(0);
  const third=(await replies.readOwner(ownerActor,co.reference)).items[0]!;await expect(replies.markReviewed(actor(other),{...command,receiptId:third.id,operationId:randomUUID()})).rejects.toMatchObject({code:'NOT_FOUND'});
  await replies.markReviewed(ownerActor,{...command,receiptId:third.id,operationId:randomUUID()});expect(await calendar.dispatch(prepared.messageId!,transport)).toBe('sent');expect(calls).toBe(1);
  expect((await query('SELECT count(*)::int AS n FROM ls_service_interest.bna_mailbox_reply_receipts')).rows).toEqual([{n:3}]);
  expect((await query('SELECT count(*)::int AS n FROM ls_service_interest.bna_mailbox_reply_reviews')).rows).toEqual([{n:6}]);
  expect((await query('SELECT count(*)::int AS n FROM ls_service_interest.bna_email_preference_events')).rows).toEqual([{n:0}]);
  const binding={primaryMailbox:'synthetic-native-mailbox@example.invalid',monitorFrom:base.toISOString(),sourceSince:base.toISOString(),inquiryIds:[co.reference],policyDigest:'a'.repeat(64)};
  const catalog=new BnaReplySourceCatalog(workspace,owner,key,clock),monitor=new BnaReplyMonitorStore(store,workspace,owner,ring,key,clock,catalog,replies,()=>binding);
  const snapshot=await store.transaction(tx=>catalog.snapshot(tx,binding));expect(snapshot.selectors).toHaveLength(2);expect(snapshot.selectors.map(s=>s.kind).sort()).toEqual(['optional','service']);
  const quiet={readRepliesForBinding:async()=>[],verifyMailboxForBinding:async()=>({verified:true as const})};
  let release!:(value:Awaited<ReturnType<ReturnType<typeof reader>['readRepliesForBinding']>>)=>void,started!:()=>void;
  const ready=new Promise<void>(resolve=>{started=resolve;});
  const pending=monitor.runBatch({...quiet,readRepliesForBinding:async()=>{started();return new Promise<Awaited<ReturnType<ReturnType<typeof reader>['readRepliesForBinding']>>>(resolve=>{release=resolve;});}});
  await ready;expect(await monitor.runBatch(quiet)).toEqual({state:'busy'});now=new Date(now.getTime()+300001);
  expect((await monitor.status(ownerActor)).state).toBe('stale');expect(await monitor.runBatch(quiet)).toMatchObject({state:'completed',received:0});
  const source=await store.transaction(tx=>acknowledgment.replySource(tx,selection.messageId));release(await reader('synthetic-stale-must-rollback').readRepliesForBinding([source]));
  expect(await pending).toEqual({state:'superseded'});expect((await query('SELECT count(*)::int AS n FROM ls_service_interest.bna_mailbox_reply_receipts')).rows).toEqual([{n:3}]);
  expect((await monitor.status(ownerActor)).state).toBe('stale');await monitor.runBatch(quiet);expect((await monitor.status(ownerActor)).state).toBe('connected');
  let lose=true;
  const uncertain:IdentityStore={transaction:async fn=>{let completed=false;const value=await store.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
   const result=await tx.query<T>(sql,values);if(sql.startsWith('INSERT INTO ls_service_interest.bna_mailbox_monitor_events')&&values[11]==='completed')completed=true;return result;
  }}));if(completed&&lose){lose=false;throw Error('synthetic native committed response lost');}return value;}};
  const uncertainReplies=new BnaReplyStore(uncertain,workspace,owner,ring,key,clock,{service:acknowledgment,optional:optionalSources},()=>({primaryMailbox:binding.primaryMailbox,monitorFrom:binding.monitorFrom}));
  const uncertainMonitor=new BnaReplyMonitorStore(uncertain,workspace,owner,ring,key,clock,catalog,uncertainReplies,()=>binding);
  const controlledRead={...quiet,readRepliesForBinding:async(sources:readonly BnaSentReplySource[])=>reader('synthetic-native-reply-four').readRepliesForBinding(sources.filter(s=>s.messageId===selection.messageId))};
  expect(await uncertainMonitor.runBatch(controlledRead)).toEqual({state:'completed',received:1,replayed:0,reconciled:true});
  expect((await query('SELECT count(*)::int AS n FROM ls_service_interest.bna_mailbox_reply_receipts')).rows).toEqual([{n:4}]);
  expect((await query('SELECT count(*)::int AS n FROM ls_service_interest.bna_mailbox_reply_reviews')).rows).toEqual([{n:7}]);
  expect((await prefs.readOwner(ownerActor,co.reference)).preferences.replyPending).toBe(true);
  await expect(query('DELETE FROM ls_service_interest.bna_mailbox_monitor_events')).rejects.toThrow();await expect(query('TRUNCATE ls_service_interest.bna_mailbox_monitor_events')).rejects.toThrow();
  expect((await query('SELECT to_jsonb(t) AS row FROM ls_service_interest.bna_inquiries t ORDER BY id')).rows).toEqual(retained);
  expect((await query('SELECT count(*)::int AS n FROM ls_identity.people')).rows).toEqual([{n:2}]);
  const raw=(await query('SELECT payload_ciphertext FROM ls_service_interest.bna_mailbox_reply_receipts')).rows;expect(JSON.stringify(raw)).not.toMatch(/DO NOT COPY|example.invalid|synthetic-native-reply/);
  await expect(query('DELETE FROM ls_service_interest.bna_mailbox_reply_receipts')).rejects.toThrow();await expect(query('TRUNCATE ls_service_interest.bna_mailbox_reply_reviews')).rejects.toThrow();
 }finally{await pool.end();client.release();await db.close();}
},30000);
