import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {afterAll,beforeAll,beforeEach,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
vi.mock('server-only',()=>({}));
import {BnaInquiryStore} from '../../src/features/bna-inquiry/store.ts';
import {BNA_COOP_NOTICE,BNA_COOP_PROGRAM} from '../../src/features/bna-inquiry/coop-contract.ts';
import {BNA_SUPPORT_NOTICE,BNA_SUPPORT_PROGRAM,BNA_SUPPORT_UPDATES_NOTICE} from '../../src/features/bna-inquiry/support-contract.ts';
import {BnaPreferenceStore} from '../../src/features/bna-communications/preferences-store.ts';
import {BnaOptionalCalendarStore,type BnaOptionalAdmission,type BnaOptionalTransport} from '../../src/features/bna-communications/optional-calendar-store.ts';
import {BNA_EMAIL_SOURCE} from '../../src/features/bna-communications/delivery-policy.ts';
import {bnaEmailCandidates} from '../../src/features/bna-communications/email-candidates.ts';
import {BNA_PREFERENCE_NOTICE} from '../../src/features/bna-communications/preferences-contract.ts';
import {asId} from '../../src/lib/ids.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
const db=new PGlite(),workspace=asId(randomUUID(),'workspace'),owner=randomUUID(),other=randomUUID(),DAY=86400000,base=new Date('2026-10-30T00:00:00Z');
let now=base;
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,29)}},key='synthetic-optional-calendar-private-key',clock={now:()=>now};
const adapter:IdentityStore={transaction:fn=>db.transaction(tx=>fn({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>
 (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const inquiries=new BnaInquiryStore(adapter,workspace,ring,key,owner,clock),prefs=new BnaPreferenceStore(adapter,workspace,owner,ring,key,clock,inquiries);
// TEST-ONLY sender facts: not real postal/provider/activation evidence.
const admission:BnaOptionalAdmission={sourceSha256:BNA_EMAIL_SOURCE,postalAddress:'SYNTHETIC ONLY, 123 Test Street, Example',approvedCopies:Object.fromEntries(bnaEmailCandidates.messages.map(m=>[m.id,m.copySha256]))};
const calendar=new BnaOptionalCalendarStore(adapter,workspace,owner,ring,key,clock,inquiries,prefs,()=>admission);
const disabled=new BnaOptionalCalendarStore(adapter,workspace,owner,ring,key,clock,inquiries,prefs);
const actor=(id:string)=>({id,workspaceId:workspace,personId:id,role:id===owner?'practitioner':'parent',state:'active',locale:'en',sessionDigest:id.replaceAll('-','').padEnd(64,'0'),expiresAt:new Date('2035-01-01').getTime()}) as Actor;
const ownerActor=actor(owner),otherActor=actor(other);
async function inquiry(email=randomUUID()+'@example.invalid',updates=true,support=false){
 const shared={name:'SYNTHETIC ADULT',contactChannel:'email' as const,contact:email,emailUpdates:updates,language:'en' as const,siteLanguage:'en' as const};
 return (await inquiries.submit({operationId:randomUUID(),fields:support?{...shared,purpose:'support_conversation',permission:{confirmed:true,version:BNA_SUPPORT_NOTICE.version,language:'en'},...(updates?{updatesPermission:{confirmed:true as const,channel:'email' as const,version:BNA_SUPPORT_UPDATES_NOTICE.version,language:'en' as const}}:{})}:
 {...shared,townOrZip:'DO NOT COPY TOWN',childAges:[10],question:'DO NOT COPY CHILD NOTE',permission:{confirmed:true,version:BNA_COOP_NOTICE.version,language:'en'}}},support?BNA_SUPPORT_PROGRAM:BNA_COOP_PROGRAM)).reference;
}
async function prepare(id:string,templateId:'EMAIL-B1'|'EMAIL-B2'|'EMAIL-S1'='EMAIL-B1',version=0){
 const result=await calendar.prepare(ownerActor,{action:'prepare',inquiryId:id,operationId:randomUUID(),templateId,expectedPreferenceVersion:version});
 if(!result.messageId)throw Error(JSON.stringify(result));return result.messageId;
}
const accepted=(onSend?:(m:Parameters<BnaOptionalTransport['send']>[0])=>void):BnaOptionalTransport=>({authorize:()=>true,send:async m=>{onSend?.(m);return {state:'accepted',providerId:'synthetic-'+randomUUID()};}});
beforeAll(async()=>{
 await db.exec('CREATE SCHEMA ls_control');
 for(const file of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0124_ls_group_interest.sql','0131_ls_public_group_applications.sql','0139_ls_bna_inquiries.sql','0142_ls_bna_coop_interest.sql','0144_ls_bna_support_interest.sql','0146_ls_bna_communication_delivery.sql','0148_ls_bna_email_preferences.sql','proposals/0149_ls_bna_optional_calendar.sql'])await db.exec(await readFile('migrations/'+file,'utf8'));
 await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,base]);
 for(const id of [owner,other]){
  const digest=id.replaceAll('-','').padEnd(64,'0');
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','synthetic',$3)",[id,workspace,base]);
  await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$5,'active','en',$3,'synthetic',$4,'synthetic',$4,$4)",[id,workspace,digest,base,id===owner?'practitioner':'parent']);
  await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)',[workspace,id]);
  await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[digest,workspace,id,base,new Date('2035-01-01')]);
 }
},30000);
beforeEach(()=>{now=base;});afterAll(()=>db.close());
it('owner preview reads actual permission without writing or exposing child details, recipient address or capabilities',async()=>{
 const id=await inquiry(undefined,false),before=(await db.query('SELECT count(*)::int AS n FROM ls_service_interest.bna_optional_messages')).rows;
 const preview=await disabled.readOwner(ownerActor,id);
 expect(preview).toMatchObject({sendingEnabled:false,preferenceVersion:0,next:{id:'EMAIL-B1',canPrepare:false,decision:{eligible:false,reason:'no_permission'}}});
 expect(JSON.stringify(preview)).not.toMatch(/DO NOT COPY|example.invalid|#token=|recipientKey|ciphertext/);
 expect((await db.query('SELECT count(*)::int AS n FROM ls_service_interest.bna_optional_messages')).rows).toEqual(before);
 await expect(disabled.readOwner(otherActor,id)).rejects.toMatchObject({code:'NOT_FOUND'});
 await expect(disabled.prepare(ownerActor,{action:'prepare',inquiryId:id,operationId:randomUUID(),templateId:'EMAIL-B1',expectedPreferenceVersion:0})).rejects.toMatchObject({code:'UNAVAILABLE'});
});
it('freezes one encrypted due message with a real personal-link footer and stable prepare replay',async()=>{
 const id=await inquiry();now=new Date(base.getTime()+4*DAY);
 const command={action:'prepare' as const,inquiryId:id,operationId:randomUUID(),templateId:'EMAIL-B1' as const,expectedPreferenceVersion:0};
 const first=await calendar.prepare(ownerActor,command);expect(first.messageId).toBeTruthy();expect(await calendar.prepare(ownerActor,command)).toEqual({...first,replayed:true});
 await expect(calendar.prepare(ownerActor,{...command,templateId:'EMAIL-B2'})).rejects.toMatchObject({code:'CONFLICT'});
 const raw=(await db.query('SELECT payload_ciphertext FROM ls_service_interest.bna_optional_messages WHERE id=$1',[first.messageId])).rows;
 expect(JSON.stringify(raw)).not.toMatch(/SYNTHETIC ADULT|example.invalid|token=|Test Street/);
 const frozen=await calendar.readOwner(ownerActor,id);expect(frozen.next).toMatchObject({frozen:true,messageId:first.messageId});
 expect(frozen.next?.body).toContain(admission.postalAddress);expect(frozen.next?.body).toContain('#token=[protected recipient link]');expect(frozen.next?.body).not.toMatch(/#token=[A-Za-z0-9_-]{100}/);
 let body='';expect(await calendar.dispatch(first.messageId!,accepted(m=>{body=m.payload.text;}))).toBe('sent');
 expect(body).toContain('https://bneineviimacademy.org/email-preferences#token=');expect(body).toContain(admission.postalAddress);expect(body).not.toMatch(/DO NOT COPY|\{\{/);
 expect((await db.query('SELECT count(*)::int AS n FROM ls_identity.people')).rows).toEqual([{n:2}]);
 expect((await db.query('SELECT count(*)::int AS n FROM ls_service_interest.bna_email_messages')).rows).toEqual([{n:0}]);
});
it('coordinates unknown effects, 48-hour spacing and a rolling seven-day cap across two programs',async()=>{
 const email=randomUUID()+'@example.invalid',coOp=await inquiry(email),support=await inquiry(email,true,true);now=new Date(base.getTime()+4*DAY);
 const b1=await prepare(coOp),s1=await prepare(support,'EMAIL-S1');
 let started!:()=>void,finish!:(v:{state:'accepted';providerId:string})=>void;const begun=new Promise<void>(r=>{started=r;}),response=new Promise<{state:'accepted';providerId:string}>(r=>{finish=r;});
 const sending=calendar.dispatch(b1,{authorize:()=>true,send:async()=>{started();return response;}});await begun;
 let calls=0;expect(await calendar.dispatch(s1,accepted(()=>{calls++;}))).toBe('prepared');expect(calls).toBe(0);
 expect((await calendar.readOwner(ownerActor,support)).next?.decision).toMatchObject({reason:'unknown_delivery'});
 finish({state:'accepted',providerId:'synthetic-shared-calendar'});expect(await sending).toBe('sent');
 expect(await calendar.dispatch(s1,accepted(()=>{calls++;}))).toBe('prepared');expect(calls).toBe(0);
 now=new Date(base.getTime()+6*DAY);expect(await calendar.dispatch(s1,accepted(()=>{calls++;}))).toBe('sent');
 now=new Date(base.getTime()+8*DAY);expect((await calendar.readOwner(ownerActor,coOp)).next?.decision).toMatchObject({reason:'weekly_cap',nextEligibleAt:new Date(base.getTime()+11*DAY).toISOString()});
 now=new Date(base.getTime()+11*DAY);expect((await calendar.readOwner(ownerActor,coOp)).next).toMatchObject({id:'EMAIL-B2',decision:{eligible:true}});
});
it('never retries an unknown effect, including after a timeout and owner cancellation',async()=>{
 const id=await inquiry();now=new Date(base.getTime()+4*DAY);const messageId=await prepare(id);let calls=0;
 expect(await calendar.dispatch(messageId,{authorize:()=>true,send:async()=>{calls++;throw Error('SYNTHETIC RESPONSE LOST');}})).toBe('unknown');
 expect(await calendar.dispatch(messageId,accepted(()=>{calls++;}))).toBe('unknown');expect(calls).toBe(1);
 await calendar.command(ownerActor,{action:'cancel',messageId,operationId:randomUUID(),expectedVersion:2});
 expect(await calendar.dispatch(messageId,accepted(()=>{calls++;}))).toBe('canceled_unknown');expect(calls).toBe(1);
 await expect(calendar.command(ownerActor,{action:'retry_not_attempted',messageId,operationId:randomUUID(),expectedVersion:3})).rejects.toMatchObject({code:'CONFLICT'});
});
it('retains late provider acceptance after owner cancellation of an in-flight reservation',async()=>{
 const id=await inquiry();now=new Date(base.getTime()+4*DAY);const messageId=await prepare(id);
 expect(await calendar.dispatch(messageId,{authorize:()=>true,send:async()=>{await calendar.command(ownerActor,{action:'cancel',messageId,operationId:randomUUID(),expectedVersion:2});return {state:'accepted',providerId:'synthetic-late-acceptance'};}})).toBe('sent');
 expect((await calendar.readOwner(ownerActor,id)).history[0]).toMatchObject({state:'sent',code:'PROVIDER_ACCEPTED_AFTER_CANCEL',version:4});
});
it('only retries a known not-attempted failure through an owner-versioned idempotent command',async()=>{
 const id=await inquiry();now=new Date(base.getTime()+4*DAY);const messageId=await prepare(id);
 expect(await calendar.dispatch(messageId,{authorize:()=>true,send:async()=>({state:'not_attempted'})})).toBe('failed');
 const command={action:'retry_not_attempted' as const,messageId,operationId:randomUUID(),expectedVersion:3};
 await expect(calendar.command(otherActor,command)).rejects.toMatchObject({code:'NOT_FOUND'});
 expect(await calendar.command(ownerActor,command)).toMatchObject({state:'prepared',replayed:false});expect(await calendar.command(ownerActor,command)).toMatchObject({state:'prepared',replayed:true});
 expect(await calendar.dispatch(messageId,accepted())).toBe('sent');
 expect(await calendar.command(ownerActor,command)).toMatchObject({state:'sent',replayed:true});
});
it.each(['withdraw_relationship','pause_all','record_reply','record_invalid','record_complaint'] as const)('suppresses a previously prepared message after %s without a provider effect',async action=>{
 const id=await inquiry();now=new Date(base.getTime()+4*DAY);const messageId=await prepare(id);
 await prefs.updateOwner(ownerActor,{inquiryId:id,operationId:randomUUID(),expectedVersion:0,action,note:'SYNTHETIC observed fact'});
 let calls=0;expect(await calendar.dispatch(messageId,accepted(()=>{calls++;}))).toBe('prepared');expect(calls).toBe(0);
});
it('does not deliver a stale-language preparation and permits a freshly frozen replacement after cancellation',async()=>{
 const id=await inquiry(),cap=await prefs.issueCapability(ownerActor,id);now=new Date(base.getTime()+4*DAY);const old=await prepare(id);
 await prefs.updateRecipient(cap.token,{inquiryId:id,operationId:randomUUID(),expectedVersion:0,action:'set_preferences',updates:true,locale:'he',noticeVersion:BNA_PREFERENCE_NOTICE.version,noticeLanguage:'he'});
 let calls=0;expect(await calendar.dispatch(old,accepted(()=>{calls++;}))).toBe('prepared');expect(calls).toBe(0);
 const cancel={action:'cancel' as const,messageId:old,operationId:randomUUID(),expectedVersion:1};await calendar.command(ownerActor,cancel);expect(await calendar.command(ownerActor,cancel)).toMatchObject({replayed:true});
 const replacement=await prepare(id,'EMAIL-B1',1);let lang='';expect(await calendar.dispatch(replacement,accepted(m=>{lang=m.payload.locale;}))).toBe('sent');expect(lang).toBe('he');
});
it('anchors a later explicit grant from that event rather than backdating to the original inquiry',async()=>{
 const id=await inquiry(undefined,false),cap=await prefs.issueCapability(ownerActor,id);now=new Date(base.getTime()+10*DAY);
 await prefs.updateRecipient(cap.token,{inquiryId:id,operationId:randomUUID(),expectedVersion:0,action:'set_preferences',updates:true,locale:'en',noticeVersion:BNA_PREFERENCE_NOTICE.version,noticeLanguage:'en'});
 expect((await calendar.readOwner(ownerActor,id)).next?.decision).toMatchObject({reason:'not_due',nextEligibleAt:new Date(base.getTime()+13*DAY).toISOString()});
 const result=await calendar.prepare(ownerActor,{action:'prepare',inquiryId:id,operationId:randomUUID(),templateId:'EMAIL-B1',expectedPreferenceVersion:1});expect(result).toMatchObject({blocked:{reason:'not_due'}});
 now=new Date(base.getTime()+13*DAY);expect(await prepare(id,'EMAIL-B1',1)).toBeTruthy();
});
it('does not invalidate a co-op preparation when only the separate support language changes',async()=>{
 const email=randomUUID()+'@example.invalid',coOp=await inquiry(email),support=await inquiry(email,true,true),cap=await prefs.issueCapability(ownerActor,support);
 now=new Date(base.getTime()+4*DAY);const messageId=await prepare(coOp);
 await prefs.updateRecipient(cap.token,{inquiryId:support,operationId:randomUUID(),expectedVersion:0,action:'set_preferences',updates:true,locale:'he',noticeVersion:BNA_PREFERENCE_NOTICE.version,noticeLanguage:'he'});
 let locale='';expect(await calendar.dispatch(messageId,accepted(m=>{locale=m.payload.locale;}))).toBe('sent');expect(locale).toBe('en');
 expect((await prefs.readOwner(ownerActor,support)).preferences.locale).toBe('he');
});
it('rechecks the actual closed follow-up before reserving a previously prepared message',async()=>{
 const id=await inquiry();now=new Date(base.getTime()+4*DAY);const messageId=await prepare(id);
 await inquiries.followup(ownerActor,{inquiryId:id,operationId:randomUUID(),expectedVersion:1,status:'closed',note:'SYNTHETIC closed outcome',nextAction:null,dueDate:null,waitingCondition:null});
 let calls=0;expect(await calendar.dispatch(messageId,accepted(()=>{calls++;}))).toBe('prepared');expect(calls).toBe(0);
 expect((await calendar.readOwner(ownerActor,id)).next?.decision).toMatchObject({reason:'closed'});
});
it('rechecks sender admission after reservation and records known no-send when it was revoked',async()=>{
 const id=await inquiry();now=new Date(base.getTime()+4*DAY);const messageId=await prepare(id);let active=true,calls=0;
 const guarded=new BnaOptionalCalendarStore(adapter,workspace,owner,ring,key,clock,inquiries,prefs,()=>active?admission:null);
 expect(await guarded.dispatch(messageId,{authorize:()=>{active=false;return true;},send:async()=>{calls++;return {state:'accepted',providerId:'must-not-send'};}})).toBe('failed');
 expect(calls).toBe(0);expect((await calendar.readOwner(ownerActor,id)).history[0]).toMatchObject({state:'failed',code:'PROVIDER_NOT_ATTEMPTED'});
});
it('database rejects mutable history, missing initial events, skipped versions and null-actor owner transitions',async()=>{
 const id=await inquiry();now=new Date(base.getTime()+4*DAY);const messageId=await prepare(id);
 await expect(db.query('UPDATE ls_service_interest.bna_optional_messages SET locale=\'he\' WHERE id=$1',[messageId])).rejects.toThrow();
 await expect(db.query('DELETE FROM ls_service_interest.bna_optional_events WHERE message_id=$1',[messageId])).rejects.toThrow();
 await expect(db.query('TRUNCATE ls_service_interest.bna_optional_events')).rejects.toThrow();
 const insert=`INSERT INTO ls_service_interest.bna_optional_events(workspace_id,message_id,version,operation_id,actor_account_id,state,code,recorded_at,reserved_at,provider_id,command_digest) VALUES($1,$2,$3,$4,NULL,'canceled','OWNER_CANCELED',$5,NULL,NULL,$6)`;
 await expect(db.query(insert,[workspace,messageId,3,randomUUID(),now,'a'.repeat(64)])).rejects.toThrow('BNA_OPTIONAL_EVENT_HISTORY_REQUIRED');
 await expect(db.query(insert,[workspace,messageId,2,randomUUID(),now,'a'.repeat(64)])).rejects.toThrow('BNA_OPTIONAL_TRANSITION_REJECTED');
});
