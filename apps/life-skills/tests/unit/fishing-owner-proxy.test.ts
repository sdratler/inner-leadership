import {NextRequest} from 'next/server';
import {afterEach,it,expect,vi} from 'vitest';
import {proxy} from '../../src/proxy.ts';
import {FISHING_OWNER_APP_SCOPE_V1} from '../../src/lib/fishing-owner-app-scope.ts';
const origin='https://life-skills.example.invalid',workspace='00000000-0000-4000-8000-000000000001',owner='00000000-0000-4000-8000-000000000002';
function configured(selected=true){
 const key=(seed:string)=>Buffer.alloc(32,seed).toString('base64url');
 const env={NODE_ENV:'production',LS_APP_MODE:'foundation_locked',LS_APP_ORIGIN:origin,LS_PRIVATE_APP_ENABLED:'true',LS_GROUP_APPLICATION_REAL_DATA_RELEASE:'true',LS_IDENTITY_ENABLED:'true',LS_IDENTITY_WORKSPACE_ID:workspace,
  LS_IDENTITY_ACTIVE_KEY_ID:'v1',LS_IDENTITY_DATA_KEYS:JSON.stringify({v1:key('a')}),LS_IDENTITY_CSRF_KEY:key('b'),LS_IDENTITY_LOOKUP_KEY:key('c'),LS_IDENTITY_RATE_KEY:key('d'),LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:owner};
 for(const [name,value] of Object.entries(env))vi.stubEnv(name,value);
 if(selected)vi.stubEnv('LS_FISHING_OWNER_APP_SCOPE_JSON',JSON.stringify({version:FISHING_OWNER_APP_SCOPE_V1,workspaceId:workspace,ownerAccountId:owner}));
}
afterEach(()=>vi.unstubAllEnvs());
it('the actual selected perimeter rejects retired direct pages and APIs before handler rendering',()=>{
 configured();
 for(const path of ['/en/app/practice','/he/family/schedule','/en/client','/he/sample','/en/intake','/he/intake/staff','/api/intake','/api/intake-preview','/en/app/payments','/en/app/cases/00000000-0000-4000-8000-000000000003','/api/home-practice','/api/private/bna-inquiries','/api/identity/invites/parent','/api/private/unknown']){
  const result=proxy(new NextRequest(origin+path));expect(result.status,path).toBe(404);expect(result.headers.get('content-security-policy')).toBeTruthy();
 }
});
it('redirects default entries without carrying old private queries and keeps actual owner destinations guarded',()=>{
 configured();
 for(const locale of ['en','he']){
  const result=proxy(new NextRequest(origin+`/${locale}/app/calendar?caseId=private&mode=demo`));
  expect(result.headers.get('location')).toBe(origin+`/${locale}/app/group-applications`);
  for(const path of ['clients','group-applications','fishing-groups','marketing'])expect(proxy(new NextRequest(origin+`/${locale}/app/${path}`)).headers.get('x-middleware-next')).toBe('1');
 }
 expect(proxy(new NextRequest(origin+'/api/private/academy-crm',{method:'POST'})).headers.get('x-middleware-next')).toBe('1');
});
it('invalid explicit scope fails closed instead of falling back to the old app',()=>{
 configured();vi.stubEnv('LS_FISHING_OWNER_APP_SCOPE_JSON','{}');
 expect(proxy(new NextRequest(origin+'/en/app/clients')).status).toBe(503);
});
it('does not select scope from a URL, owner role hint or feature availability',()=>{
 configured(false);
 const result=proxy(new NextRequest(origin+'/en/app/practice?scope=fishing_owner&role=owner'));
 expect(result.headers.get('x-middleware-next')).toBe('1');
});
it('preserves the separate public inquiry perimeter and actual canonical-transport rejection',()=>{
 configured();
 for(const path of ['/en/florida','/he/florida/apply'])expect(proxy(new NextRequest(origin+path)).headers.get('x-middleware-next')).toBe('1');
 expect(proxy(new NextRequest(origin+'/api/public/group-applications',{method:'POST'})).headers.get('x-middleware-next')).toBe('1');
 expect(proxy(new NextRequest('http://life-skills.example.invalid/en/app/clients')).status).toBe(503);
});
it.each(['/api/private/academy-crm','/api/private/fishing-group-preparations','/api/private/fishing-inquiry-family-proposals','/api/private/fishing-program-sources','/api/private/fishing-marketing'])('%s validates original transport before trusted-header rewriting',path=>{
 configured();
 expect(proxy(new NextRequest('http://life-skills.example.invalid'+path,{method:'POST'})).status).toBe(503);
 for(const headers of [
  {'x-forwarded-host':'life-skills.example.invalid','x-forwarded-proto':'http'},
  {'x-forwarded-host':'life-skills.example.invalid','x-forwarded-proto':'https, http'},
  {'x-forwarded-host':'life-skills.example.invalid, untrusted.invalid','x-forwarded-proto':'https'},
 ])expect(proxy(new NextRequest(origin+path,{method:'POST',headers})).status).toBe(503);
 const accepted=proxy(new NextRequest('http://life-skills.example.invalid'+path,{method:'POST',headers:{host:'life-skills.example.invalid','x-forwarded-host':'life-skills.example.invalid','x-forwarded-proto':'https'}}));
 expect(accepted.headers.get('x-middleware-next')).toBe('1');
});
