import {randomUUID} from 'node:crypto';
import {describe,it,expect,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {currentTrip390Fields} from '../fixtures/trip390-current.ts';
import {trip390CurrentInterestSchema,trip390InterestSchema,TRIP390_INTEREST_VERSION,TRIP390_OFFER} from '../../src/features/group-application/academy-trip390-contract.ts';
import {TRIP390_V3_INTEREST_VERSION,TRIP390_V3_OFFER,trip390V3InterestSchema} from '../../src/features/group-application/academy-trip390-v3.ts';
import {TRIP390_MEDIA_TYPE,TRIP390_V3_MEDIA_TYPE} from '../../src/features/group-application/academy-trip390-transport.ts';
import {publicGroupApplicationHttp} from '../../src/features/group-application/http.ts';
import {academy650AckContent} from '../../src/features/group-application/academy650-r2-ack.ts';
import r2En from '../../src/features/group-application/academy-r2-en.json';
import r2He from '../../src/features/group-application/academy-r2-he.json';

const historical=()=>trip390V3InterestSchema.parse({...currentTrip390Fields(),version:TRIP390_V3_INTEREST_VERSION,offerVersion:TRIP390_V3_OFFER.version,lessonDayDriving:{version:'JLFA-SUNDAY-TOTAL-DRIVE-v1',limit:'up_to_60'}});
describe('prospective R2 identity and immutable historical inquiry',()=>{
 it('preserves the exact V3 tuple, Sunday driving and consent bytes without accepting it as a new V4 write',()=>{
  const old=historical(),before=JSON.stringify(old);
  expect(trip390InterestSchema.parse(old)).toEqual(old);
  expect(JSON.stringify(old)).toBe(before);expect(old.offerVersion).toBe('JLFA-KEYS390-v2');
  expect(trip390CurrentInterestSchema.safeParse(old).success).toBe(false);
  const current=currentTrip390Fields();expect(current.version).toBe(TRIP390_INTEREST_VERSION);
  expect(current.offerVersion).toBe(TRIP390_OFFER.version);
  expect(current.lessonDayDriving.version).toBe('JLFA-LOCAL-LESSON-TOTAL-DRIVE-v2');
  expect(current.acknowledgment).toEqual(old.acknowledgment);
  expect(trip390V3InterestSchema.safeParse(current).success).toBe(false);
 });
 it('answers an exact V3 replay but cannot create a V3 lead or queue mail under the new offer',async()=>{
  const fields=historical(),operationId=randomUUID(),reference=randomUUID(),key='synthetic-r2-version-key-at-least32',origin='https://unit.example.invalid';let now=Date.now();
  const submit=vi.fn(),replaySaved=vi.fn().mockResolvedValue(null),afterCommit=vi.fn();
  const deps={enabled:true,trip390ReservationAdmitted:true,environment:{NODE_ENV:'test',LS_APP_ORIGIN:origin,LS_ACADEMY_PUBLIC_OFFER:TRIP390_OFFER.version},challengeKey:key,now:()=>now,limits:{consume:vi.fn(async()=>({count:1,retryAfterMs:1000}))},store:{submit,replaySaved},afterCommit};
  const url=origin+'/api/public/group-applications?program=sunday_fishing_academy',headers={host:'unit.example.invalid',accept:TRIP390_V3_MEDIA_TYPE};
  const get=await publicGroupApplicationHttp(new Request(url,{headers}),async()=>deps);expect(get.status).toBe(200);
  const issued=(await get.json()).data,cookie=get.headers.get('set-cookie')!.split(';')[0]!;now+=1600;
  const post=(accept=TRIP390_V3_MEDIA_TYPE)=>publicGroupApplicationHttp(new Request(url,{method:'POST',headers:{...headers,accept,origin,cookie,'sec-fetch-site':'same-origin','content-type':'application/json'},body:JSON.stringify({operationId,fields,challenge:issued.challenge,website:''})}),async()=>deps);
  expect((await post()).status).toBe(400);
  replaySaved.mockResolvedValue({saved:true,replayed:true,duplicate:true,item:{id:reference},acknowledgment:'unknown'});
  const replay=await post();expect(replay.status).toBe(200);expect((await replay.json()).data).toMatchObject({reference,operationId,replayed:true,acknowledgment:'unknown'});
  expect((await post(TRIP390_MEDIA_TYPE)).status).toBe(403);
  expect(submit).not.toHaveBeenCalled();expect(afterCommit).not.toHaveBeenCalled();
 });
 it.each(['en','he'] as const)('renders the exact %s R2 receipt for ordered siblings and the real reference, without starting payment',locale=>{
  const catalog=locale==='he'?r2He:r2En,reference=randomUUID(),children=[{id:randomUUID(),name:'Older <Synthetic>'},{id:randomUUID(),name:'Younger {{requestReference}}'}];
  const content=academy650AckContent({reference,parentFirstName:null,children,messageLanguage:locale});
  const names=new Intl.ListFormat(locale,{style:'long',type:'conjunction'}).format(children.map(c=>c.name));
  const expected=[catalog.ackEmail.greetingFallback,...catalog.ackEmail.paragraphs.map(s=>s.replace(/\{\{([^{}]+)\}\}/g,(_m,k:string)=>({childrenDisplayNames:names,requestReference:reference})[k as 'childrenDisplayNames'|'requestReference'])),[catalog.ackEmail.closing,...catalog.ackEmail.signature].join('\n')].join('\n\n');
  expect(content.text).toBe(expected);expect(content.subject).toBe(catalog.ackEmail.subject);
  expect(content.html).toContain('Older &lt;Synthetic&gt;');expect(content.text).toContain('Younger {{requestReference}}');
  expect(content.text).toContain(reference);expect(content.grantsSend).toBe(false);
  expect(content.text).not.toMatch(/seven|7 days|payment deadline|reserved seat|390/i);
 });
});
