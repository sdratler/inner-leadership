import {afterEach,expect,it,vi} from 'vitest';
import {NextRequest} from 'next/server';
import {proxy} from '../../../src/proxy.ts';
import {academyFamilyCommandSchema,academyFamilyVersion} from '../../../src/features/fishing/academy-family-contract.ts';
const id='11111111-1111-4111-8111-111111111111',body={version:academyFamilyVersion,operationId:id,applicationId:id,expectedFieldsDigest:'a'.repeat(64),personId:id,expectedEpoch:3,expectedAssociationVersion:1,parentEmail:'parent@example.invalid',locale:'en',householdId:null,guardianVerified:true,verificationReference:'Owner verified guardian rights',children:[{learnerIndex:0,displayName:'Child',existingLearnerId:null}]};
it('requires a separate deliberate guardian decision and a bounded ordered learner mapping',()=>{
 expect(academyFamilyCommandSchema.safeParse(body).success).toBe(true);
 for(const change of [{guardianVerified:false},{verificationReference:''},{children:[]},{children:[{...body.children[0],learnerIndex:1}]},{children:[{...body.children[0],existingLearnerId:id},{...body.children[0],learnerIndex:1,existingLearnerId:id}]},{parentEmail:'not-an-email'},{role:'practitioner'},{token:'not-a-grant'}])expect(academyFamilyCommandSchema.safeParse({...body,...change}).success).toBe(false);
});
afterEach(()=>vi.unstubAllEnvs());
it('keeps the new owner family endpoint behind the current private enablement and exact HTTPS forwarding perimeter',()=>{
 const origin='https://life-skills.bneineviimacademy.org',path='/api/private/group-applications/family';vi.stubEnv('NODE_ENV','production');vi.stubEnv('LS_APP_MODE','foundation_locked');vi.stubEnv('LS_APP_ORIGIN',origin);vi.stubEnv('LS_PRIVATE_APP_ENABLED','false');
 expect(proxy(new NextRequest(origin+path)).status).toBe(503);vi.stubEnv('LS_PRIVATE_APP_ENABLED','true');expect(proxy(new NextRequest(origin+path)).headers.get('x-middleware-next')).toBe('1');
 for(const request of [new NextRequest('http://life-skills.bneineviimacademy.org'+path),new NextRequest('https://untrusted.invalid'+path),new NextRequest(origin+path,{headers:{'x-forwarded-proto':'https,http','x-forwarded-host':'life-skills.bneineviimacademy.org'}})])expect(proxy(request).status).toBe(503);
});
