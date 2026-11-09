import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { asId } from '../../src/lib/ids.ts';
import { seal,unseal } from '../../src/features/identity/crypto.ts';
import type { IdentityStore } from '../../src/features/identity/store.ts';
import { groupApplicationPayloadAad,groupApplicationRequestDigest } from '../../src/features/group-application/group-application-record.ts';
import { currentTrip390Fields } from '../fixtures/trip390-current.ts';
import { requirePgliteMemoryEnvironment } from '../fixtures/pglite-memory-environment.ts';
import { InquiryEmailControlVerification,type InquiryEmailControlDelivery } from '../../src/features/group-application/academy-inquiry-email-verification.ts';
import { InquiryEmailControlOutbox } from '../../src/features/group-application/academy-inquiry-email-control-outbox.ts';
import { EMAIL_CONTROL_ADMISSION,EMAIL_CONTROL_SENDER,emailControlDigest,inquiryEmailControlSourceFiles } from '../../src/features/group-application/academy-inquiry-email-control-admission.ts';
vi.mock('server-only',() => ({}));
const db = new PGlite();
const age = 15*60*1000, ring = {activeKeyId:'fixture',keys:{fixture:Buffer.alloc(32,9)}};
const digestKey = 'synthetic verification request key for local SQL integration';
const purpose = 'fishing_inquiry_email_control_v1', old = 'academy_inquiry_acknowledgment_v1', owner = 'academy_owner_signup_notification';
const storage:IdentityStore = {transaction:work => db.transaction(tx => work({query:async <T extends object>(sql:string,values:readonly unknown[]=[]) => (await tx.query<T>(sql,[...values])).rows}))};
const network = vi.fn(async () => {throw Error('NETWORK_FORBIDDEN');});
beforeAll(async () => {
 requirePgliteMemoryEnvironment(process.env); vi.stubGlobal('fetch',network);
 await db.exec('CREATE SCHEMA ls_control');
 for (const file of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0124_ls_group_interest.sql','0131_ls_public_group_applications.sql','0135_ls_inquiry_email_outbox.sql','0136_ls_academy_founder.sql','0137_ls_academy_owner_notifications.sql','0151_ls_academy_inquiry_email_verification.sql','0152_ls_inquiry_email_control_outbox.sql'])
  await db.exec(await readFile('migrations/'+file,'utf8'));
});
afterAll(async () => {try {expect(network).not.toHaveBeenCalled();} finally {vi.unstubAllGlobals(); await db.close();}});

type Hooks = {oauth?:()=>Promise<void>;message?:()=>Promise<void>};
async function harness(hooks:Hooks={},store:IdentityStore=storage,securityLifetimeMs=age) {
 const workspace=asId(randomUUID(),'workspace'),time={millis:Date.now()+60000},clock={now:() => new Date(time.millis)};
 await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspace,clock.now()]);
 const verifier=new InquiryEmailControlVerification(store,{workspaceId:workspace,keyring:ring,requestDigestKey:digestKey,lookupKey:Buffer.alloc(32,7),securityLifetimeMs},clock);
 const target={workspaceId:workspace,projectId:randomUUID(),environmentId:randomUUID(),serviceId:randomUUID(),origin:'https://bneineviimacademy.org'};
 const fileHashes=Object.fromEntries(Object.entries(inquiryEmailControlSourceFiles).map(([key,file])=>[key,emailControlDigest(readFileSync(file,'utf8').replace(/\r\n/g,'\n'))]));
 const policy={...target,version:EMAIL_CONTROL_ADMISSION,purpose,sender:EMAIL_CONTROL_SENDER,securityLifetimeMs:age,approvalReceiptSha256:'b'.repeat(64),sourceCommit:'f'.repeat(40),sourceHashes:fileHashes,
  notBefore:new Date(time.millis-20000).toISOString(),admittedAt:new Date(time.millis-10000).toISOString(),expiresAt:null as string|null,population:{mode:'future_requests'} as {mode:string;requests?:{reference:string;recipientSha256:string}[]}};
 const env:Record<string,string>={LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ENABLED:'true',LS_ACADEMY_INQUIRY_EMAIL_CONTROL_QUEUE_ENABLED:'true',LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ADMISSION_JSON:JSON.stringify(policy),
  LS_ACADEMY_INQUIRY_EMAIL_CONTROL_SECURITY_LIFETIME_MS:String(age),LS_INQUIRY_EMAIL_SEND_ENABLED:'false',LS_ACADEMY_FREE_REGISTRATION_ENABLED:'false',
  LS_AUTH_EMAIL_ENABLED:'true',LS_AUTH_EMAIL_PROVIDER:'gmail',LS_AUTH_EMAIL_FROM:EMAIL_CONTROL_SENDER,LS_AUTH_GOOGLE_CLIENT_ID:'synthetic',LS_AUTH_GOOGLE_CLIENT_SECRET:'synthetic',LS_AUTH_GOOGLE_REFRESH_TOKEN:'synthetic',
  RAILWAY_GIT_COMMIT_SHA:policy.sourceCommit,LIFE_SKILLS_RELEASE_COMMIT:policy.sourceCommit,LS_IDENTITY_WORKSPACE_ID:workspace,RAILWAY_PROJECT_ID:target.projectId,
  RAILWAY_ENVIRONMENT_ID:target.environmentId,RAILWAY_SERVICE_ID:target.serviceId,LS_APP_ORIGIN:'https://life-skills.bneineviimacademy.org',LS_GROUP_APPLICATION_PUBLIC_ORIGIN:target.origin};
 const calls:{oauth:number;messages:string[]}={oauth:0,messages:[]};
 const isolated:typeof fetch=async (url,init) => {
  if (String(url)==='https://oauth2.googleapis.com/token') {calls.oauth++;await hooks.oauth?.();return Response.json({access_token:'synthetic'});}
  if(String(url)!=='https://gmail.googleapis.com/gmail/v1/users/me/messages/send') throw Error('UNEXPECTED_URL');
  const mime=Buffer.from(JSON.parse(String(init?.body)).raw,'base64url').toString('utf8');
  calls.messages.push(mime);await hooks.message?.();return Response.json({id:'synthetic_message_id'});
 };
 const outbox=new InquiryEmailControlOutbox({store,workspaceId:workspace,keyring:ring,requestDigestKey:digestKey,clock,verification:verifier},{env,fetch:isolated});
 return {workspace,time,clock,verifier,policy,env,calls,outbox};
}
type Fixture=Awaited<ReturnType<typeof harness>>;
async function signup(h:Fixture,locale:'en'|'he'='en',savedAt=new Date(h.time.millis-5000)) {
 const id=randomUUID(),operation=randomUUID(),fields=currentTrip390Fields();
 fields.email='contact-'+id+'@example.invalid'; fields.messageLanguage=locale; fields.guardianName='Miriam Example';
 fields.children=[{...fields.children[0]!,id:randomUUID(),name:'Ari Example'},{...fields.children[0]!,id:randomUUID(),name:'Dov Example'}];
 const digest=groupApplicationRequestDigest(h.workspace,fields,digestKey);
 await db.query(`INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[h.workspace,id,'a'.repeat(64),digest,seal(JSON.stringify(fields),groupApplicationPayloadAad(h.workspace,id),ring),fields.acknowledgment.version,fields.acknowledgment.language,savedAt]);
 await db.query('INSERT INTO ls_service_interest.public_application_operations(workspace_id,operation_id,request_digest,application_id,created_at) VALUES($1,$2,$3,$4,$5)',[h.workspace,operation,digest,id,savedAt]);
 return {id,fields};
}
type Stored={id:string;state:string;payload_ciphertext:string;control_delivery_ciphertext:string|null;provider_id:string|null;reserved_at:Date|null};
async function row(h:Fixture,reference:string,kind=purpose):Promise<Stored|undefined> {
 return (await db.query<Stored>('SELECT id,state,payload_ciphertext,control_delivery_ciphertext,provider_id,reserved_at FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2 AND purpose=$3',[h.workspace,reference,kind])).rows[0];
}
async function legacy(h:Fixture,ref:string,kind:string,state:'queued'|'unknown'|'sent'='queued') {
 await db.query('INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,purpose,payload_ciphertext,state,created_at,reserved_at,completed_at,provider_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
  [h.workspace,randomUUID(),ref,kind,'SYNTHETIC PRIOR BYTES',state,h.clock.now(),state==='queued'?null:h.clock.now(),state==='sent'?h.clock.now():null,state==='sent'?'prior_msg':null]);
}
function original(h:Fixture,stored:Stored) {
 return JSON.parse(unseal(stored.payload_ciphertext,'ls_service_interest/inquiry_email_control/outbox/v1/payload/'+h.workspace+'/'+stored.id,ring)) as
  {action:InquiryEmailControlDelivery;content:{subject:string;text:string;html:string;contentSha256:string};childIds:string[]};
}
describe('new inquiry verification email via real SQL/crypto and injected Gmail HTTP',() => {
 it.each(['en','he'] as const)('recovers a saved %s request, sends one email for both children and preserves the owner alert',async locale => {
  const h=await harness(),f=await signup(h,locale);await legacy(h,f.id,owner);
  const ownerBefore=await row(h,f.id,owner);
  expect(await row(h,f.id)).toBeUndefined();
  expect(await h.outbox.dispatchPage()).toEqual({examined:1,sent:1,next:null});
  const sent=(await row(h,f.id))!,frozen=original(h,sent);
  expect(sent).toMatchObject({state:'sent',provider_id:'synthetic_message_id'});
  expect(frozen.action.messageLanguage).toBe(locale);expect(frozen.childIds).toEqual(f.fields.children.map(c=>c.id));
  expect(frozen.content.text).toContain('Ari');expect(frozen.content.text).toContain('Dov');
  expect(h.calls.messages[0]).toContain('To: '+f.fields.email);
  expect(h.calls.messages[0]).toContain(Buffer.from(frozen.content.text).toString('base64').slice(0,40));
  expect(sent.payload_ciphertext).not.toContain(frozen.action.token);expect(sent.control_delivery_ciphertext).not.toContain(f.fields.email);
  expect(await h.outbox.dispatchForApplication(f.id)).toBe('sent');expect(await h.outbox.dispatchOne(sent.id)).toBe('sent');
  expect(h.calls.messages).toHaveLength(1);expect(await row(h,f.id,owner)).toEqual(ownerBefore);
  expect(await h.verifier.readEvidence(f.id)).toBeNull();
 });
 it.each(['queued','unknown','sent'] as const)('never issues a new parent email over a historical %s receipt',async state => {
  const h=await harness(),f=await signup(h);await legacy(h,f.id,old,state);
  const before=await row(h,f.id,old);
  expect(await h.outbox.dispatchForApplication(f.id)).toBe('held');expect((await h.outbox.dispatchPage()).examined).toBe(0);
  expect(await row(h,f.id)).toBeUndefined();expect(await row(h,f.id,old)).toEqual(before);expect(h.calls.oauth).toBe(0);
 });
 it('enforces controlled exact reference/recipient, new cutoff and tenant isolation before issuance',async () => {
  const h=await harness(),other=await harness(),good=await signup(h),bad=await signup(h),prior=await signup(h,'en',new Date(Date.parse(h.policy.notBefore)-1));
  h.policy.population={mode:'controlled_test',requests:[{reference:good.id,recipientSha256:emailControlDigest(good.fields.email)},{reference:bad.id,recipientSha256:emailControlDigest('other@example.invalid')}]};
  h.policy.expiresAt=new Date(h.time.millis+10000).toISOString();h.env.LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ADMISSION_JSON=JSON.stringify(h.policy);
  expect(await h.outbox.prepareForApplication(bad.id)).toBe('held');expect(await h.outbox.prepareForApplication(prior.id)).toBe('held');
  expect(await other.outbox.prepareForApplication(good.id)).toBe('held');
  expect(await h.outbox.prepareForApplication(good.id)).toBe('queued');
  expect(await other.outbox.dispatchOne((await row(h,good.id))!.id)).toBe('held');
  expect((await h.outbox.dispatchPage()).sent).toBe(1);expect(h.calls.messages).toHaveLength(1);expect(other.calls.oauth).toBe(0);
 });
 it('serializes competing dispatches and retains UNKNOWN on ambiguous provider response',async () => {
  let release!:()=>void,start!:()=>void;
  const waiting=new Promise<void>(resolve=>{release=resolve;}),started=new Promise<void>(resolve=>{start=resolve;});
  const h=await harness({message:async()=>{start();await waiting;throw Error('synthetic lost response');}}),f=await signup(h);
  expect(await h.outbox.prepareForApplication(f.id)).toBe('queued');const id=(await row(h,f.id))!.id;
  const first=h.outbox.dispatchOne(id);
  await Promise.race([started,first.then(()=>{throw Error('send did not start');})]);
  try {expect(await h.outbox.dispatchOne(id)).toBe('unknown');} finally {release();}
  expect(await first).toBe('unknown');expect(await h.outbox.dispatchForApplication(f.id)).toBe('unknown');
  expect((await row(h,f.id))?.provider_id).toBeNull();expect(h.calls.messages).toHaveLength(1);
 });
 it('rejects SQL state/timestamp rewind and lifecycle/receipt transplant without a second send',async () => {
  const h=await harness({message:async()=>{throw Error('synthetic lost response');}}),f=await signup(h),second=await signup(h);
  expect(await h.outbox.dispatchForApplication(f.id)).toBe('unknown');const attempted=(await row(h,f.id))!;
  await db.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='queued',reserved_at=NULL WHERE id=$1",[attempted.id]);
  expect(await h.outbox.dispatchOne(attempted.id)).toBe('held');
  expect(await h.outbox.prepareForApplication(second.id)).toBe('queued');const next=(await row(h,second.id))!;
  await db.query('UPDATE ls_service_interest.inquiry_email_outbox SET control_delivery_ciphertext=$2 WHERE id=$1',[next.id,attempted.control_delivery_ciphertext]);
  expect(await h.outbox.dispatchOne(next.id)).toBe('held');expect(h.calls.messages).toHaveLength(1);
 });
 it.each(['consumed','revoked','expired','policy_off','source_mismatch'] as const)('rechecks %s after OAuth before any Gmail message POST',async kind => {
  let after=async()=>{};
  const h=await harness({oauth:()=>after()}),f=await signup(h);
  expect(await h.outbox.prepareForApplication(f.id)).toBe('queued');
  const queued=(await row(h,f.id))!,a=original(h,queued).action;
  after=async()=>{
   if(kind==='consumed') expect((await h.verifier.confirmPost({method:'POST',token:a.token})).state).toBe('confirmed');
   else if(kind==='revoked') await h.verifier.revoke(f.id);
   else if(kind==='expired') h.time.millis=Date.parse(a.expiresAt);
   else if(kind==='policy_off') h.env.LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ENABLED='false';
   else h.env.LIFE_SKILLS_RELEASE_COMMIT='0'.repeat(40);
  };
  expect(await h.outbox.dispatchOne(queued.id)).toBe('unknown');expect(h.calls.oauth).toBe(1);expect(h.calls.messages).toHaveLength(0);
  expect((await row(h,f.id))?.state).toBe('unknown');
 });
 it('rolls back verification plus callback on invalid delivery and retains the previously committed lead',async () => {
  const h=await harness(),f=await signup(h);
  await expect(h.verifier.issue(f.id,(tx,a)=>h.outbox.queue(tx,{...a,recipient:'different@example.invalid'}))).rejects.toThrow();
  expect(await row(h,f.id)).toBeUndefined();
  expect((await db.query('SELECT id FROM ls_service_interest.inquiry_email_control_verifications WHERE workspace_id=$1 AND application_id=$2',[h.workspace,f.id])).rows).toHaveLength(0);
  expect((await db.query('SELECT id FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2',[h.workspace,f.id])).rows).toHaveLength(1);
  expect(await h.outbox.dispatchForApplication(f.id)).toBe('sent');
 });
 it('keeps original authenticated sent receipt immutable and denies ciphertext or indexed sub-millisecond corruption',async () => {
  const h=await harness(),f=await signup(h);
  expect(await h.outbox.dispatchForApplication(f.id)).toBe('sent');
  const sent=(await row(h,f.id))!;
  await db.query("UPDATE ls_service_interest.inquiry_email_outbox SET completed_at=completed_at+interval '1 microsecond' WHERE id=$1",[sent.id]);
  expect(await h.outbox.dispatchOne(sent.id)).toBe('held');
  await db.query("UPDATE ls_service_interest.inquiry_email_outbox SET payload_ciphertext='damaged' WHERE id=$1",[sent.id]);
  expect(await h.outbox.dispatchOne(sent.id)).toBe('held');expect(h.calls.messages).toHaveLength(1);
 });
 it('prevents an R2 receipt insertion racing a committed verification queue and permits an independent owner alert',async () => {
  const h=await harness(),f=await signup(h);
  expect(await h.outbox.prepareForApplication(f.id)).toBe('queued');
  await expect(legacy(h,f.id,old)).rejects.toThrow();
  await legacy(h,f.id,owner);expect((await row(h,f.id,owner))?.state).toBe('queued');
  expect(h.calls.oauth).toBe(0);
 });

 it('pages a bounded tied-timestamp backlog and excludes pre-cutoff applications with no prior mail',async () => {
  const h=await harness(),older=await signup(h,'en',new Date(Date.parse(h.policy.notBefore)-1));
  for(let n=0;n<12;n++) await signup(h);
  const first=await h.outbox.dispatchPage();
  expect(first).toMatchObject({examined:10,sent:10});expect(first.next).not.toBeNull();
  expect(await h.outbox.dispatchPage(first.next!)).toEqual({examined:2,sent:2,next:null});
  expect(await h.outbox.dispatchPage()).toEqual({examined:0,sent:0,next:null});
  expect(await h.outbox.prepareForApplication(older.id)).toBe('held');expect(await row(h,older.id)).toBeUndefined();
  expect(h.calls.messages).toHaveLength(12);
 });

 it.each(['unknown','sent'] as const)('recovers the truthful %s state when the local commit response is lost',async phase => {
  let armed=true;
  const broken:IdentityStore={transaction:async work=>{
   let matching=false;
   const result=await db.transaction(tx=>work({query:async <T extends object>(sql:string,values:readonly unknown[]=[])=>{
    if(sql.startsWith('UPDATE ls_service_interest.inquiry_email_outbox SET state=') && values[4]===phase) matching=true;
    return (await tx.query<T>(sql,[...values])).rows;
   }}));
   if(armed && matching){armed=false;throw Error('synthetic commit reply lost');}
   return result;
  }};
  const h=await harness({},broken),f=await signup(h);
  expect(await h.outbox.dispatchForApplication(f.id)).toBe(phase);
  expect((await row(h,f.id))?.state).toBe(phase);expect(await h.outbox.dispatchForApplication(f.id)).toBe(phase);
  expect(h.calls.messages).toHaveLength(phase==='unknown'?0:1);
 });

 it('denies a stale issuer lifetime and preserves the source inquiry',async () => {
  const h=await harness({},storage,age+60000),f=await signup(h);
  expect(await h.outbox.prepareForApplication(f.id)).toBe('held');expect(await row(h,f.id)).toBeUndefined();
  expect((await db.query('SELECT id FROM ls_service_interest.public_applications WHERE id=$1',[f.id])).rows).toHaveLength(1);
 });

 it('a controlled permit that expires during OAuth never reaches the message endpoint',async () => {
  const h=await harness({oauth:async()=>{h.time.millis+=4000;}}),f=await signup(h);
  h.policy.population={mode:'controlled_test',requests:[{reference:f.id,recipientSha256:emailControlDigest(f.fields.email)}]};
  h.policy.expiresAt=new Date(h.time.millis+3000).toISOString();h.env.LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ADMISSION_JSON=JSON.stringify(h.policy);
  expect(await h.outbox.dispatchForApplication(f.id)).toBe('unknown');expect(h.calls.oauth).toBe(1);expect(h.calls.messages).toHaveLength(0);
 });
it('reports the actual queue when the issuance commit response is lost before transport',async () => {
 let armed=true;
 const interrupted:IdentityStore={transaction:async work=>{
  let inserted=false;
  const result=await db.transaction(tx=>work({query:async <T extends object>(sql:string,values:readonly unknown[]=[])=>{
   if(sql.includes('INSERT INTO ls_service_interest.inquiry_email_outbox')) inserted=true;
   return (await tx.query<T>(sql,[...values])).rows;
  }}));
  if(armed&&inserted){armed=false;throw Error('synthetic lost issuance commit reply');}
  return result;
 }};
 const h=await harness({},interrupted),f=await signup(h);
 const returned=await h.outbox.prepareForApplication(f.id);
 expect((await row(h,f.id))?.state).toBe('queued');
 expect(returned).toBe('queued');
 expect(h.calls.oauth).toBe(0);
});
});
