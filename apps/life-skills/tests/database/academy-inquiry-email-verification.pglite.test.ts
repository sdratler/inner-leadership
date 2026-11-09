import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {afterAll,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {currentTrip390Fields} from '../fixtures/trip390-current.ts';
vi.mock('server-only',()=>({}));
import {asId} from '../../src/lib/ids.ts';
import {opaqueToken,tokenDigest,seal,unseal} from '../../src/features/identity/crypto.ts';
import type {IdentityStore} from '../../src/features/identity/store.ts';
import {groupApplicationPayloadAad,groupApplicationRequestDigest} from '../../src/features/group-application/group-application-record.ts';
import {InquiryEmailControlVerification,inquiryEmailControlPreview,INQUIRY_EMAIL_CONTROL_PURPOSE,INQUIRY_EMAIL_CONTROL_VERSION,type InquiryEmailControlConfig,type InquiryEmailControlDelivery,type EnqueueInquiryEmailControl} from '../../src/features/group-application/academy-inquiry-email-verification.ts';

// Actual SQL/crypto, no DSN, app server, auth account, URL or real mail.
// PGlite serializes transactions: the contenders below are not a competing
// PostgreSQL/MVCC/deadlock proof and must never be reported as one.
const db=new PGlite(),workspace=asId(randomUUID(),'workspace'),otherWorkspace=asId(randomUUID(),'workspace');
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,5)}},digestKey='synthetic-inquiry-request-key-at-least-32',lookupKey=Buffer.alloc(32,8);
let millis=Date.now(),transactions=0;
const statements:{sql:string;values:readonly unknown[]}[]=[],actions:InquiryEmailControlDelivery[]=[];
const clock={now:()=>new Date(millis)},network=vi.fn(async()=>{throw Error('REAL_NETWORK_NOT_ADMITTED');});
const store:IdentityStore={transaction:work=>{transactions++;return db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{statements.push({sql,values});return (await tx.query<T>(sql,[...values])).rows;}}));}};
const config:InquiryEmailControlConfig={workspaceId:workspace,keyring:ring,requestDigestKey:digestKey,lookupKey,securityLifetimeMs:15*60*1000};
const service=(overrides:Partial<InquiryEmailControlConfig>={})=>new InquiryEmailControlVerification(store,{...config,...overrides},clock);
const enqueue:EnqueueInquiryEmailControl=async(tx,action)=>{
 actions.push(action);
 // Test-only encrypted callback row. Production codec/queue/sender stay Root's.
 await tx.query('INSERT INTO test_email_actions(id,application_id,payload_ciphertext) VALUES($1,$2,$3)',[action.deliveryIntentId,action.applicationId,seal(JSON.stringify(action),'synthetic-action:'+action.deliveryIntentId,ring)]);
};
async function inquiry(overrides:Partial<ReturnType<typeof currentTrip390Fields>>={},corrupt:'hmac'|'cipher'|null=null){
 const id=randomUUID(),fields={...currentTrip390Fields(),guardianName:'Synthetic Mailbox '+randomUUID(),email:`synthetic-${randomUUID()}@example.invalid`,...overrides};
 const digest=groupApplicationRequestDigest(workspace,fields,digestKey),storedDigest=corrupt==='hmac'?createHash('sha256').update('invalid-synthetic-request:'+id).digest('hex'):digest,payload=seal(JSON.stringify(fields),groupApplicationPayloadAad(workspace,id),ring);
 await db.query(`INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[workspace,id,'a'.repeat(64),storedDigest,corrupt==='cipher'?'not-an-aead-envelope':payload,fields.acknowledgment.version,fields.acknowledgment.language,new Date()]);
 return {id,fields,digest,storedDigest};
}
async function row(reference:string){return (await db.query<{id:string;token_digest:string;email_blind:string;source_request_digest:string;consumed_at:Date|null;revoked_at:Date|null;issued_at:Date;expires_at:Date;issuance_ciphertext:string;lifecycle_ciphertext:string}>(`SELECT * FROM ls_service_interest.inquiry_email_control_verifications WHERE workspace_id=$1 AND application_id=$2`,[workspace,reference])).rows[0]!;}
const actionFor=(reference:string)=>actions.find(a=>a.applicationId===reference)!;
const confirm=(token:string)=>({method:'POST',token});
const deliveryCurrent=(action:InquiryEmailControlDelivery,instance=service())=>store.transaction(tx=>instance.isDeliveryCurrent(tx,action));
beforeAll(async()=>{
 requirePgliteMemoryEnvironment(process.env);vi.stubGlobal('fetch',network);
 await db.exec('CREATE SCHEMA ls_control');
 const base=process.env.JLFA_VERIFICATION_TEST_BASE_APP??process.cwd();
 for(const name of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0124_ls_group_interest.sql','0131_ls_public_group_applications.sql','0135_ls_inquiry_email_outbox.sql'])await db.exec(await readFile(base+'/migrations/'+name,'utf8'));
 await db.exec(await readFile(new URL('../../migrations/0151_ls_academy_inquiry_email_verification.sql',import.meta.url),'utf8'));
 for(const id of [workspace,otherWorkspace])await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[id,new Date()]);
 await db.exec('CREATE TABLE test_email_actions(id uuid PRIMARY KEY,application_id uuid NOT NULL,payload_ciphertext text NOT NULL)');
},25000);
beforeEach(()=>{millis=Date.now();});
afterAll(async()=>{try{expect(network).not.toHaveBeenCalled();await db.close();}finally{vi.unstubAllGlobals();}});

describe('purpose-bound saved-inquiry inbox control',()=>{
 it('issues one encrypted callback intent, preserving the exact saved recipient/message locale and no public bearer',async()=>{
  const saved=await inquiry({messageLanguage:'en',instructionLanguage:'he'}),issued=await service().issue(saved.id,enqueue),action=actionFor(saved.id),stored=await row(saved.id);
  expect(issued.state).toBe('queued');expect(action).toMatchObject({applicationId:saved.id,recipient:saved.fields.email,messageLanguage:'en',sourceDigest:saved.digest,purpose:INQUIRY_EMAIL_CONTROL_PURPOSE,version:INQUIRY_EMAIL_CONTROL_VERSION});
  if(issued.state==='closed')throw Error('EXPECTED_QUEUED');
  expect(action.token).toMatch(/^[A-Za-z0-9_-]{43}$/);expect(stored.token_digest).toBe(tokenDigest(action.token));
  expect(JSON.stringify(stored)).not.toContain(action.token);expect(JSON.stringify(stored)).not.toContain(saved.fields.email);expect(JSON.stringify(issued)).not.toContain(action.token);
  expect(JSON.stringify(statements)).not.toContain(action.token);
  const sealed=(await db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM test_email_actions WHERE id=$1',[issued.deliveryIntentId])).rows[0]!.payload_ciphertext;
  expect(sealed).not.toContain(action.token);expect(JSON.parse(unseal(sealed,'synthetic-action:'+issued.deliveryIntentId,ring))).toEqual(action);
  expect(await service().readEvidence(saved.id)).toBeNull();
 });
 it('preserves original intent/token expiry on exact issuance retry with no second callback',async()=>{
  const saved=await inquiry(),first=await service().issue(saved.id,enqueue),token=actionFor(saved.id).token;
  millis+=60_000;const second=await service().issue(saved.id,enqueue);
  expect(second).toEqual({...first,state:'already_issued'});expect(actionFor(saved.id).token).toBe(token);expect(actions.filter(a=>a.applicationId===saved.id)).toHaveLength(1);
  expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM test_email_actions WHERE application_id=$1',[saved.id])).rows[0]!.n).toBe(1);
 });
 it('GET/scanner preview is generic and DB-free; GET cannot consume a valid token',async()=>{
  const saved=await inquiry(),issued=await service().issue(saved.id,enqueue),token=actionFor(saved.id).token,before=transactions;
  if(issued.state==='closed')throw Error('EXPECTED_QUEUED');
  expect(inquiryEmailControlPreview()).toEqual({state:'explicit_confirmation_required',proves:'nothing_before_confirmation'});expect(transactions).toBe(before);
  await expect(service().confirmPost({method:'GET',token})).rejects.toMatchObject({code:'INVALID_REQUEST'});expect(transactions).toBe(before);
  expect(await row(saved.id)).toMatchObject({id:issued.verificationId,consumed_at:null});expect(await service().readEvidence(saved.id)).toBeNull();
 });
 it('consumes explicitly once and returns only narrow dated evidence; replay adds no state or intent',async()=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);const action=actionFor(saved.id);
  expect(await service().confirmPost(confirm(action.token))).toEqual({state:'confirmed'});const at=(await row(saved.id)).consumed_at;
  expect(await service().confirmPost(confirm(action.token))).toEqual({state:'already_used'});expect((await row(saved.id)).consumed_at).toEqual(at);
  const evidence=await service().readEvidence(saved.id);expect(evidence).toMatchObject({kind:'inquiry_mailbox_control_only',applicationId:saved.id,sourceDigest:saved.digest,messageLanguage:saved.fields.messageLanguage});
  expect(JSON.stringify(evidence)).not.toContain(action.token);expect(JSON.stringify(evidence)).not.toContain(saved.fields.email);
  expect(evidence).not.toHaveProperty('guardian');expect(evidence).not.toHaveProperty('accountId');expect(evidence).not.toHaveProperty('financialAdmission');
  expect(actions.filter(a=>a.applicationId===saved.id)).toHaveLength(1);
 });
 it('serializes PGlite contenders through actual SQL and confirms only once (not real-PG concurrency proof)',async()=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);const token=actionFor(saved.id).token;
  const results=await Promise.all(Array.from({length:6},()=>service().confirmPost(confirm(token))));
  expect(results.filter(r=>r.state==='confirmed')).toHaveLength(1);expect(results.filter(r=>r.state==='already_used')).toHaveLength(5);
  expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM ls_service_interest.inquiry_email_control_verifications WHERE application_id=$1 AND consumed_at IS NOT NULL',[saved.id])).rows[0]!.n).toBe(1);
 });
 it('rolls back token+encrypted queue on a real SQL error while preserving the already saved inquiry',async()=>{
  const saved=await inquiry();const failing:EnqueueInquiryEmailControl=async(tx,action)=>{await enqueue(tx,action);await tx.query('SELECT 1/0');};
  await expect(service().issue(saved.id,failing)).rejects.toThrow();
  expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM ls_service_interest.public_applications WHERE id=$1',[saved.id])).rows[0]!.n).toBe(1);
  expect((await db.query('SELECT id FROM ls_service_interest.inquiry_email_control_verifications WHERE application_id=$1',[saved.id])).rows).toEqual([]);
  expect((await db.query('SELECT id FROM test_email_actions WHERE application_id=$1',[saved.id])).rows).toEqual([]);
  expect((await service().issue(saved.id,enqueue)).state).toBe('queued');
  expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM test_email_actions WHERE application_id=$1',[saved.id])).rows[0]!.n).toBe(1);
 });
 it('requires explicit bounded security TTL and never uses payment/interest deadlines or a24h default',()=>{
  for(const securityLifetimeMs of [0,-1,Number.NaN,Number.POSITIVE_INFINITY,24*60*60*1000+1])expect(()=>service({securityLifetimeMs})).toThrow();
  expect(()=>new InquiryEmailControlVerification(store,{...config,securityLifetimeMs:undefined} as unknown as InquiryEmailControlConfig,clock)).toThrow();
 });
 it('expires without consuming, refreshing or resending; a backdated service clock cannot revive an expired capability',async()=>{
  const saved=await inquiry(),short=service({securityLifetimeMs:1000});await short.issue(saved.id,enqueue);const token=actionFor(saved.id).token;
  millis+=2000;expect(await short.confirmPost(confirm(token))).toEqual({state:'not_available'});expect((await short.issue(saved.id,enqueue)).state).toBe('closed');
  // Real DB expiry independently dominates a supplied old clock.
  await db.query("UPDATE ls_service_interest.inquiry_email_control_verifications SET issued_at=clock_timestamp()-interval '2minutes',expires_at=clock_timestamp()-interval '1minute' WHERE application_id=$1",[saved.id]);millis-=3600_000;
  expect(await short.confirmPost(confirm(token))).toEqual({state:'not_available'});expect((await row(saved.id)).consumed_at).toBeNull();expect(actions.filter(a=>a.applicationId===saved.id)).toHaveLength(1);
 });
 it('keeps dated proven mailbox evidence after token expiry without minting another capability',async()=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);await service().confirmPost(confirm(actionFor(saved.id).token));
  millis+=24*60*60*1000;expect(await service().confirmPost(confirm(actionFor(saved.id).token))).toEqual({state:'not_available'});expect((await service().readEvidence(saved.id))?.kind).toBe('inquiry_mailbox_control_only');expect((await service().issue(saved.id,enqueue)).state).toBe('already_confirmed');
 });
 it('revokes consumed or unused proof without erasing history or issuing a replacement',async()=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);const token=actionFor(saved.id).token;await service().confirmPost(confirm(token));const consumed=(await row(saved.id)).consumed_at;
  await service().revoke(saved.id);expect(await service().readEvidence(saved.id)).toBeNull();expect(await service().confirmPost(confirm(token))).toEqual({state:'not_available'});
  expect((await row(saved.id)).consumed_at).toEqual(consumed);expect((await row(saved.id)).revoked_at).not.toBeNull();expect((await service().issue(saved.id,enqueue)).state).toBe('closed');
 });
 it.each(['email_blind','source_request_digest','request_version','offer_version','message_language'] as const)('holds unauthenticated %s drift without re-signing altered data',async column=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);const value=column==='email_blind'||column==='source_request_digest'?'c'.repeat(64):column==='message_language'?'en':'DIFFERENT_SAVED_SOURCE';
  // Fixed test-only SQL choices, no arbitrary user identifier interpolation.
  const updates={email_blind:'UPDATE ls_service_interest.inquiry_email_control_verifications SET email_blind=$2 WHERE application_id=$1',source_request_digest:'UPDATE ls_service_interest.inquiry_email_control_verifications SET source_request_digest=$2 WHERE application_id=$1',request_version:'UPDATE ls_service_interest.inquiry_email_control_verifications SET request_version=$2 WHERE application_id=$1',offer_version:'UPDATE ls_service_interest.inquiry_email_control_verifications SET offer_version=$2 WHERE application_id=$1',message_language:'UPDATE ls_service_interest.inquiry_email_control_verifications SET message_language=$2 WHERE application_id=$1'};
  await db.query(updates[column],[saved.id,value]);expect(await service().confirmPost(confirm(actionFor(saved.id).token))).toEqual({state:'not_available'});
  expect((await row(saved.id)).revoked_at).toBeNull();expect((await row(saved.id)).consumed_at).toBeNull();expect(await service().readEvidence(saved.id)).toBeNull();expect(await service().issue(saved.id,enqueue)).toEqual({state:'closed'});
 });
 it('keeps the same email on a second inquiry unverified and rejects supplied cross-inquiry overrides',async()=>{
  const first=await inquiry(),second=await inquiry({email:first.fields.email});await service().issue(first.id,enqueue);const token=actionFor(first.id).token;
  await expect(service().confirmPost({...confirm(token),applicationId:second.id,email:second.fields.email})).rejects.toMatchObject({code:'INVALID_REQUEST'});
  expect(await service().confirmPost(confirm(token))).toEqual({state:'confirmed'});expect(await service().readEvidence(second.id)).toBeNull();
 });
 it('denies another workspace or wrong purpose and constrains persisted purpose/version without weakening SQL',async()=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);const token=actionFor(saved.id).token;
  expect(await service({workspaceId:otherWorkspace}).confirmPost(confirm(token))).toEqual({state:'not_available'});
  await expect(service().confirmPost({...confirm(token),purpose:'email_change'})).rejects.toMatchObject({code:'INVALID_REQUEST'});
  await expect(db.query("UPDATE ls_service_interest.inquiry_email_control_verifications SET purpose='trip390_completion' WHERE application_id=$1",[saved.id])).rejects.toThrow();
  await expect(db.query("UPDATE ls_service_interest.inquiry_email_control_verifications SET version='other' WHERE application_id=$1",[saved.id])).rejects.toThrow();
  expect((await row(saved.id)).consumed_at).toBeNull();
 });
 it.each(['hmac','cipher'] as const)('requires canonical decoder %s integrity before issuing or trusting a source digest',async corrupt=>{
  const saved=await inquiry({},corrupt);await expect(service().issue(saved.id,enqueue)).rejects.toMatchObject({code:'UNAVAILABLE'});
  expect((await db.query('SELECT id FROM ls_service_interest.inquiry_email_control_verifications WHERE application_id=$1',[saved.id])).rows).toEqual([]);
 });
 it('does not manufacture an inquiry, account, Person, parent portal or network effect',async()=>{
  await expect(service().issue(randomUUID(),enqueue)).rejects.toMatchObject({code:'NOT_FOUND'});
  for(const table of ['accounts','people'])expect((await db.query<{n:number}>('SELECT count(*)::int AS n FROM ls_identity.'+table)).rows[0]!.n).toBe(0);
  expect(network).not.toHaveBeenCalled();
 });
 it('preserves actual saved inquiry ciphertext and existing SENT/UNKNOWN ACK rows byte-for-byte',async()=>{
  const first=await inquiry(),second=await inquiry();
  for(const [saved,state] of [[first,'sent'],[second,'unknown']] as const)await db.query(`INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,purpose,payload_ciphertext,state,created_at,reserved_at,completed_at,provider_id) VALUES($1,$2,$3,'academy_inquiry_acknowledgment_v1',$4,$5,$6,$6,$7,$8)`,[workspace,randomUUID(),saved.id,seal('synthetic historical sealed '+state,'synthetic-history',ring),state,new Date(),state==='sent'?new Date():null,state==='sent'?'synthetic_sent_provider':null]);
  const before=JSON.stringify((await db.query('SELECT * FROM ls_service_interest.inquiry_email_outbox ORDER BY application_id')).rows);
  const sourceBefore=JSON.stringify((await db.query('SELECT id,payload_ciphertext,request_digest FROM ls_service_interest.public_applications ORDER BY id')).rows);
  for(const saved of [first,second]){await service().issue(saved.id,enqueue);await service().confirmPost(confirm(actionFor(saved.id).token));await service().revoke(saved.id);}
  expect(JSON.stringify((await db.query('SELECT * FROM ls_service_interest.inquiry_email_outbox ORDER BY application_id')).rows)).toBe(before);
  expect(JSON.stringify((await db.query('SELECT id,payload_ciphertext,request_digest FROM ls_service_interest.public_applications ORDER BY id')).rows)).toBe(sourceBefore);
 });
 it('rejects malformed tokens before SQL and never provides the submitted email or bearer through preview',async()=>{
  const before=transactions;for(const token of ['',opaqueToken().slice(1),'<script>'])await expect(service().confirmPost(confirm(token))).rejects.toMatchObject({code:'INVALID_REQUEST'});
  expect(transactions).toBe(before);expect(await service().confirmPost(confirm(opaqueToken()))).toEqual({state:'not_available'});
  expect(JSON.stringify(inquiryEmailControlPreview())).not.toContain('@');
 });
});

describe('same-TX delivery-current server port',()=>{
 it('rejects expiry during canonical source IO using a final trusted time check',async()=>{
  const saved=await inquiry(),instance=service({securityLifetimeMs:1000});await instance.issue(saved.id,enqueue);const action=actionFor(saved.id);let crossed=false;
  await store.transaction(async tx=>{
   const barrier={query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
    const rows=await tx.query<T>(sql,values);
    if(sql.includes('FROM ls_service_interest.public_applications')){millis=Date.parse(action.expiresAt)+1;crossed=true;}
    return rows;
   }};
   expect(await instance.isDeliveryCurrent(barrier,action)).toBe(false);
  });expect(crossed).toBe(true);
 });
 it('validates inside the issuance enqueue transaction and again before send without opening another transaction or mutating records',async()=>{
  const saved=await inquiry(),instance=service();let beforeCommit=false;
  await instance.issue(saved.id,async(tx,action)=>{beforeCommit=await instance.isDeliveryCurrent(tx,action);await enqueue(tx,action);});expect(beforeCommit).toBe(true);
  const action=actionFor(saved.id),before=JSON.stringify(await row(saved.id)),count=transactions;
  expect(await deliveryCurrent(action,instance)).toBe(true);expect(transactions).toBe(count+1);expect(JSON.stringify(await row(saved.id))).toBe(before);
  expect(JSON.stringify(statements)).not.toContain(action.token);
 });
 it.each(['token','recipient','language','source','request','offer','intent','expiry','inquiry','workspace','purpose','version','extra'] as const)('rejects forged %s delivery metadata before any transport',async field=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);const action=actionFor(saved.id);
  const changes={token:{token:opaqueToken()},recipient:{recipient:'forged@example.invalid'},language:{messageLanguage:action.messageLanguage==='en'?'he':'en'},source:{sourceDigest:'d'.repeat(64)},request:{requestVersion:'other'},offer:{offerVersion:'other'},intent:{deliveryIntentId:randomUUID()},expiry:{expiresAt:new Date(Date.parse(action.expiresAt)+1).toISOString()},inquiry:{applicationId:randomUUID()},workspace:{workspaceId:otherWorkspace},purpose:{purpose:'email_change'},version:{version:'other'},extra:{extra:true}};
  expect(await deliveryCurrent({...action,...changes[field]} as InquiryEmailControlDelivery)).toBe(false);
 });
 it.each(['consumed','revoked','expired','index'] as const)('denies %s issuance at the terminal send check',async state=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);const action=actionFor(saved.id);
  if(state==='consumed')await service().confirmPost(confirm(action.token));
  else if(state==='revoked')await service().revoke(saved.id);
  else if(state==='expired')millis=Date.parse(action.expiresAt)+1;
  else await db.query('UPDATE ls_service_interest.inquiry_email_control_verifications SET token_digest=$2 WHERE application_id=$1',[saved.id,tokenDigest(opaqueToken())]);
  expect(await deliveryCurrent(action)).toBe(false);
 });
 it('denies corrupt canonical source in the same existing transaction',async()=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);const action=actionFor(saved.id),stored=await row(saved.id),corrupt=await inquiry({},'hmac');
  // Use only the synthetic test key to join a valid verification envelope to
  // an actually invalid immutable source row. The canonical source decoder
  // must still reject it. No mock decoder or disabled append-only trigger.
  const issueAad=`ls_service_interest/inquiry_email_control/issuance/v1/${workspace}/${stored.id}`,lifeAad=`ls_service_interest/inquiry_email_control/lifecycle/v1/${workspace}/${stored.id}`;
  const original={...JSON.parse(unseal(stored.issuance_ciphertext,issueAad,ring)),applicationId:corrupt.id,sourceDigest:corrupt.storedDigest};
  const state={...JSON.parse(unseal(stored.lifecycle_ciphertext,lifeAad,ring)),issuance:original};
  await db.query('UPDATE ls_service_interest.inquiry_email_control_verifications SET application_id=$2,source_request_digest=$3,issuance_ciphertext=$4,lifecycle_ciphertext=$5 WHERE id=$1',[stored.id,corrupt.id,original.sourceDigest,seal(JSON.stringify(original),issueAad,ring),seal(JSON.stringify(state),lifeAad,ring)]);
  expect(await deliveryCurrent({...action,applicationId:corrupt.id,sourceDigest:original.sourceDigest})).toBe(false);
 });
});

describe('INQUIRY-EMAIL-CONTROL-R01 authenticated row corruption holdouts',()=>{
 it('rejects a chosen bearer substituted into the plaintext token index',async()=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);const attacker=opaqueToken();
  await db.query('UPDATE ls_service_interest.inquiry_email_control_verifications SET token_digest=$2 WHERE application_id=$1',[saved.id,tokenDigest(attacker)]);
  expect(await service().confirmPost(confirm(attacker))).toEqual({state:'not_available'});expect(await service().readEvidence(saved.id)).toBeNull();
 });
 it('rejects a fabricated plaintext consumed timestamp without the actual action',async()=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);
  await db.query('UPDATE ls_service_interest.inquiry_email_control_verifications SET consumed_at=issued_at WHERE application_id=$1',[saved.id]);
  expect(await service().readEvidence(saved.id)).toBeNull();
 });
 it('rejects a future plaintext consumed timestamp as mailbox proof',async()=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);
  await db.query("UPDATE ls_service_interest.inquiry_email_control_verifications SET consumed_at=issued_at+interval '1minute' WHERE application_id=$1",[saved.id]);
  expect(await service().readEvidence(saved.id)).toBeNull();
 });
 it.each(['expiry','issued','intent'] as const)('rejects altered original %s metadata before token consumption',async field=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);
  if(field==='expiry')await db.query("UPDATE ls_service_interest.inquiry_email_control_verifications SET expires_at=expires_at+interval '1minute' WHERE application_id=$1",[saved.id]);
  else if(field==='issued')await db.query("UPDATE ls_service_interest.inquiry_email_control_verifications SET issued_at=issued_at-interval '1minute' WHERE application_id=$1",[saved.id]);
  else await db.query('UPDATE ls_service_interest.inquiry_email_control_verifications SET delivery_intent_id=$2 WHERE application_id=$1',[saved.id,randomUUID()]);
  expect(await service().confirmPost(confirm(actionFor(saved.id).token))).toEqual({state:'not_available'});
 });
 it('does not revive a revoked unused bearer by clearing a plaintext flag',async()=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);await service().revoke(saved.id);
  await db.query('UPDATE ls_service_interest.inquiry_email_control_verifications SET revoked_at=NULL WHERE application_id=$1',[saved.id]);
  expect(await service().confirmPost(confirm(actionFor(saved.id).token))).toEqual({state:'not_available'});
 });
 it('does not fabricate revoked proof by clearing the plaintext revoked flag',async()=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);await service().confirmPost(confirm(actionFor(saved.id).token));await service().revoke(saved.id);
  await db.query('UPDATE ls_service_interest.inquiry_email_control_verifications SET revoked_at=NULL WHERE application_id=$1',[saved.id]);
  expect(await service().readEvidence(saved.id)).toBeNull();
 });
 it('does not roll an authenticated consumed lifecycle backwards using a plain flag',async()=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);const token=actionFor(saved.id).token;await service().confirmPost(confirm(token));
  await db.query('UPDATE ls_service_interest.inquiry_email_control_verifications SET consumed_at=NULL WHERE application_id=$1',[saved.id]);
  expect(await service().confirmPost(confirm(token))).toEqual({state:'not_available'});
 });
 it.each(['issuance','lifecycle'] as const)('rejects another inquiry’s %s ciphertext even with a valid server-key envelope',async kind=>{
  const first=await inquiry(),second=await inquiry();await service().issue(first.id,enqueue);await service().issue(second.id,enqueue);
  await service().confirmPost(confirm(actionFor(first.id).token));const source=await row(first.id);
  if(kind==='issuance')await db.query('UPDATE ls_service_interest.inquiry_email_control_verifications SET issuance_ciphertext=$2 WHERE application_id=$1',[second.id,source.issuance_ciphertext]);
  else await db.query('UPDATE ls_service_interest.inquiry_email_control_verifications SET lifecycle_ciphertext=$2 WHERE application_id=$1',[second.id,source.lifecycle_ciphertext]);
  expect(await service().confirmPost(confirm(actionFor(second.id).token))).toEqual({state:'not_available'});expect(await service().readEvidence(second.id)).toBeNull();expect(await service().issue(second.id,enqueue)).toEqual({state:'closed'});
 });
 it.each(['issuance','lifecycle'] as const)('rejects corrupted %s ciphertext without replacing or re-signing it',async kind=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);
  if(kind==='issuance')await db.query('UPDATE ls_service_interest.inquiry_email_control_verifications SET issuance_ciphertext=$2 WHERE application_id=$1',[saved.id,'not-authenticated']);
  else await db.query('UPDATE ls_service_interest.inquiry_email_control_verifications SET lifecycle_ciphertext=$2 WHERE application_id=$1',[saved.id,'not-authenticated']);
  const before=JSON.stringify(await row(saved.id));expect(await service().confirmPost(confirm(actionFor(saved.id).token))).toEqual({state:'not_available'});expect(await service().readEvidence(saved.id)).toBeNull();expect(await service().issue(saved.id,enqueue)).toEqual({state:'closed'});
  await expect(service().revoke(saved.id)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(JSON.stringify(await row(saved.id))).toBe(before);
 });
 it('rejects future consumed evidence even when a test-key-valid lifecycle matches all SQL flags',async()=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);const stored=await row(saved.id),aad=`ls_service_interest/inquiry_email_control/lifecycle/v1/${workspace}/${stored.id}`;
  // Deliberately possess only the synthetic test key to exercise chronology,
  // independently from the field/cipher corruption cases above.
  const state=JSON.parse(unseal(stored.lifecycle_ciphertext,aad,ring)),future=new Date(stored.issued_at.getTime()+60_000).toISOString();
  await db.query('UPDATE ls_service_interest.inquiry_email_control_verifications SET consumed_at=$2,lifecycle_ciphertext=$3 WHERE application_id=$1',[saved.id,future,seal(JSON.stringify({...state,state:'consumed',consumedAt:future}),aad,ring)]);
  expect(await service().readEvidence(saved.id)).toBeNull();expect(await service().confirmPost(confirm(actionFor(saved.id).token))).toEqual({state:'not_available'});
 });
 it('rejects sub-millisecond expiry substitution rather than rounding SQL time to JS precision',async()=>{
  const saved=await inquiry();await service().issue(saved.id,enqueue);
  await db.query("UPDATE ls_service_interest.inquiry_email_control_verifications SET expires_at=expires_at+interval '1 microsecond' WHERE application_id=$1",[saved.id]);
  expect(await service().confirmPost(confirm(actionFor(saved.id).token))).toEqual({state:'not_available'});expect((await row(saved.id)).consumed_at).toBeNull();
 });
});
