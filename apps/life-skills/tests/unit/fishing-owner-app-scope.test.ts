import {randomUUID} from 'node:crypto';
import {it,expect,vi} from 'vitest';
import {configuredFishingOwnerAppScope,FISHING_OWNER_APP_SCOPE_V1,fishingOwnerPrivateRoute} from '../../src/lib/fishing-owner-app-scope.ts';
import {parseIdentityConfig} from '../../src/features/identity/config.ts';
import {opaqueToken} from '../../src/features/identity/crypto.ts';
vi.mock('server-only',()=>({}));
it('requires explicit exact server workspace and existing configured owner pins without a role or browser fallback',()=>{
 const workspace=randomUUID(),owner=randomUUID(),selected={version:FISHING_OWNER_APP_SCOPE_V1,workspaceId:workspace,ownerAccountId:owner};
 expect(configuredFishingOwnerAppScope(workspace,{})).toBeNull();
 const env={LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:owner,LS_FISHING_OWNER_APP_SCOPE_JSON:JSON.stringify(selected)};
 expect(configuredFishingOwnerAppScope(workspace,env)?.binding).toEqual({workspaceId:workspace,accountId:owner});
 for(const value of ['', '{}',JSON.stringify({...selected,ownerAccountId:randomUUID()}),JSON.stringify({...selected,workspaceId:randomUUID()}),JSON.stringify({...selected,version:'unknown'}),JSON.stringify({...selected,role:'practitioner'})])
  expect(()=>configuredFishingOwnerAppScope(workspace,{...env,LS_FISHING_OWNER_APP_SCOPE_JSON:value})).toThrow('UNAVAILABLE');
 expect(()=>configuredFishingOwnerAppScope(workspace,{LS_FISHING_OWNER_APP_SCOPE_JSON:JSON.stringify(selected)})).toThrow('UNAVAILABLE');
});
it('propagates only an explicit validated owner scope into existing identity config and refuses child account activation',()=>{
 const workspace=randomUUID(),owner=randomUUID(),env={LS_IDENTITY_ENABLED:'true',LS_APP_ORIGIN:'https://synthetic-owner.invalid',LS_IDENTITY_WORKSPACE_ID:workspace,
  LS_IDENTITY_DATA_KEYS:JSON.stringify({synthetic:opaqueToken()}),LS_IDENTITY_ACTIVE_KEY_ID:'synthetic',LS_IDENTITY_CSRF_KEY:opaqueToken(),LS_IDENTITY_LOOKUP_KEY:opaqueToken(),LS_IDENTITY_RATE_KEY:opaqueToken(),
  LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:owner};
 expect(parseIdentityConfig(env).ownerAccountId).toBeUndefined();
 const selected={...env,LS_FISHING_OWNER_APP_SCOPE_JSON:JSON.stringify({version:FISHING_OWNER_APP_SCOPE_V1,workspaceId:workspace,ownerAccountId:owner})};
 expect(parseIdentityConfig(selected).ownerAccountId).toBe(owner);
 expect(()=>parseIdentityConfig({...selected,LS_CHILD_ACCOUNTS_ENABLED:'true'})).toThrow('UNAVAILABLE');
 expect(()=>parseIdentityConfig({...selected,LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:randomUUID()})).toThrow('UNAVAILABLE');
});
it('preserves the existing useful owner destinations in both languages and redirects only retired default entry routes',()=>{
 for(const locale of ['en','he']){
  for(const page of ['clients','group-applications','fishing-groups','marketing','settings'])expect(fishingOwnerPrivateRoute(`/${locale}/app/${page}`,'GET')).toEqual({kind:'allow'});
  for(const page of ['', '/app','/app/calendar'])expect(fishingOwnerPrivateRoute(`/${locale}${page}`,'GET')).toEqual({kind:'redirect',pathname:`/${locale}/app/group-applications`});
 }
});
it('classifies legacy/parent/demo/BNA/financial paths for denial; actual route/API enforcement awaits mounting',()=>{
 for(const path of ['/en/app/practice','/he/family/schedule','/en/client','/he/sample','/en/app/cases/00000000-0000-4000-8000-000000000000','/en/app/reports','/en/app/payments','/api/home-practice','/api/payments','/api/private/bna-inquiries','/api/private/group-applications/followups','/api/private/unknown','/api/identity/invites/accept'])
  for(const method of ['GET','POST'])expect(fishingOwnerPrivateRoute(path,method)).toEqual({kind:'deny'});
 for(const path of ['/en/app/clients?role=owner','/en/app/%63lients','/en/app/clients#owner'])expect(fishingOwnerPrivateRoute(path,'GET')).toEqual({kind:'deny'});
 expect(fishingOwnerPrivateRoute('/api/private/people','POST')).toEqual({kind:'deny'});
 for(const path of ['/en/app/prospects','/api/prospects','/api/private/contact-inbound','/api/private/contact-acquisition','/api/private/fishing-marketing'])expect(fishingOwnerPrivateRoute(path,'POST')).toEqual({kind:'deny'});
 expect(fishingOwnerPrivateRoute('/api/private/academy-crm','POST')).toEqual({kind:'allow'});
 expect(fishingOwnerPrivateRoute('/api/private/fishing-program-sources','POST')).toEqual({kind:'allow'});
});
