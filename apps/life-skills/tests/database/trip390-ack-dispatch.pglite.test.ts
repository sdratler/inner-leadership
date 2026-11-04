import {requirePgliteMemoryEnvironment} from '../fixtures/pglite-memory-environment.ts';
import {createHash,randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {asId} from '../../src/lib/ids.ts';
import {seal,unseal} from '../../src/features/identity/crypto.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {PublicGroupApplicationStore} from '../../src/features/group-application/store.ts';
import {InquiryEmailOutbox,queueInquiryEmail} from '../../src/features/group-application/inquiry-email.ts';
import {groupApplicationRequestDigest} from '../../src/features/group-application/group-application-record.ts';
import {privateDigest} from '../../src/features/contact-ops/server/digests.ts';
import {loadTrip390AckAdmission,trip390AckSourceFiles,TRIP390_ACK_VERSION,TRIP390_ACK_PURPOSE,TRIP390_ACK_SENDER} from '../../src/features/group-application/academy-trip390-ack-admission.ts';
import {TRIP390_INTEREST_VERSION,TRIP390_NOTICE_VERSION,type Trip390Command} from '../../src/features/group-application/academy-trip390-contract.ts';
import {trip390V1InterestSchema,TRIP390_V1_INTEREST_VERSION,TRIP390_V1_NOTICE_VERSION,TRIP390_V1_OFFER} from '../../src/features/group-application/academy-trip390-v1.ts';
import {TRIP390_EMAIL_VERSION,trip390EmailContent} from '../../src/features/group-application/academy-trip390-email.ts';
import {INQUIRY_EMAIL_PURPOSE} from '../../src/features/group-application/inquiry-email-copy.ts';
import {currentTrip390Fields} from '../fixtures/trip390-current.ts';

// PREPARATION ONLY: synthetic admission exercises guards, never establishes real
// platform authority. Actual SQL and Gmail MIME/OAuth adapter; injected fetch only.
let engine:PGlite;
const sha=(s:string)=>createHash('sha256').update(s).digest('hex');
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,61)}};
const db:IdentityStore={transaction:work=>engine.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=> (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
const migrations=['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql','0124_ls_group_interest.sql','0131_ls_public_group_applications.sql','0135_ls_inquiry_email_outbox.sql','0136_ls_academy_founder.sql','0137_ls_academy_owner_notifications.sql'];
const proposalPins={admission:'49cb81174e5fdc9b3220d11cc498bbde2d14c99dd5d13ca05c6ab8a93a2d6ff0',outbox:'e1e38c354381ada6f04d05559a9c7767adb6882c639b9513e8e4111ea3131fde',worker:'17d486e6248cf740bebcb28effd8327c6c73315eeedd3267d9f5585dcd2b7682',start:'8c1eda5817c478efea96b3da07a63ccf7a86a32274527a3c21835a752296c71b',recordDecoder:'4e448342d404d2f8fe5c2c9dbf1bfa82ae25bfdc3e58529e193e14fa5352b06c'};
let sourceHashes:Record<string,string>;
beforeAll(async()=>{
 requirePgliteMemoryEnvironment(process.env);
 vi.stubGlobal('fetch',vi.fn(async()=>{throw Error('REAL_NETWORK_NOT_ADMITTED');}));
 sourceHashes=Object.fromEntries(await Promise.all(Object.entries(trip390AckSourceFiles).map(async([k,p])=>[k,sha((await readFile(p,'utf8')).replace(/\r\n/g,'\n'))])));
 expect(sourceHashes).toMatchObject(proposalPins);
 engine=new PGlite();await engine.exec('CREATE SCHEMA ls_control');
 const manifest=JSON.parse(await readFile('migrations/manifest.json','utf8')) as {name:string;sha256:string}[];
 for(const name of migrations){const sql=await readFile('migrations/'+name,'utf8');expect(sha(sql)).toBe(manifest.find(m=>m.name===name)?.sha256);await engine.exec(sql);}
},20000);
afterAll(async()=>{try{await engine?.close();}finally{vi.unstubAllGlobals();}});

async function fixture(){
 const workspace=asId(randomUUID(),'workspace'),initial=new Date('2035-01-01T12:00:00Z');let now=initial;
 const clock={now:()=>now};await engine.query('INSERT INTO ls_identity.workspaces(id) VALUES($1)',[workspace]);
 const digestKey='synthetic-ack-digest-key-'+workspace;
 const store=()=>new PublicGroupApplicationStore(db,workspace,ring,digestKey,clock,true);
 async function save(language:'en'|'he'='he'){
  const base=currentTrip390Fields(),operationId=randomUUID(),fields:Trip390Command['fields']={...base,email:'synthetic-'+randomUUID()+'@example.invalid',guardianName:'Synthetic ACK Parent',messageLanguage:language,children:base.children.map((c,i)=>({...c,id:randomUUID(),name:i?'Synthetic Younger':'Synthetic Older'}))};
  const result=await store().submit({operationId,fields});expect(result.acknowledgment).toBe('queued');
  const reference=result.item.id,row=(await engine.query<{id:string}>('SELECT id FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2',[workspace,reference])).rows[0]!;
  const content=trip390EmailContent({version:TRIP390_EMAIL_VERSION,kind:'ack',reference,parentName:fields.guardianName,children:fields.children.map(({id,name})=>({id,name})),messageLanguage:language});
  return {reference,id:row.id,operationId,fields,content};
 }
 async function row(id:string){return (await engine.query<{id:string;state:string;reserved_at:Date|null;provider_id:string|null;completed_at:Date|null;payload_ciphertext:string}>('SELECT id,state,reserved_at,provider_id,completed_at,payload_ciphertext FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND id=$2',[workspace,id])).rows[0]!;}
 async function lead(reference:string){return (await engine.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2',[workspace,reference])).rows[0]!.payload_ciphertext;}
 function admitted(target:Awaited<ReturnType<typeof save>>){
  const policy={version:TRIP390_ACK_VERSION,approvalReceiptSha256:'a'.repeat(64),sourceCommit:'b'.repeat(40),workspaceId:workspace,projectId:randomUUID(),environmentId:randomUUID(),serviceId:randomUUID(),origin:'https://life-skills.bneineviimacademy.org',sender:TRIP390_ACK_SENDER,replyTo:TRIP390_ACK_SENDER,requestVersion:TRIP390_INTEREST_VERSION,noticeVersion:TRIP390_NOTICE_VERSION,payloadVersion:2,payloadKind:TRIP390_ACK_PURPOSE,templateVersion:TRIP390_EMAIL_VERSION,sourceHashes,notBefore:initial.toISOString(),admittedAt:initial.toISOString(),expiresAt:new Date(initial.valueOf()+3600000).toISOString(),population:{mode:'controlled_test',requests:[{reference:target.reference,outboxId:target.id,operationId:target.operationId,recipientSha256:sha(target.fields.email),messageLanguage:target.fields.messageLanguage,childIds:target.fields.children.map(c=>c.id),contentSha256:target.content.contentSha256}]}};
  const env:Record<string,string|undefined>={LS_ACADEMY_TRIP390_ACK_ENABLED:'true',LS_ACADEMY_TRIP390_ACK_QUEUE_ENABLED:'true',LS_ACADEMY_TRIP390_ACK_ADMISSION_JSON:JSON.stringify(policy),LS_INQUIRY_EMAIL_QUEUE_ENABLED:'false',LS_INQUIRY_EMAIL_SEND_ENABLED:'false',LS_ACADEMY_FOUNDER_EMAIL_APPROVED:'false',LS_ACADEMY_SIGNUP_WORKER_ENABLED:'false',LS_ACADEMY_SIGNUP_CONTROLLED_SEND_ENABLED:'false',LS_AUTH_EMAIL_ENABLED:'true',LS_AUTH_EMAIL_PROVIDER:'gmail',LS_AUTH_EMAIL_FROM:policy.sender,LS_AUTH_GOOGLE_CLIENT_ID:'synthetic-id',LS_AUTH_GOOGLE_CLIENT_SECRET:'synthetic-secret',LS_AUTH_GOOGLE_REFRESH_TOKEN:'synthetic-refresh',RAILWAY_GIT_COMMIT_SHA:policy.sourceCommit,LIFE_SKILLS_RELEASE_COMMIT:policy.sourceCommit,LS_IDENTITY_WORKSPACE_ID:workspace,RAILWAY_PROJECT_ID:policy.projectId,RAILWAY_ENVIRONMENT_ID:policy.environmentId,RAILWAY_SERVICE_ID:policy.serviceId,LS_APP_ORIGIN:policy.origin};
  const issued=loadTrip390AckAdmission(env,now);expect(issued).not.toBeNull();return {env,issued:issued!,policy};
 }
 const outbox=()=>new InquiryEmailOutbox(db,workspace,ring,clock,digestKey);
 return {workspace,digestKey,initial,clock,save,row,lead,admitted,outbox,setTime:(value:Date)=>{now=value;}};
}
const oauth='https://oauth2.googleapis.com/token',gmail='https://gmail.googleapis.com/gmail/v1/users/me/messages/send';
function decodedAlternative(mime:string){
 const separator=mime.indexOf('\r\n\r\n');expect(separator).toBeGreaterThan(0);
 const headers=mime.slice(0,separator).split('\r\n'),contentTypes=headers.filter(line=>line.startsWith('Content-Type:'));
 expect(contentTypes).toHaveLength(1);const match=/^Content-Type: multipart\/alternative; boundary="(jlfa-alt-ls-auth-[a-f0-9-]{36})"$/.exec(contentTypes[0]!);expect(match).not.toBeNull();
 const chunks=mime.slice(separator+4).split('--'+match![1]);expect(chunks).toHaveLength(4);expect(chunks[0]).toBe('');expect(chunks[3]).toBe('--\r\n');
 const parts=chunks.slice(1,3).map(chunk=>{
  expect(chunk.startsWith('\r\n')).toBe(true);expect(chunk.endsWith('\r\n')).toBe(true);
  const part=chunk.slice(2,-2),at=part.indexOf('\r\n\r\n');expect(at).toBeGreaterThan(0);
  const lines=part.slice(0,at).split('\r\n');expect(lines).toHaveLength(2);expect(lines[1]).toBe('Content-Transfer-Encoding: base64');
  const content=/^Content-Type: (text\/plain|text\/html); charset=UTF-8$/.exec(lines[0]!);expect(content).not.toBeNull();
  const encodedLines=part.slice(at+4).split('\r\n');expect(encodedLines.length).toBeGreaterThan(0);for(const line of encodedLines)expect(line).toMatch(/^[A-Za-z0-9+/=]{1,76}$/);
  const encoded=encodedLines.join(''),bytes=Buffer.from(encoded,'base64');expect(bytes.toString('base64')).toBe(encoded);
  return {type:content![1]!,bytes};
 });
 expect(parts.map(part=>part.type)).toEqual(['text/plain','text/html']);return {headers,plain:parts[0]!.bytes,html:parts[1]!.bytes};
}
function transport(onOauth?:()=>Promise<void>,onSend?:()=>Promise<Response>){return vi.fn(async(input:string|URL|Request,init?:RequestInit)=>{
 const url=String(input);expect(init?.method).toBe('POST');expect(init?.redirect).toBe('error');
 if(url===oauth){await onOauth?.();return new Response(JSON.stringify({access_token:'synthetic-access'}));}
 expect(url).toBe(gmail);return onSend?onSend():new Response(JSON.stringify({id:'synthetic-provider-receipt'}));
});}

it('real queued V3 SQL reaches SENT once through actual Gmail adapter and a fresh outbox never resends',async()=>{
 const f=await fixture(),target=await f.save('he'),a=f.admitted(target),before=await f.lead(target.reference),send=transport();
 expect(await f.outbox().dispatchTrip390One(target.id,a.issued,a.env,send as typeof fetch)).toBe('sent');
 expect(await f.row(target.id)).toMatchObject({state:'sent',provider_id:'synthetic-provider-receipt',reserved_at:expect.any(Date),completed_at:expect.any(Date)});
 expect(await f.outbox().dispatchTrip390One(target.id,a.issued,a.env,send as typeof fetch)).toBe('idle');expect(send).toHaveBeenCalledTimes(2);
 const mime=Buffer.from(JSON.parse(String(send.mock.calls.find(([url])=>url===gmail)![1]!.body)).raw,'base64url').toString('utf8');
 const decoded=decodedAlternative(mime);expect(decoded.headers.filter(line=>line.startsWith('To:'))).toEqual(['To: '+target.fields.email]);expect(decoded.plain).toEqual(Buffer.from(target.content.text,'utf8'));expect(decoded.html).toEqual(Buffer.from(target.content.html,'utf8'));
 expect(await f.lead(target.reference)).toBe(before);expect(JSON.parse(unseal(before,`ls_service_interest/public_application/v1/${f.workspace}/${target.reference}`,ring))).toEqual(target.fields);
 const count=(await engine.query<{n:number}>('SELECT count(*)::int n FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2',[f.workspace,target.reference])).rows[0]!.n;expect(count).toBe(1);expect(fetch).not.toHaveBeenCalled();
});
it('post-OAuth closure restores only its own known-not-attempted reservation; changed reservation stays UNKNOWN',async()=>{
 for(const replacement of [false,true]){
  const f=await fixture(),target=await f.save('en'),other=await f.save('he'),a=f.admitted(target),before=await f.lead(target.reference);
  await engine.query("UPDATE ls_service_interest.inquiry_email_outbox SET state='unknown',reserved_at=$3 WHERE workspace_id=$1 AND id=$2",[f.workspace,other.id,f.initial]);const otherBefore=await f.row(other.id);
  const send=transport(async()=>{a.env.LS_ACADEMY_TRIP390_ACK_QUEUE_ENABLED='false';if(replacement)await engine.query('UPDATE ls_service_interest.inquiry_email_outbox SET reserved_at=$3 WHERE workspace_id=$1 AND id=$2',[f.workspace,target.id,new Date(f.initial.valueOf()+1)]);});
  expect(await f.outbox().dispatchTrip390One(target.id,a.issued,a.env,send as typeof fetch)).toBe(replacement?'unknown':'queued');
  expect(await f.row(target.id)).toMatchObject({state:replacement?'unknown':'queued',reserved_at:replacement?new Date(f.initial.valueOf()+1):null,provider_id:null,completed_at:null});
  expect(await f.row(other.id)).toEqual(otherBefore);expect(await f.lead(target.reference)).toBe(before);expect(send).toHaveBeenCalledTimes(1);expect(send.mock.calls[0]![0]).toBe(oauth);
 }
 expect(fetch).not.toHaveBeenCalled();
});
it('uncertain message dispatch remains UNKNOWN, while historical, pre-cutoff and other requests remain ineligible',async()=>{
 const f=await fixture();f.setTime(new Date(f.initial.valueOf()-1000));const early=await f.save('en');f.setTime(f.initial);const target=await f.save('he'),other=await f.save('en'),a=f.admitted(target);
 const before=await f.lead(target.reference),send=transport(undefined,async()=>{throw Error('SYNTHETIC_MESSAGE_RESPONSE_LOST');});
 expect(await f.outbox().dispatchTrip390One(target.id,a.issued,a.env,send as typeof fetch)).toBe('unknown');expect(await f.outbox().dispatchTrip390One(target.id,a.issued,a.env,send as typeof fetch)).toBe('idle');
 expect(await f.row(target.id)).toMatchObject({state:'unknown',provider_id:null,completed_at:null,reserved_at:expect.any(Date)});expect(send.mock.calls.filter(([url])=>url===gmail)).toHaveLength(1);expect(await f.lead(target.reference)).toBe(before);
 // Frozen historical data is inserted as a fixture, never submitted through the
 // current write contract and never updated around append-only protections.
 const base=currentTrip390Fields();const {lessonDayDriving:omittedDriving,acknowledgment:oldAck,...oldBase}=base;void omittedDriving;
 const historical=trip390V1InterestSchema.parse({...oldBase,version:TRIP390_V1_INTEREST_VERSION,offerVersion:TRIP390_V1_OFFER.version,acknowledgment:{version:TRIP390_V1_NOTICE_VERSION,language:oldAck.language,conductExplained:true,interestPrivacySafety:true,whatsapp:false}}),reference=randomUUID(),id=randomUUID();
 await engine.query('INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[f.workspace,reference,privateDigest({domain:'public-group-application-contact/v1',workspace:f.workspace,contact:historical.email},f.digestKey),groupApplicationRequestDigest(f.workspace,historical,f.digestKey),seal(JSON.stringify(historical),`ls_service_interest/public_application/v1/${f.workspace}/${reference}`,ring),historical.acknowledgment.version,historical.acknowledgment.language,f.initial]);
 const content=trip390EmailContent({version:TRIP390_EMAIL_VERSION,kind:'ack',reference,parentName:historical.guardianName,children:historical.children.map(({id,name})=>({id,name})),messageLanguage:historical.messageLanguage});
 const payload={version:2,purpose:INQUIRY_EMAIL_PURPOSE,reference,recipient:historical.email,locale:historical.messageLanguage,copyVersion:content.version,contentSha256:content.contentSha256,subject:content.subject,text:content.text,html:content.html};
 await engine.query('INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,purpose,payload_ciphertext,created_at) VALUES($1,$2,$3,$4,$5,$6)',[f.workspace,id,reference,INQUIRY_EMAIL_PURPOSE,seal(JSON.stringify(payload),`ls_service_interest/inquiry_email/v1/${f.workspace}/${id}`,ring),f.initial]);
 const denied=transport(),earlyAdmission=f.admitted(early);
 for(const [held,admission] of [[early,earlyAdmission],[other,a],[{id},a]] as const){const original=await f.row(held.id);expect(await f.outbox().dispatchTrip390One(held.id,admission.issued,admission.env,denied as typeof fetch)).toBe('idle');expect(await f.row(held.id)).toEqual(original);}
 expect(await f.outbox().dispatchTrip390Page(a.issued,a.env)).toEqual({processed:0,inspected:0,scanComplete:true,continuation:undefined});
 expect(denied).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});

it('stored HMAC corruption holds before reservation, while the real FK rejects an independently mismatched operation digest',async()=>{
 const f=await fixture(),valid=await f.save('en'),before=await f.lead(valid.reference),validOutbox=await f.row(valid.id);
 const stored=(await engine.query<{request_digest:string}>('SELECT request_digest FROM ls_service_interest.public_applications WHERE workspace_id=$1 AND id=$2',[f.workspace,valid.reference])).rows[0]!.request_digest;
 const wrong=sha('synthetic-wrong-digest-'+randomUUID());expect(wrong).not.toBe(stored);
 // This impossible relational corruption is rejected by the real composite FK.
 // Do not disable constraints or pretend a mismatched operation was persisted.
 const rejectedOperation=randomUUID();await expect(engine.query('INSERT INTO ls_service_interest.public_application_operations(workspace_id,operation_id,request_digest,application_id) VALUES($1,$2,$3,$4)',[f.workspace,rejectedOperation,wrong,valid.reference])).rejects.toMatchObject({code:'23503'});
 expect((await engine.query('SELECT operation_id FROM ls_service_interest.public_application_operations WHERE workspace_id=$1 AND operation_id=$2',[f.workspace,rejectedOperation])).rows).toHaveLength(0);
 expect(await f.lead(valid.reference)).toBe(before);expect(await f.row(valid.id)).toEqual(validOutbox);
 // A consistent wrong app/op digest CAN satisfy the FK. The unchanged AEAD
 // payload must still fail the actual canonical keyed request-HMAC decoder.
 const fields={...currentTrip390Fields(),email:'synthetic-corrupt-'+randomUUID()+'@example.invalid'},reference=randomUUID(),operationId=randomUUID();
 const cipher=seal(JSON.stringify(fields),`ls_service_interest/public_application/v1/${f.workspace}/${reference}`,ring);expect(JSON.parse(unseal(cipher,`ls_service_interest/public_application/v1/${f.workspace}/${reference}`,ring))).toEqual(fields);expect(groupApplicationRequestDigest(f.workspace,fields,f.digestKey)).not.toBe(wrong);
 await db.transaction(async tx=>{
  await tx.query('INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[f.workspace,reference,privateDigest({domain:'public-group-application-contact/v1',workspace:f.workspace,contact:fields.email},f.digestKey),wrong,cipher,fields.acknowledgment.version,fields.acknowledgment.language,f.initial]);
  await tx.query('INSERT INTO ls_service_interest.public_application_operations(workspace_id,operation_id,request_digest,application_id) VALUES($1,$2,$3,$4)',[f.workspace,operationId,wrong,reference]);
  expect(await queueInquiryEmail(tx,f.workspace,reference,fields,ring,f.initial)).toBe('queued');
 });
 const id=(await engine.query<{id:string}>('SELECT id FROM ls_service_interest.inquiry_email_outbox WHERE workspace_id=$1 AND application_id=$2',[f.workspace,reference])).rows[0]!.id;
 const content=trip390EmailContent({version:TRIP390_EMAIL_VERSION,kind:'ack',reference,parentName:fields.guardianName,children:fields.children.map(({id,name})=>({id,name})),messageLanguage:fields.messageLanguage}),admission=f.admitted({id,reference,operationId,fields,content}),send=transport(),outboxBefore=await f.row(id);
 await expect(f.outbox().dispatchTrip390One(id,admission.issued,admission.env,send as typeof fetch)).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect(await f.row(id)).toEqual(outboxBefore);expect(await f.lead(reference)).toBe(cipher);expect(await f.lead(valid.reference)).toBe(before);expect(send).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
});
