import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {AcademyFounderStore,type FounderFamily} from '../../src/features/group-application/academy-founder-store.ts';
import type {FounderMail} from '../../src/features/group-application/academy-founder-email.ts';
import {captureCommunicationPreferences,communicationPreferenceSelection} from '../../src/features/group-application/academy-communication-preferences.ts';
import {seal,unseal} from '../../src/features/identity/crypto.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {asId} from '../../src/lib/ids.ts';
const workspace=asId('6d346aba-184b-4ab3-af25-a51bac7ef375','workspace'),familyId='12a02a4e-b1b6-4510-88d7-2e15085399f9',messageId='c07174f7-a0d5-4e21-b8a9-f776557ed0d6',applicationId='96b090d9-a884-42bc-8f8b-8fdc43db64d9';
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}},at=new Date('2030-01-01T12:00:00Z');
const window={generation:1,sentAt:null,deadline:null,exception:false,confirmedAt:null};
function family():FounderFamily{return {id:familyId,reference:applicationId,status:'offered',allocated:true,revision:2,submittedAt:at.toISOString(),locale:'en',email:'synthetic@example.invalid',parentName:'Synthetic Parent',children:[{id:'child',name:'Synthetic Child',age:12}],identityApproved:true,interest:{...window},payment:{...window},tokenHash:null,paused:false,offer:{id:'offer',group:'Synthetic Group',groupId:'group',firstSession:'2030-02-01T12:00:00Z',paymentUrl:'https://example.invalid/payment',terms:'Synthetic',priceVersion:'synthetic',children:[{id:'child',name:'Synthetic Child',amount:1650}]},redeemedChildIds:[],collectedCents:0,enrolledChildIds:[],communicationPreferences:captureCommunicationPreferences(communicationPreferenceSelection('en',false,false,'en'),applicationId,at)};}
const daily={reminderDate:'2030-01-01',unpaidLines:[{childId:'child',offerId:'offer',revision:1,name:'Synthetic Child',unpaidCents:165000,deadline:'2030-01-08T12:00:00Z'}]};
function payload(f:FounderFamily,locale:'en'|'he'='he'):FounderMail{return {...daily,familyId:f.id,generation:1,kind:'payment_reminder',locale,to:f.email,reference:f.reference,status:'reserved',offer:f.offer!};}
async function run(options:{state?:string;reserved?:boolean;provider?:boolean;changedLines?:boolean;newMessage?:boolean;selectedLanguage?:'en'|'he';missingPreferences?:boolean;malformedPreferences?:boolean;invalidPreparedLocale?:boolean}={}){
 const f=family();if(options.selectedLanguage)f.communicationPreferences=captureCommunicationPreferences(communicationPreferenceSelection(options.selectedLanguage,false,false,'en'),applicationId,at);if(options.missingPreferences)delete f.communicationPreferences;if(options.malformedPreferences)Reflect.set(f,'communicationPreferences',{selection:{parentLanguage:'he'}});
 const before=payload(f);if(options.invalidPreparedLocale)Reflect.set(before,'locale','bad');
 const aad=`ls_service_interest/inquiry_email/v1/${workspace}/${messageId}`,ciphertext=seal(JSON.stringify(before),aad,ring),writes:Array<{sql:string;values:readonly unknown[]}>=[];
 const tx:SqlSession={query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  if(sql.startsWith('SELECT id,state,reserved_at'))return (options.newMessage?[]:[{id:messageId,state:options.state??'queued',reserved:options.reserved?at:null,provider:options.provider?'synthetic_provider':null,ciphertext}]) as T[];
  writes.push({sql,values});return [];
 }};
 const db:IdentityStore={transaction:async()=>{throw Error('No database transactions in synthetic queue test');}};
 const store=new AcademyFounderStore(db,workspace,ring,'synthetic-private-digest-key-for-unit-only',{now:()=>at});
 const queue=Reflect.get(store,'queue') as (tx:SqlSession,f:FounderFamily,kind:'payment_reminder',key:string,input:typeof daily)=>Promise<void>;
 let error:unknown;try{await queue.call(store,tx,f,'payment_reminder','daily:2030-01-01',options.changedLines?{...daily,unpaidLines:[{...daily.unpaidLines[0]!,unpaidCents:150000}]}:daily);}catch(e){error=e;}
 const outbox=writes.filter(w=>w.sql.includes('ls_service_interest.inquiry_email_outbox'));
 const decoded=outbox.map(w=>{const insert=w.sql.startsWith('INSERT'),id=insert?String(w.values[1]):messageId,encrypted=String(w.values[insert?4:2]);return JSON.parse(unseal(encrypted,`ls_service_interest/inquiry_email/v1/${workspace}/${id}`,ring)) as FounderMail;});
 return {f,before,ciphertext,writes,outbox,decoded,error};
}
describe('prepared reminder language is immutable across preference adoption',()=>{
 it('does not rebuild an otherwise unchanged queued reminder just because preference language changed',async()=>{const r=await run();expect(r.error).toBeUndefined();expect(r.outbox).toEqual([]);});
 it('preserves prepared language while the existing unpaid-lines rebuild still updates amounts',async()=>{const r=await run({changedLines:true});expect(r.error).toBeUndefined();expect(r.decoded).toHaveLength(1);expect(r.decoded[0]).toMatchObject({locale:'he',unpaidLines:[{unpaidCents:150000}]});expect(r.decoded[0]!.locale).toBe(r.before.locale);});
 it('preserves old language when a canceled unreserved same-key record is rebuilt',async()=>{const r=await run({state:'canceled'});expect(r.error).toBeUndefined();expect(r.decoded[0]?.locale).toBe('he');});
 it.each([{state:'unknown'},{state:'sent'},{state:'queued',reserved:true},{state:'queued',provider:true}])('does not touch payload bytes for protected existing record %#',async options=>{const r=await run({...options,changedLines:true,malformedPreferences:true});expect(r.error).toBeUndefined();expect(r.outbox).toEqual([]);expect(r.writes).toEqual([]);});
 it('uses explicit preference only for a genuinely new message record',async()=>{const r=await run({newMessage:true,selectedLanguage:'he'});expect(r.error).toBeUndefined();expect(r.outbox).toHaveLength(1);expect(r.outbox[0]!.sql).toMatch(/^INSERT/);expect(r.decoded[0]?.locale).toBe('he');});
 it('keeps historic operational locale for a new legacy transactional record without inventing preference evidence',async()=>{const r=await run({newMessage:true,missingPreferences:true});expect(r.error).toBeUndefined();expect(r.f).not.toHaveProperty('communicationPreferences');expect(r.decoded[0]?.locale).toBe('en');});
 it('rejects malformed new preference evidence before inserting a message',async()=>{const r=await run({newMessage:true,malformedPreferences:true});expect(r.error).toBeDefined();expect(r.outbox).toEqual([]);});
 it('fails closed on invalid prepared language instead of replacing it with a current preference',async()=>{const r=await run({invalidPreparedLocale:true});expect(r.error).toBeDefined();expect(r.outbox).toEqual([]);});
});
