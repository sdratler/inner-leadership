import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {publicGroupApplicationHttp} from '../../src/features/group-application/http.ts';
import {TRIP390_MEDIA_TYPE} from '../../src/features/group-application/academy-trip390-transport.ts';
import {TRIP390_OFFER} from '../../src/features/group-application/academy-trip390-contract.ts';
import {currentTrip390Fields} from '../fixtures/trip390-current.ts';

it.each(['new','replay','duplicate','failed-mail'] as const)('keeps %s save and prospective one-email hook distinct from historical ACK dispatch',async mode=>{
 const origin='https://bneineviimacademy.org',url=origin+'/api/public/group-applications?program=sunday_fishing_academy';
 const reference=randomUUID(),operationId=randomUUID(),fields=currentTrip390Fields();let now=Date.now(),durable=false;
 const saved={saved:true as const,replayed:mode==='replay',duplicate:mode==='duplicate',item:{id:reference,source:'public_group_application' as const,state:'owner_review' as const,fields,receivedAt:new Date(now).toISOString()}};
 const submit=vi.fn(async()=>{durable=true;return saved;});
 const replaySaved=vi.fn(async()=>mode==='replay'?(durable=true,saved):null);
 const afterCommit=vi.fn(async()=>{throw Error('OLD_ACK_MUST_NOT_RUN');});
 const afterNewTrip390Save=vi.fn(async()=>{expect(durable).toBe(true);if(mode==='failed-mail')throw Error('CONTROLLED_TRANSPORT_FAILURE');return 'sent' as const;});
 const deps=async()=>({enabled:true,environment:{NODE_ENV:'production',LS_APP_ORIGIN:origin,LS_ACADEMY_PUBLIC_OFFER:TRIP390_OFFER.version},trip390ReservationAdmitted:true,challengeKey:'synthetic-challenge-key-at-least-thirty-two-characters',now:()=>now,limits:{consume:async()=>({count:1,retryAfterMs:0})},store:{submit,replaySaved},afterCommit,afterNewTrip390Save});
 const headers={host:new URL(origin).host,accept:TRIP390_MEDIA_TYPE};
 const initial=await publicGroupApplicationHttp(new Request(url,{headers}),deps);expect(initial.status).toBe(200);
 const challenge=(await initial.json()).data.challenge,cookie=initial.headers.get('set-cookie')!.split(';')[0]!;now+=1600;
 const result=await publicGroupApplicationHttp(new Request(url,{method:'POST',headers:{...headers,origin,'sec-fetch-site':'same-origin','content-type':'application/json',cookie},body:JSON.stringify({operationId,fields,challenge,website:''})}),deps);
 expect(result.status).toBe(mode==='replay'||mode==='duplicate'?200:201);
 expect((await result.json()).data).toMatchObject({reference,operationId,replayed:mode==='replay',acknowledgment:mode==='new'?'sent':mode==='failed-mail'?'unknown':'not_queued'});
 expect(afterCommit).not.toHaveBeenCalled();
 if(mode==='new'||mode==='failed-mail')expect(afterNewTrip390Save).toHaveBeenCalledExactlyOnceWith(reference);else expect(afterNewTrip390Save).not.toHaveBeenCalled();
});
