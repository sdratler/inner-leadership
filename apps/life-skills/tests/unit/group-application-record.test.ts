import {randomUUID} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {asId} from '../../src/lib/ids.ts';
import {privateDigest} from '../../src/features/contact-ops/server/digests.ts';
import {seal} from '../../src/features/identity/crypto.ts';
import {decodeStoredGroupApplication,groupApplicationPayloadAad,groupApplicationRequestDigest} from '../../src/features/group-application/group-application-record.ts';
import {currentTrip390Fields} from '../fixtures/trip390-current.ts';
import {historicalTrip390V2Fields} from '../fixtures/trip390-v2.ts';
import {TRIP390_V1_INTEREST_VERSION,TRIP390_V1_NOTICE_VERSION,TRIP390_V1_OFFER} from '../../src/features/group-application/academy-trip390-v1.ts';
import type {GroupApplicationFields} from '../../src/features/group-application/contract.ts';

const workspace=asId(randomUUID(),'workspace'),key='synthetic-existing-request-digest-key-07';
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,65)}};
function row(fields:GroupApplicationFields){const id=randomUUID();return {id,requestDigest:privateDigest({domain:'public-group-application/v1',workspace,fields},key),payloadCiphertext:seal(JSON.stringify(fields),`ls_service_interest/public_application/v1/${workspace}/${id}`,ring),receivedAt:new Date('2026-11-04T12:00:00Z')};}
function v1():GroupApplicationFields{
 const current=currentTrip390Fields(),{phone:_,lessonDayDriving:__,...base}=current;void _;void __;
 return {...base,version:TRIP390_V1_INTEREST_VERSION,offerVersion:TRIP390_V1_OFFER.version,notes:'Synthetic historical answer',acknowledgment:{version:TRIP390_V1_NOTICE_VERSION,language:'en',conductExplained:true,interestPrivacySafety:true,whatsapp:false}};
}
describe('one authenticated stored-record decoder for owner read and scoped sender',()=>{
 it.each([v1,historicalTrip390V2Fields,currentTrip390Fields])('preserves the original HMAC domain, AAD and versioned tuple %#',make=>{
  const fields=make(),saved=row(fields);
  expect(groupApplicationRequestDigest(workspace,fields,key)).toBe(saved.requestDigest);
  expect(groupApplicationPayloadAad(workspace,saved.id)).toBe(`ls_service_interest/public_application/v1/${workspace}/${saved.id}`);
  expect(decodeStoredGroupApplication(workspace,saved,ring,key)).toEqual({id:saved.id,source:'public_group_application',state:'owner_review',receivedAt:saved.receivedAt.toISOString(),fields});
 });
 it('rejects intact authenticated ciphertext when its saved request HMAC is corrupt',()=>{
  const saved=row(currentTrip390Fields());expect(()=>decodeStoredGroupApplication(workspace,{...saved,requestDigest:'0'.repeat(64)},ring,key)).toThrow('UNAVAILABLE');
 });
 it('does not accept a different trusted-key binding or replay ciphertext across reference/workspace',()=>{
  const saved=row(currentTrip390Fields());
  expect(()=>decodeStoredGroupApplication(workspace,saved,ring,'different-synthetic-digest-key-07')).toThrow('UNAVAILABLE');
  expect(()=>decodeStoredGroupApplication(workspace,{...saved,id:randomUUID()},ring,key)).toThrow('UNAVAILABLE');
  expect(()=>decodeStoredGroupApplication(asId(randomUUID(),'workspace'),saved,ring,key)).toThrow('UNAVAILABLE');
 });
 it('refuses invalid row timestamps rather than returning a partial saved record',()=>{
  const saved=row(currentTrip390Fields());expect(()=>decodeStoredGroupApplication(workspace,{...saved,receivedAt:new Date('invalid')},ring,key)).toThrow('UNAVAILABLE');
 });
});
