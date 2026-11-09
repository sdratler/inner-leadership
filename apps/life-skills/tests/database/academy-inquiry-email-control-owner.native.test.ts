import {randomUUID} from 'node:crypto';
import {afterAll,beforeAll,expect,test,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {academyTestDatabase,academyWorkspace} from './academy-free-registration-fixture.ts';
import {poolStore} from './calendar/fixture.ts';
import {currentTrip390Fields} from '../fixtures/trip390-current.ts';
import {PublicGroupApplicationStore} from '../../src/features/group-application/store.ts';
import {InquiryEmailControlVerification} from '../../src/features/group-application/academy-inquiry-email-verification.ts';
import {freshActor} from '../../src/features/identity/data.ts';
import {requirePractitioner} from '../../src/features/cases/policy.ts';
import type {IdentityStore} from '../../src/features/identity/store.ts';
import {systemClock} from '../../src/features/identity/types.ts';
import {groupApplicationReviewHttp} from '../../src/features/group-application/review-http.ts';
import {groupApplicationPayloadAad,groupApplicationRequestDigest} from '../../src/features/group-application/group-application-record.ts';
import {trip390V1InterestSchema,TRIP390_V1_INTEREST_VERSION,TRIP390_V1_NOTICE_VERSION,TRIP390_V1_OFFER} from '../../src/features/group-application/academy-trip390-v1.ts';
import {seal} from '../../src/features/identity/crypto.ts';
import {SESSION_COOKIE} from '../../src/lib/security/session.ts';
import type {SqlSession} from '../../src/features/identity/store.ts';

let db:Awaited<ReturnType<typeof academyTestDatabase>>;
beforeAll(async()=>{db=await academyTestDatabase();},60000);
afterAll(async()=>{await db?.close();});
test('ordinary owner evidence is reread after a separate-session revocation during the proof lookup',async()=>{
 const f=await academyWorkspace(db.pool),store=poolStore(db.pool);
 const fields={...currentTrip390Fields(),email:'synthetic-owner-control-'+randomUUID()+'@example.invalid'};
 const saved=await new PublicGroupApplicationStore(store,f.workspace,f.ring,f.digestKey,systemClock,false).submit({operationId:randomUUID(),fields});
 const config={workspaceId:f.workspace,keyring:f.ring,requestDigestKey:f.digestKey,lookupKey:f.runtime.config.lookupKey,securityLifetimeMs:900000};
 const verification=new InquiryEmailControlVerification(store,config);let token='';
 await verification.issue(saved.item.id,async(_tx,action)=>{token=action.token;});
 expect(await verification.confirmPost({method:'POST',token})).toEqual({state:'confirmed'});
 const authorize=async(tx:SqlSession)=>{requirePractitioner(await freshActor(tx,f.owner.actor,new Date()));};
 expect(await verification.readEvidence(saved.item.id,authorize)).toMatchObject({kind:'inquiry_mailbox_control_only',applicationId:saved.item.id});
 let revoked=false;
 const barred:IdentityStore={transaction:work=>store.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=>{
  const rows=await tx.query<T>(sql,values);
  if(!revoked&&sql.includes('FROM ls_service_interest.inquiry_email_control_verifications')){
   revoked=true;
   // A different physical pool connection commits while the proof read-only
   // transaction remains open. No readonly flag is bypassed or mocked.
   await db.pool.query('UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND token_digest=$2',[f.workspace,f.owner.actor.sessionDigest]);
  }
  return rows;
 }}))};
 await expect(new InquiryEmailControlVerification(barred,config).readEvidence(saved.item.id,authorize)).rejects.toMatchObject({code:'UNAUTHENTICATED'});
 expect(revoked).toBe(true);
 // The mailbox proof itself remains intact; it does not grant owner access.
 expect(await verification.readEvidence(saved.item.id)).toMatchObject({kind:'inquiry_mailbox_control_only'});
},30000);
test('enabling mailbox readback preserves an ordinary-owner historical inquiry detail response',async()=>{
 const f=await academyWorkspace(db.pool),store=poolStore(db.pool),reference=randomUUID();
 const {lessonDayDriving:_driving,...current}=currentTrip390Fields();void _driving;
 const fields=trip390V1InterestSchema.parse({...current,version:TRIP390_V1_INTEREST_VERSION,offerVersion:TRIP390_V1_OFFER.version,acknowledgment:{version:TRIP390_V1_NOTICE_VERSION,language:'en',conductExplained:true,interestPrivacySafety:true,whatsapp:false}});
 await db.pool.query('INSERT INTO ls_service_interest.public_applications(workspace_id,id,contact_digest,request_digest,payload_ciphertext,notice_version,notice_language,received_at) VALUES($1,$2,$3,$4,$5,$6,$7,clock_timestamp())',[f.workspace,reference,'a'.repeat(64),groupApplicationRequestDigest(f.workspace,fields,f.digestKey),seal(JSON.stringify(fields),groupApplicationPayloadAad(f.workspace,reference),f.ring),fields.acknowledgment.version,fields.acknowledgment.language]);
 const verification=new InquiryEmailControlVerification(store,{workspaceId:f.workspace,keyring:f.ring,requestDigestKey:f.digestKey,lookupKey:f.runtime.config.lookupKey,securityLifetimeMs:900000});
 const emailControl=vi.fn(async(_actor:unknown,id:string)=>{const proof=await verification.readEvidence(id);return proof?{kind:proof.kind,applicationId:proof.applicationId,verifiedAt:proof.verifiedAt}:null;});
 const response=await groupApplicationReviewHttp(new Request(f.origin+'/api/private/group-applications?reference='+reference,{headers:{host:new URL(f.origin).host,'x-forwarded-proto':'https',cookie:SESSION_COOKIE+'='+f.owner.token}}),async()=>({origin:f.origin,actor:(token:string)=>f.runtime.sessions.actor(token),store:new PublicGroupApplicationStore(store,f.workspace,f.ring,f.digestKey),emailControl}));
 expect(response.status).toBe(200);const body=await response.json();expect(body.data.items[0]).toMatchObject({id:reference,fields});expect(body.data).not.toHaveProperty('emailControl');expect(emailControl).not.toHaveBeenCalled();
},30000);
