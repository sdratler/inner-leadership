import { randomUUID } from 'node:crypto';
import { expect,it } from 'vitest';
import { opaqueToken } from '../../src/features/identity/crypto.ts';
import { individualTripReleasePath,individualTripPublicAsset } from '../../src/features/individual-trips/route-admission.ts';
import { currentTripPublicConfig } from '../../src/features/individual-trips/public-photo.ts';
import { tripRuntimeConfig } from '../../src/features/individual-trips/config.ts';
import { parseIdentityConfig } from '../../src/features/identity/config.ts';
const workspace=randomUUID(),env={LS_IDENTITY_ENABLED:'true',LS_APP_ORIGIN:'https://life-skills.bneineviimacademy.org',LS_IDENTITY_WORKSPACE_ID:workspace,LS_IDENTITY_DATA_KEYS:JSON.stringify({synthetic:opaqueToken()}),LS_IDENTITY_ACTIVE_KEY_ID:'synthetic',LS_IDENTITY_CSRF_KEY:opaqueToken(),LS_IDENTITY_LOOKUP_KEY:opaqueToken(),LS_IDENTITY_RATE_KEY:opaqueToken(),LS_INDIVIDUAL_TRIPS_ENABLED:'true',LS_INDIVIDUAL_TRIPS_WORKSPACE_ID:workspace,LS_INDIVIDUAL_TRIPS_OWNER_ACCOUNT_ID:randomUUID()};
it('admits only the configured Fishing paths and authentication entry points',()=>{
 for(const path of ['/en/trips','/he/trips/owner','/api/individual-trips','/api/individual-trips/register','/api/individual-trips/owner-action','/api/individual-trips/chat-grants','/en/login','/api/identity/session'])expect(individualTripReleasePath(path,env)).toBe(true);
 for(const path of ['/api/private/bna-inquiries','/en/app','/he/family','/api/identity/accounts/revoke','/api/payments','/fish','/api/individual-trips-other'])expect(individualTripReleasePath(path,env)).toBe(false);
 for(const override of [{LS_INDIVIDUAL_TRIPS_ENABLED:'false'},{LS_INDIVIDUAL_TRIPS_WORKSPACE_ID:randomUUID()},{LS_INDIVIDUAL_TRIPS_OWNER_ACCOUNT_ID:''},{LS_IDENTITY_ENABLED:'false'}])expect(individualTripReleasePath('/en/trips',{...env,...override})).toBe(false);
 expect(()=>tripRuntimeConfig({...env,LS_INDIVIDUAL_TRIPS_WORKSPACE_ID:randomUUID()},parseIdentityConfig(env))).toThrow();
});
it('cannot publish a substituted photo or open the new public route just by setting flags',()=>{
 for(const locale of ['en','he'] as const){expect(currentTripPublicConfig(locale,{...env,LS_INDIVIDUAL_TRIPS_PUBLIC_ENABLED:'true'})).toBeNull();expect(individualTripReleasePath(`/${locale}/florida/trips`,{...env,LS_INDIVIDUAL_TRIPS_PUBLIC_ENABLED:'true'})).toBe(false);}
 for(const method of ['GET','HEAD','POST'])expect(individualTripPublicAsset('/trips/bass-seminar-20261122-original.jpg',method,{...env,LS_INDIVIDUAL_TRIPS_PUBLIC_ENABLED:'true'})).toBe(false);
});
