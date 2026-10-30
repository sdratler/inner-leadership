/** Synthetic native browser seed only; no provider, live inbox or production
 * acceptance is represented by these deliberately labeled messages. */
import {createHash,randomBytes,randomUUID} from 'node:crypto';
import {poolStore,safeTestUrl,type Fixture} from '../../database/calendar/fixture.ts';
import {blindEmail,hashPassword,seal} from '../../../src/features/identity/crypto.ts';
import {ContactCutoverStore} from '../../../src/features/contact-ops/server/cutover-store.ts';
import {BnaInquiryStore} from '../../../src/features/bna-inquiry/store.ts';
import {BNA_COOP_NOTICE,BNA_COOP_PROGRAM} from '../../../src/features/bna-inquiry/coop-contract.ts';
import {BNA_SUPPORT_NOTICE,BNA_SUPPORT_PROGRAM} from '../../../src/features/bna-inquiry/support-contract.ts';
import {BNA_EMAIL_SOURCE} from '../../../src/features/bna-communications/delivery-policy.ts';
import {BnaAcknowledgmentStore,configuredBnaAcknowledgmentQueue} from '../../../src/features/bna-communications/acknowledgment-store.ts';
import {BnaPreferenceStore} from '../../../src/features/bna-communications/preferences-store.ts';
import {BnaOptionalCalendarStore} from '../../../src/features/bna-communications/optional-calendar-store.ts';
import {BnaReplyStore} from '../../../src/features/bna-communications/reply-store.ts';
import {academyCrmBrowserSnapshot,type AcademyCrmSnapshot} from './academy-crm-fixture.ts';
import {opaqueRateLimitKey} from '../../../src/lib/security/rate-limit.ts';
const hash=(x:unknown)=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const must=(value:unknown,code:string)=>{if(!value)throw Error('BNA_REPLIES_UI_'+code);};
export type BnaRepliesBrowserRuntime={credentials:{role:string;accountId:string;email:string;password:string}[];inquiries:{locale:'en'|'he';id:string;name:string;count:number}[]};
export async function bnaRepliesBrowserFixture(f:Fixture,lookupKey:Buffer):Promise<BnaRepliesBrowserRuntime>{
 safeTestUrl();must(process.env.LS_BNA_REPLIES_UI_ONLY==='true'&&process.env.LS_GROUP_INTEREST_TEST_ALLOW==='true','EXPLICIT_FIXTURE_REQUIRED');
 const credentials:BnaRepliesBrowserRuntime['credentials']=[];
 for(const [role,account] of [['practitioner',f.practitioner],['parent',f.parent]] as const){
  const email='synthetic-bna-replies-'+role+'@example.invalid',password=randomBytes(18).toString('base64url');
  await f.pool.query('UPDATE ls_identity.accounts SET password_hash=$3,email_blind=$4,email_ciphertext=$5 WHERE workspace_id=$1 AND id=$2',[f.workspaceId,account.actor.id,await hashPassword(password),blindEmail(email,lookupKey),seal(email,`email:${f.workspaceId}:${account.actor.id}`,f.keyring)]);
  credentials.push({role,accountId:account.actor.id,email,password});
 }
 const db=poolStore(f.pool),key=lookupKey.toString('hex'),clock={now:()=>new Date()},since=new Date(Date.now()-1000).toISOString();
 await new ContactCutoverStore(db,f.keyring,key).initializeAcademy(f.practitioner.actor,{operationId:randomUUID(),expectedEpoch:0,observedNativeWritesSinceSwitch:0,decisionId:'ACADEMY-ONLY-CRM-20261028-01',
  evidence:{retiredSourcesFence:'a'.repeat(64),retiredSchedulesFence:'b'.repeat(64),retainedAcademyRecords:'c'.repeat(64),queueReconciliation:'d'.repeat(64),restorePlan:'e'.repeat(64)}});
 const inquiries=new BnaInquiryStore(db,f.workspaceId,f.keyring,key,f.practitioner.actor.id,clock,configuredBnaAcknowledgmentQueue({LS_BNA_EMAIL_QUEUE_ENABLED:'true',LS_BNA_EMAIL_QUEUE_SINCE:since,LS_BNA_EMAIL_SOURCE_SHA256:BNA_EMAIL_SOURCE},f.keyring,key));
 const acknowledgments=new BnaAcknowledgmentStore(db,f.workspaceId,f.practitioner.actor.id,f.keyring,key,clock),preferences=new BnaPreferenceStore(db,f.workspaceId,f.practitioner.actor.id,f.keyring,key,clock,inquiries);
 const optional=new BnaOptionalCalendarStore(db,f.workspaceId,f.practitioner.actor.id,f.keyring,key,clock,inquiries,preferences);
 const replies=new BnaReplyStore(db,f.workspaceId,f.practitioner.actor.id,f.keyring,key,clock,{service:acknowledgments,optional},()=>({primaryMailbox:'synthetic-owner@example.invalid',monitorFrom:since}));
 const records:BnaRepliesBrowserRuntime['inquiries']=[];
 for(const locale of ['en','he'] as const){
  const name=locale==='en'?'Synthetic BNA closed co-op inquiry':'פניית תמיכה סינתטית סגורה',count=locale==='en'?51:1;
  const shared={name,contactChannel:'email' as const,contact:'synthetic-bna-'+locale+'@example.invalid',language:locale,siteLanguage:locale,emailUpdates:false};
  const saved=await inquiries.submit({operationId:randomUUID(),fields:locale==='en'?{...shared,townOrZip:'Synthetic Florida',childAges:[10],permission:{confirmed:true,version:BNA_COOP_NOTICE.version,language:locale}}:
   {...shared,purpose:'support_conversation',permission:{confirmed:true,version:BNA_SUPPORT_NOTICE.version,language:locale}}},locale==='en'?BNA_COOP_PROGRAM:BNA_SUPPORT_PROGRAM);
  await inquiries.followup(f.practitioner.actor,{inquiryId:saved.reference,operationId:randomUUID(),expectedVersion:1,status:'closed',note:'SYNTHETIC retained follow-up',nextAction:null,dueDate:null,waitingCondition:null});
  const queued=await acknowledgments.readForInquiry(f.practitioner.actor,saved.reference);if(!('messageId' in queued))throw Error('BNA_REPLIES_SYNTHETIC_QUEUE_MISSING');
  await acknowledgments.dispatch(queued.messageId,{mode:'controlled_test',authorize:()=>true,send:async()=>({state:'accepted',providerId:'synthetic-bna-sent-'+locale})});
  await replies.ingest([{kind:'service',messageId:queued.messageId}],{readRepliesForBinding:async([source])=>Array.from({length:count},(_,i)=>({inquiryId:source!.inquiryId,program:source!.program,originalMessageId:source!.messageId,providerMessageId:'synthetic-reply-'+locale+'-'+i,providerThreadId:'synthetic-thread-'+locale,receivedAt:new Date().toISOString()}))});
  records.push({locale,id:saved.reference,name,count});
 }
 return {credentials,inquiries:records};
}
export {academyCrmBrowserSnapshot as bnaRepliesBrowserSnapshot};
export async function verifyBnaRepliesBrowserEffects(f:Fixture,r:BnaRepliesBrowserRuntime,before:AcademyCrmSnapshot,rateKey:Buffer){
 const after=await academyCrmBrowserSnapshot(f),mutable=new Set(['ls_identity.sessions','ls_identity.action_history','ls_identity.foundation_audit','ls_service_interest.bna_mailbox_reply_reviews']);
 must(hash(before.otherWorkspaces)===hash(after.otherWorkspaces),'OTHER_WORKSPACE_CHANGED');
 for(const old of before.tables){const current=after.tables.find(t=>t.table===old.table);must(current,'TABLE_MISSING');if(!mutable.has(old.table))must(hash(old.rows)===hash(current!.rows),'UNRELATED_OR_PROVIDER_EFFECT:'+old.table);}
 for(const old of before.globalTables){const current=after.globalTables.find(t=>t.table===old.table);must(current,'GLOBAL_TABLE_MISSING');if(old.table!=='ls_identity.rate_counters')must(hash(old.rows)===hash(current!.rows),'GLOBAL_EFFECT:'+old.table);}
 const additions=(table:string)=>{const old=before.tables.find(t=>t.table===table)!.rows,current=after.tables.find(t=>t.table===table)!.rows;
  for(const prior of old)must(current.some(row=>hash(prior)===hash(row)),'PREEXISTING_ROW_CHANGED:'+table);return current.filter(row=>!old.some(prior=>hash(row)===hash(prior))).map(x=>x.row);};
 const reviews=additions('ls_service_interest.bna_mailbox_reply_reviews');must(reviews.length===2&&reviews.every(e=>e.version===2&&e.state==='reviewed'&&e.actor_account_id===f.practitioner.actor.id),'EXACT_OWNER_REVIEWS');
 const counts=(await f.pool.query('SELECT r.inquiry_id AS id,count(*)::int AS reviewed FROM ls_service_interest.bna_mailbox_reply_reviews e JOIN ls_service_interest.bna_mailbox_reply_receipts r ON r.workspace_id=e.workspace_id AND r.id=e.receipt_id WHERE e.workspace_id=$1 AND e.version=2 GROUP BY r.inquiry_id',[f.workspaceId])).rows;
 must(r.inquiries.every(i=>counts.find(c=>c.id===i.id)?.reviewed===1),'ONE_REVIEW_PER_PROGRAM');
 const owner=r.credentials.find(c=>c.role==='practitioner')!,parent=r.credentials.find(c=>c.role==='parent')!,sessions=additions('ls_identity.sessions'),actions=additions('ls_identity.action_history');
 must(sessions.length===5&&sessions.filter(s=>s.account_id===owner.accountId).length===4&&sessions.filter(s=>s.account_id===parent.accountId).length===1&&sessions.every(s=>s.revoked_at===null),'ORDINARY_SESSION_SET');
 must(actions.length===5&&actions.every(a=>a.action==='login_succeeded'&&[owner.accountId,parent.accountId].includes(String(a.actor_account_id))),'ORDINARY_LOGIN_ACTIONS');
 must(additions('ls_identity.foundation_audit').every(a=>a.kind==='access_denied'&&a.outcome==='denied'),'AUDIT_EFFECT');
 const oldRates=before.globalTables.find(t=>t.table==='ls_identity.rate_counters')!.rows,newRates=after.globalTables.find(t=>t.table==='ls_identity.rate_counters')!.rows;
 for(const old of oldRates)must(newRates.some(row=>hash(row)===hash(old)),'OLD_RATE_CHANGED');
 const scopes=['network:unattributed-shared-network','login-network:unattributed-shared-network',...r.credentials.flatMap(c=>['login-email:'+c.email,'account:'+c.accountId]),'bna-mailbox-review:'+f.workspaceId+':'+owner.accountId];
 const allowed=new Set(scopes.map(s=>opaqueRateLimitKey(s,rateKey.toString('hex'))));
 for(const {row} of newRates.filter(row=>!oldRates.some(old=>hash(old)===hash(row))))must(allowed.has(String(row.key_digest))&&Number.isInteger(row.count)&&Number(row.count)>0&&Number(row.count)<=200,'RATE_SCOPE');
}
