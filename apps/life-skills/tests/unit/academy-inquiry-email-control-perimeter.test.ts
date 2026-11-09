import {expect,it} from 'vitest';
import {groupApplicationReleasePath} from '../../src/proxy.ts';
const key=(seed:string)=>Buffer.alloc(32,seed).toString('base64url');
const env={NODE_ENV:'production',LS_APP_MODE:'foundation_locked',LS_APP_ORIGIN:'https://life-skills.bneineviimacademy.org',LS_PRIVATE_APP_ENABLED:'true',LS_GROUP_APPLICATION_REAL_DATA_RELEASE:'true',LS_IDENTITY_ENABLED:'true',LS_IDENTITY_WORKSPACE_ID:'00000000-0000-4000-8000-000000000001',LS_IDENTITY_ACTIVE_KEY_ID:'v1',LS_IDENTITY_DATA_KEYS:JSON.stringify({v1:key('a')}),LS_IDENTITY_CSRF_KEY:key('b'),LS_IDENTITY_LOOKUP_KEY:key('c'),LS_IDENTITY_RATE_KEY:key('d'),LS_ACADEMY_FREE_REGISTRATION_ENABLED:'false',LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ENABLED:'true'};
it('opens exactly the existing confirmation transport with founder features off',()=>{
 for(const path of ['/api/public/academy-founder','/en/florida/confirm-interest','/he/florida/confirm-interest']){
  expect(groupApplicationReleasePath(path,env)).toBe(true);
  expect(groupApplicationReleasePath(path,{...env,LS_ACADEMY_INQUIRY_EMAIL_CONTROL_ENABLED:'false'})).toBe(false);
  expect(groupApplicationReleasePath(path,{...env,LS_IDENTITY_ENABLED:'false'})).toBe(false);
  expect(groupApplicationReleasePath(path,{...env,LS_GROUP_APPLICATION_REAL_DATA_RELEASE:'false'})).toBe(false);
 }
});
it('does not release private, financial, BNA or arbitrary lookalike routes',()=>{
 for(const path of ['/api/private/group-applications','/en/app/group-applications','/api/private/billing','/api/public/bna-inquiries','/api/public/academy-founder/confirm','/en/florida/confirm-inquiry-email','/fr/florida/confirm-interest'])expect(groupApplicationReleasePath(path,env),path).toBe(false);
});
