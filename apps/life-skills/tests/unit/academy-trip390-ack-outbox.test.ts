import {beforeEach,describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('node:fs',()=>({readFileSync:()=> 'synthetic-source'}));
vi.mock('../../src/features/identity/data.ts',()=>({lockWorkspace:vi.fn(),freshActor:vi.fn()}));
import {InquiryEmailOutbox,queueInquiryEmail,dispatchAdmittedTrip390Acknowledgment} from '../../src/features/group-application/inquiry-email.ts';
import {loadTrip390AckAdmission,trip390AckDigest,trip390AckSourceFiles} from '../../src/features/group-application/academy-trip390-ack-admission.ts';
import {trip390CurrentInterestSchema,TRIP390_INTEREST_VERSION,TRIP390_NOTICE_VERSION} from '../../src/features/group-application/academy-trip390-contract.ts';
import {trip390V1InterestSchema} from '../../src/features/group-application/academy-trip390-v1.ts';
import {trip390V2InterestSchema} from '../../src/features/group-application/academy-trip390-v2.ts';
import {trip390ProgramTerms} from '../../src/features/group-application/academy-trip390-program-terms.ts';
import {trip390StudentAgreement} from '../../src/features/group-application/academy-trip390-student-agreement.ts';
import {trip390ReservationNotice} from '../../src/features/group-application/academy-trip390-reservation-notice.ts';
import {trip390StudentConduct} from '../../src/features/group-application/academy-trip390-student-conduct.ts';
import {trip390EmailContent,TRIP390_EMAIL_VERSION} from '../../src/features/group-application/academy-trip390-email.ts';
import {groupApplicationFieldsSchema} from '../../src/features/group-application/contract.ts';
import {decodeStoredGroupApplication,groupApplicationRequestDigest} from '../../src/features/group-application/group-application-record.ts';
import {seal,unseal,type Keyring} from '../../src/features/identity/crypto.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import type {WorkspaceId} from '../../src/lib/ids.ts';
const id=(n:number)=>'71000000-0000-4000-8000-'+String(n).padStart(12,'0'),workspace=id(1) as WorkspaceId,reference=id(2),operation=id(3),initial=new Date('2035-01-01T12:00:00.000Z');
const digestKey=Buffer.alloc(32,47).toString('hex');
const ring:Keyring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,23)}};
const snapshot=(x:{version:string;language:'en'|'he';text:string;textDigest:string})=>({version:x.version,language:x.language,text:x.text,textDigest:x.textDigest});
const fields=(language:'en'|'he'='he')=>trip390CurrentInterestSchema.parse({version:TRIP390_INTEREST_VERSION,offerVersion:'JLFA-KEYS390-v2',guardianName:'Synthetic Parent',email:'synthetic@example.invalid',phone:'+13055550100',city:'Synthetic City',postalCode:'01234-5678',messageLanguage:language,instructionLanguage:'either',children:[{id:id(4),name:'Older Synthetic',ageYears:12,experience:'some'},{id:id(5),name:'Younger Synthetic',ageYears:9,experience:'new'}],lessonDayDriving:{version:'JLFA-SUNDAY-TOTAL-DRIVE-v1',limit:'up_to_60'},acknowledgment:{version:TRIP390_NOTICE_VERSION,language:language==='he'?'en':'he',conductExplained:true,interestPrivacySafety:true,whatsapp:false,studentConduct:snapshot(trip390StudentConduct(language==='he'?'en':'he')),reservationNotice:snapshot(trip390ReservationNotice(language==='he'?'en':'he'))}});
type Mail={id:string;applicationId:string;purpose:string;ciphertext:string;state:'queued'|'unknown'|'sent'|'canceled';createdAt:Date;reservedAt:Date|null;founderId:null};
beforeEach(()=>{vi.restoreAllMocks();});
async function fixture(language:'en'|'he'='he'){
 let now=initial,mail:Mail|undefined,savedAt=initial;const f=fields(language),originalFields=JSON.stringify(f);let appCipher=seal(originalFields,`ls_service_interest/public_application/v1/${workspace}/${reference}`,ring);
 let applicationDigest=groupApplicationRequestDigest(workspace,f,digestKey),operationDigest=applicationDigest;
 const writes:string[]=[],query=vi.fn(async(sql:string,values:readonly unknown[]=[])=>{
  if(sql.startsWith('INSERT INTO ls_service_interest.inquiry_email_outbox')){mail={id:String(values[1]),applicationId:reference,purpose:String(values[3]),ciphertext:String(values[4]),state:'queued',createdAt:values[5] as Date,reservedAt:null,founderId:null};writes.push('queue');return [];}
  if(sql.includes('SELECT o.id,o.created_at'))return mail?[{id:mail.id,createdAt:mail.createdAt.toISOString()}]:[];
  if(sql.includes('FROM ls_service_interest.inquiry_email_outbox'))return mail?[{...mail}]:[];
  if(sql.includes('FROM ls_service_interest.public_applications'))return [{id:reference,ciphertext:appCipher,payloadCiphertext:appCipher,requestDigest:applicationDigest,receivedAt:savedAt}];
  if(sql.startsWith('SELECT operation_id'))return [{operationId:operation,requestDigest:operationDigest}];
  if(sql.startsWith('UPDATE ls_service_interest.inquiry_email_outbox')){
   if(sql.includes("SET state='unknown'")){if(mail?.state!=='queued')return [];mail.state='unknown';mail.reservedAt=values[2] as Date;writes.push('reserve');return [{id:mail.id}];}
   if(sql.includes("SET state='sent'")){if(mail?.state!=='unknown'||mail.reservedAt?.valueOf()!==(values[4] as Date).valueOf())return [];mail.state='sent';writes.push('receipt');return [{id:mail.id}];}
   if(sql.includes("SET state='queued'")){if(mail?.state!=='unknown'||mail.reservedAt?.valueOf()!==(values[2] as Date).valueOf())return [];mail.state='queued';mail.reservedAt=null;writes.push('restore');return [{id:mail.id}];}
  }
  throw Error('UNEXPECTED_SYNTHETIC_SQL');
 });
 const db={transaction:async<T>(work:(tx:SqlSession)=>Promise<T>)=>work({query} as unknown as SqlSession)} as IdentityStore,clock={now:()=>now};
 await db.transaction(tx=>queueInquiryEmail(tx,workspace,reference,f,ring,now));
 const content=trip390EmailContent({version:TRIP390_EMAIL_VERSION,kind:'ack',reference,parentName:f.guardianName,children:f.children.map(({id,name})=>({id,name})),messageLanguage:f.messageLanguage});
 const policy={version:'JLFA-TRIP390-ACK-ADMISSION-v2',approvalReceiptSha256:'a'.repeat(64),sourceCommit:'b'.repeat(40),workspaceId:workspace,projectId:id(6),environmentId:id(7),serviceId:id(8),origin:'https://life-skills.bneineviimacademy.org',sender:'office@bneineviimacademy.org',replyTo:'office@bneineviimacademy.org',requestVersion:TRIP390_INTEREST_VERSION,noticeVersion:TRIP390_NOTICE_VERSION,payloadVersion:2,payloadKind:'trip390_reservation_acknowledgment',templateVersion:TRIP390_EMAIL_VERSION,sourceHashes:Object.fromEntries(Object.keys(trip390AckSourceFiles).map(k=>[k,trip390AckDigest('synthetic-source')])),notBefore:initial.toISOString(),admittedAt:initial.toISOString(),expiresAt:'2035-01-01T14:00:00.000Z',population:{mode:'controlled_test',requests:[{reference,outboxId:mail!.id,operationId:operation,recipientSha256:trip390AckDigest(f.email),messageLanguage:language,childIds:f.children.map(c=>c.id),contentSha256:content.contentSha256}]}};
 const env:Record<string,string|undefined>={LS_ACADEMY_TRIP390_ACK_ENABLED:'true',LS_ACADEMY_TRIP390_ACK_ADMISSION_JSON:JSON.stringify(policy),LS_ACADEMY_TRIP390_ACK_QUEUE_ENABLED:'true',LS_INQUIRY_EMAIL_QUEUE_ENABLED:'false',LS_INQUIRY_EMAIL_SEND_ENABLED:'false',LS_AUTH_EMAIL_ENABLED:'true',LS_AUTH_EMAIL_PROVIDER:'gmail',LS_AUTH_EMAIL_FROM:policy.sender,LS_AUTH_GOOGLE_CLIENT_ID:'synthetic-id',LS_AUTH_GOOGLE_CLIENT_SECRET:'synthetic-secret',LS_AUTH_GOOGLE_REFRESH_TOKEN:'synthetic-refresh',RAILWAY_GIT_COMMIT_SHA:policy.sourceCommit,LIFE_SKILLS_RELEASE_COMMIT:policy.sourceCommit,LS_IDENTITY_WORKSPACE_ID:workspace,RAILWAY_PROJECT_ID:policy.projectId,RAILWAY_ENVIRONMENT_ID:policy.environmentId,RAILWAY_SERVICE_ID:policy.serviceId,LS_APP_ORIGIN:policy.origin};
 const issued=loadTrip390AckAdmission(env,now)!;expect(issued).not.toBeNull();
 const send=vi.fn(async(url:string|URL|Request)=>String(url).includes('oauth2')?new Response(JSON.stringify({access_token:'synthetic-access'})):new Response(JSON.stringify({id:'synthetic-provider-id'})));
 const outbox=new InquiryEmailOutbox(db,workspace,ring,clock,digestKey),dispatch=()=>outbox.dispatchTrip390One(mail!.id,issued,env,send as typeof fetch);
 return {env,policy,issued,content,send,dispatch,outbox,query,writes,clock,db,fields:f,read:()=>mail!,setTime:(date:Date)=>{now=date;},setSaved:(date:Date)=>{savedAt=date;},setApplicationDigest:(value:string)=>{applicationDigest=value;},setOperationDigest:(value:string)=>{operationDigest=value;},getStored:()=>({id:reference,payloadCiphertext:appCipher,requestDigest:applicationDigest,receivedAt:savedAt}),setFields:(next:unknown)=>{applicationDigest=groupApplicationRequestDigest(workspace,groupApplicationFieldsSchema.parse(next),digestKey);operationDigest=applicationDigest;appCipher=seal(JSON.stringify(next),`ls_service_interest/public_application/v1/${workspace}/${reference}`,ring);},originalFields,getFields:()=>unseal(appCipher,`ls_service_interest/public_application/v1/${workspace}/${reference}`,ring)};
}
describe('Trip ACK actual outbox + encryption + Gmail adapter, mocked SQL/network only',()=>{
 it('unchanged prospective purpose sends a newly saved current request weeks later with generic queue still OFF',async()=>{
  const f=await fixture(),later=new Date('2035-02-01T12:00:00.000Z');f.setTime(later);f.setSaved(later);f.read().createdAt=later;
  f.env.LS_ACADEMY_TRIP390_ACK_ADMISSION_JSON=JSON.stringify({...f.policy,expiresAt:null,population:{mode:'future_requests'}});
  const policy=loadTrip390AckAdmission(f.env,later)!;expect(policy).not.toBeNull();const body=f.read().ciphertext;
  expect(await f.outbox.dispatchTrip390One(f.read().id,policy,f.env,f.send as typeof fetch)).toBe('sent');
  expect(f.env.LS_INQUIRY_EMAIL_QUEUE_ENABLED).toBe('false');expect(f.env.LS_INQUIRY_EMAIL_SEND_ENABLED).toBe('false');expect(f.read().ciphertext).toBe(body);
  expect(await f.outbox.dispatchTrip390One(f.read().id,policy,f.env,f.send as typeof fetch)).toBe('idle');expect(f.send).toHaveBeenCalledTimes(2);
 });
 it('generic queue alone never grants Trip sending or reservation',async()=>{
  const f=await fixture();delete f.env.LS_ACADEMY_TRIP390_ACK_QUEUE_ENABLED;f.env.LS_INQUIRY_EMAIL_QUEUE_ENABLED='true';
  expect(loadTrip390AckAdmission(f.env,f.clock.now())).toBeNull();expect(await dispatchAdmittedTrip390Acknowledgment(reference,{store:f.db,workspaceId:workspace,keyring:ring,clock:f.clock,origin:f.policy.origin,digestKey},f.env)).toBeUndefined();expect(f.writes).toEqual(['queue']);expect(f.send).not.toHaveBeenCalled();
 });
 it.each(['en','he'] as const)('delivers exactly one frozen %s sibling body despite opposite intake language, and restart never repeats',async lang=>{const f=await fixture(lang);expect(await f.dispatch()).toBe('sent');expect(f.read().state).toBe('sent');expect(await f.dispatch()).toBe('idle');expect(f.send).toHaveBeenCalledTimes(2);expect(f.writes).toEqual(['queue','reserve','receipt']);const payload=JSON.parse(unseal(f.read().ciphertext,`ls_service_interest/inquiry_email/v1/${workspace}/${f.read().id}`,ring));expect(payload).toMatchObject({locale:lang,text:f.content.text,html:f.content.html});expect(f.content.text).toContain('Older');expect(f.content.text).toContain('Younger');expect(f.content.text).toContain(lang==='en'?'places':'מקומות');expect(f.content.html).toContain(lang==='en'?'dir="ltr"':'dir="rtl"');expect(f.getFields()).toBe(f.originalFields);});
 it('generic SEND path cannot send a Trip row even with an arbitrary caller transport',async()=>{const f=await fixture(),send=vi.fn();await expect(f.outbox.dispatchOne(f.read().id,{send},f.policy.sender)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(send).not.toHaveBeenCalled();expect(f.read().state).toBe('queued');});
 it('concurrent callback/worker claims yield one provider request',async()=>{const f=await fixture();const results=await Promise.all([f.dispatch(),f.dispatch()]);expect(results).toContain('sent');expect(f.send.mock.calls.filter(([url])=>String(url).includes('messages/send'))).toHaveLength(1);});
 it.each(['recipient','language','children','content','cutoff'] as const)('holds changed %s before UNKNOWN or network',async change=>{const f=await fixture();if(change==='recipient')f.setFields({...f.fields,email:'other@example.invalid'});if(change==='language')f.setFields({...f.fields,messageLanguage:'en'});if(change==='children')f.setFields({...f.fields,children:[f.fields.children[0]]});if(change==='cutoff')f.setSaved(new Date(initial.valueOf()-1));if(change==='content'){const payload=JSON.parse(unseal(f.read().ciphertext,`ls_service_interest/inquiry_email/v1/${workspace}/${f.read().id}`,ring));payload.text+=' altered';f.read().ciphertext=seal(JSON.stringify(payload),`ls_service_interest/inquiry_email/v1/${workspace}/${f.read().id}`,ring);}expect(await f.dispatch()).toBe('idle');expect(f.writes).toEqual(['queue']);expect(f.send).not.toHaveBeenCalled();});
 it('current valid save remains intact after a provider UNKNOWN and is never automatically retried',async()=>{const f=await fixture();f.send.mockImplementation(async url=>{if(String(url).includes('oauth2'))return new Response(JSON.stringify({access_token:'synthetic'}));throw Error('SYNTHETIC_NETWORK_UNKNOWN');});expect(await f.dispatch()).toBe('unknown');expect(await f.dispatch()).toBe('idle');expect(f.read().state).toBe('unknown');expect(f.getFields()).toBe(f.originalFields);expect(f.send.mock.calls.filter(([url])=>String(url).includes('messages/send'))).toHaveLength(1);});
 it.each(['expiry','queue_off','trip_off','global_on'] as const)('post-OAuth %s refuses message HTTP and restores only its own known-not-attempted reservation',async change=>{const f=await fixture();f.send.mockImplementation(async()=>{if(change==='expiry')f.setTime(new Date(f.policy.expiresAt));if(change==='queue_off')f.env.LS_ACADEMY_TRIP390_ACK_QUEUE_ENABLED='false';if(change==='trip_off')f.env.LS_ACADEMY_TRIP390_ACK_ENABLED='false';if(change==='global_on')f.env.LS_INQUIRY_EMAIL_SEND_ENABLED='true';return new Response(JSON.stringify({access_token:'synthetic'}));});expect(await f.dispatch()).toBe('queued');expect(f.send).toHaveBeenCalledTimes(1);expect(f.writes).toEqual(['queue','reserve','restore']);expect(f.read().reservedAt).toBeNull();});
 it('actual late accepted provider response is retained after expiry',async()=>{const f=await fixture();f.send.mockImplementation(async url=>{if(String(url).includes('oauth2'))return new Response(JSON.stringify({access_token:'synthetic'}));f.setTime(new Date(f.policy.expiresAt));return new Response(JSON.stringify({id:'late-real-response'}));});expect(await f.dispatch()).toBe('sent');expect(f.writes).toEqual(['queue','reserve','receipt']);});
 it('expiry at reservation commit is known not attempted, before even OAuth',async()=>{const f=await fixture(),original=f.query.getMockImplementation()!;f.query.mockImplementation(async(sql,values)=>{const result=await original(sql,values);if(sql.includes("SET state='unknown'"))f.setTime(new Date(f.policy.expiresAt));return result;});expect(await f.dispatch()).toBe('queued');expect(f.send).not.toHaveBeenCalled();expect(f.writes).toEqual(['queue','reserve','restore']);});
 it('valid frozen historical v1 and v2 requests never enter current Trip dispatch or generic sending',async()=>{for(const version of [1,2]){const f=await fixture(),{acknowledgment:ack,lessonDayDriving,...base}=f.fields;const common={version:version===1?'JLFA-TRIP390-INTEREST-v1':'JLFA-TRIP390-INTEREST-v2',offerVersion:version===1?'JLFA-KEYS390-v1':'JLFA-KEYS390-v2'};const assent={version:version===1?'JLFA-TRIP390-INTEREST-NOTICE-v1':'JLFA-TRIP390-INTEREST-NOTICE-20261104-06-v1',language:ack.language,conductExplained:true,interestPrivacySafety:true,whatsapp:false};const historical=version===1?trip390V1InterestSchema.parse({...base,...common,acknowledgment:assent}):trip390V2InterestSchema.parse({...base,...common,lessonDayDriving,acknowledgment:{...assent,studentAgreement:{...snapshot(trip390StudentAgreement(ack.language)),guardianTypedName:f.fields.guardianName},programTerms:snapshot(trip390ProgramTerms(ack.language))}});f.setFields(historical);const before=f.read().ciphertext;expect(await f.dispatch()).toBe('idle');const send=vi.fn();await expect(f.outbox.dispatchOne(f.read().id,{send},f.policy.sender)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(send).not.toHaveBeenCalled();expect(f.read().ciphertext).toBe(before);expect(f.writes).toEqual(['queue']);expect(f.send).not.toHaveBeenCalled();expect(f.read().state).toBe('queued');}});
 it('changed reservation identity cannot be cleared by a prior local refusal',async()=>{const f=await fixture();f.send.mockImplementation(async()=>{f.read().reservedAt=new Date(initial.valueOf()+1);return new Response(JSON.stringify({access_token:'synthetic'}));});expect(await f.dispatch()).toBe('unknown');expect(f.read().state).toBe('unknown');expect(f.writes).toEqual(['queue','reserve']);});
 it('missing or changed admission closes callback before reservation/adapter',async()=>{const f=await fixture();delete f.env.LS_ACADEMY_TRIP390_ACK_ENABLED;expect(await dispatchAdmittedTrip390Acknowledgment(reference,{store:f.db,workspaceId:workspace,keyring:ring,clock:f.clock,origin:f.policy.origin,digestKey},f.env)).toBeUndefined();expect(f.writes).toEqual(['queue']);expect(f.send).not.toHaveBeenCalled();});
 it('held pages advance a stable cursor rather than starving later queued requests',async()=>{const f=await fixture(),rows=Array.from({length:50},(_,i)=>({id:id(100+i),createdAt:initial.toISOString()}));const original=f.query.getMockImplementation()!;let page=0;f.query.mockImplementation(async(sql,values)=>sql.includes('SELECT o.id,o.created_at')?(page++===0?rows:[{id:f.read().id,createdAt:initial.toISOString()}]):original(sql,values));const single=vi.spyOn(f.outbox,'dispatchTrip390One').mockResolvedValueOnce('idle');single.mockImplementation(async selected=>selected===f.read().id?'sent':'idle');const first=await f.outbox.dispatchTrip390Page(f.issued,f.env);expect(first).toMatchObject({inspected:50,processed:0,scanComplete:false,continuation:rows.at(-1)});const second=await f.outbox.dispatchTrip390Page(f.issued,f.env,first.continuation);expect(second).toMatchObject({inspected:1,processed:1,scanComplete:true,continuation:undefined});expect(f.send).not.toHaveBeenCalled();});
});

describe('shared owner-read integrity at every Trip send boundary',()=>{
 it('missing or wrong trusted lookup key cannot construct Trip send authority',async()=>{
  const f=await fixture(),missing=new InquiryEmailOutbox(f.db,workspace,ring,f.clock);
  await expect(missing.dispatchTrip390One(f.read().id,f.issued,f.env,f.send as typeof fetch)).rejects.toMatchObject({code:'UNAVAILABLE'});
  const wrong=new InquiryEmailOutbox(f.db,workspace,ring,f.clock,'wrong-key-material'.repeat(4));
  await expect(wrong.dispatchTrip390One(f.read().id,f.issued,f.env,f.send as typeof fetch)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.writes).toEqual(['queue']);expect(f.send).not.toHaveBeenCalled();
 });
 it('intact AEAD plus consistently corrupted app/journal HMAC is rejected just like ordinary owner read',async()=>{
  const f=await fixture();f.setApplicationDigest('f'.repeat(64));f.setOperationDigest('f'.repeat(64));
  expect(()=>decodeStoredGroupApplication(workspace,f.getStored(),ring,digestKey)).toThrow();
  await expect(f.dispatch()).rejects.toMatchObject({code:'UNAVAILABLE'});expect(f.writes).toEqual(['queue']);expect(f.send).not.toHaveBeenCalled();expect(f.read().state).toBe('queued');
 });
 // Numbered SQL normally prevents independent app/operation digest mismatch.
 // These cases deliberately model a corrupted SQL adapter, not valid SQL writes.
 it.each(['application','operation'] as const)('corrupted %s digest before claim is held without reservation',async kind=>{
  const f=await fixture();if(kind==='application')f.setApplicationDigest('f'.repeat(64));else f.setOperationDigest('f'.repeat(64));
  if(kind==='application')await expect(f.dispatch()).rejects.toMatchObject({code:'UNAVAILABLE'});else expect(await f.dispatch()).toBe('idle');expect(f.writes).toEqual(['queue']);expect(f.send).not.toHaveBeenCalled();
 });
 it.each(['application','operation'] as const)('corrupted %s digest after OAuth starts no message HTTP and restores only own reservation',async kind=>{
  const f=await fixture();f.send.mockImplementation(async()=>{if(kind==='application')f.setApplicationDigest('f'.repeat(64));else f.setOperationDigest('f'.repeat(64));return new Response(JSON.stringify({access_token:'synthetic'}));});
  expect(await f.dispatch()).toBe('queued');expect(f.send).toHaveBeenCalledTimes(1);expect(String(f.send.mock.calls[0]![0])).toContain('oauth2');expect(f.writes).toEqual(['queue','reserve','restore']);
 });
 it('every selected operation digest must match, not only the controlled matching operation',async()=>{
  const f=await fixture(),original=f.query.getMockImplementation()!;f.query.mockImplementation(async(sql,values)=>sql.startsWith('SELECT operation_id')?[{operationId:operation,requestDigest:f.getStored().requestDigest},{operationId:id(91),requestDigest:'f'.repeat(64)}]:original(sql,values));
  expect(await f.dispatch()).toBe('idle');expect(f.writes).toEqual(['queue']);expect(f.send).not.toHaveBeenCalled();
 });
 it('post-OAuth integrity refusal cannot reset a different reservation',async()=>{
  const f=await fixture();f.send.mockImplementation(async()=>{f.setApplicationDigest('f'.repeat(64));f.read().reservedAt=new Date(initial.valueOf()+1);return new Response(JSON.stringify({access_token:'synthetic'}));});
  expect(await f.dispatch()).toBe('unknown');expect(f.send).toHaveBeenCalledTimes(1);expect(f.writes).toEqual(['queue','reserve']);
 });
});
