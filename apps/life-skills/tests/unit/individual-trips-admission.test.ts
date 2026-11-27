import { randomUUID } from 'node:crypto';
import { expect,it } from 'vitest';
import { opaqueToken } from '../../src/features/identity/crypto.ts';
import { individualTripReleasePath,individualTripPublicAsset } from '../../src/features/individual-trips/route-admission.ts';
import { currentTripPublicConfig,TRIP_PUBLIC_PHOTO } from '../../src/features/individual-trips/public-photo.ts';
import { tripRuntimeConfig } from '../../src/features/individual-trips/config.ts';
import { parseIdentityConfig } from '../../src/features/identity/config.ts';
const workspace=randomUUID(),env={LS_IDENTITY_ENABLED:'true',LS_APP_ORIGIN:'https://life-skills.bneineviimacademy.org',LS_IDENTITY_WORKSPACE_ID:workspace,LS_IDENTITY_DATA_KEYS:JSON.stringify({synthetic:opaqueToken()}),LS_IDENTITY_ACTIVE_KEY_ID:'synthetic',LS_IDENTITY_CSRF_KEY:opaqueToken(),LS_IDENTITY_LOOKUP_KEY:opaqueToken(),LS_IDENTITY_RATE_KEY:opaqueToken(),LS_INDIVIDUAL_TRIPS_ENABLED:'true',LS_INDIVIDUAL_TRIPS_WORKSPACE_ID:workspace,LS_INDIVIDUAL_TRIPS_OWNER_ACCOUNT_ID:randomUUID()};
it('admits only the configured Fishing paths and authentication entry points',()=>{
 for(const path of ['/en/trips','/he/trips/owner','/api/individual-trips','/api/individual-trips/register','/api/individual-trips/owner-action','/api/individual-trips/chat-grants','/en/login','/api/identity/session'])expect(individualTripReleasePath(path,env)).toBe(true);
 for(const path of ['/api/private/bna-inquiries','/en/app','/he/family','/api/identity/accounts/revoke','/api/payments','/fish','/api/individual-trips-other'])expect(individualTripReleasePath(path,env)).toBe(false);
 for(const override of [{LS_INDIVIDUAL_TRIPS_ENABLED:'false'},{LS_INDIVIDUAL_TRIPS_WORKSPACE_ID:randomUUID()},{LS_INDIVIDUAL_TRIPS_OWNER_ACCOUNT_ID:''},{LS_IDENTITY_ENABLED:'false'}])expect(individualTripReleasePath('/en/trips',{...env,...override})).toBe(false);
 expect(()=>tripRuntimeConfig({...env,LS_INDIVIDUAL_TRIPS_WORKSPACE_ID:randomUUID()},parseIdentityConfig(env))).toThrow();
});
it('admits only the exact hash-bound publication export with public and runtime gates open',()=>{
 const publicEnv={...env,LS_INDIVIDUAL_TRIPS_PUBLIC_ENABLED:'true'};
 for(const locale of ['en','he'] as const){
  expect(currentTripPublicConfig(locale,env)).toBeNull();
  expect(currentTripPublicConfig(locale,publicEnv)).toMatchObject({publicUrl:`${env.LS_APP_ORIGIN}/${locale}/florida/trips`,photo:{src:env.LS_APP_ORIGIN+TRIP_PUBLIC_PHOTO.src,width:1600,height:1200}});
  expect(individualTripReleasePath(`/${locale}/florida/trips`,publicEnv)).toBe(true);
  expect(individualTripReleasePath(`/${locale}/florida/trips/`,publicEnv)).toBe(true);
 }
 for(const method of ['GET','HEAD'])expect(individualTripPublicAsset(TRIP_PUBLIC_PHOTO.src,method,publicEnv)).toBe(true);
 for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS','get'])expect(individualTripPublicAsset(TRIP_PUBLIC_PHOTO.src,method,publicEnv)).toBe(false);
 for(const path of ['/trips/other.jpg',TRIP_PUBLIC_PHOTO.src+'?download=1',TRIP_PUBLIC_PHOTO.src+'/','/trips/private.jpg','/trips/%2e%2e/private.jpg'])expect(individualTripPublicAsset(path,'GET',publicEnv)).toBe(false);
 expect(individualTripPublicAsset(TRIP_PUBLIC_PHOTO.src,'GET',{...publicEnv,LS_INDIVIDUAL_TRIPS_PUBLIC_ENABLED:'false'})).toBe(false);
 for(const override of [{LS_INDIVIDUAL_TRIPS_ENABLED:'false'},{LS_IDENTITY_ENABLED:'false'},{LS_INDIVIDUAL_TRIPS_WORKSPACE_ID:randomUUID()}]){
  const held={...publicEnv,...override};
  expect(individualTripPublicAsset(TRIP_PUBLIC_PHOTO.src,'GET',held)).toBe(true);
  expect(individualTripReleasePath('/en/florida/trips',held)).toBe(true);
  expect(individualTripReleasePath('/en/trips/owner',held)).toBe(false);
  expect(individualTripReleasePath('/api/individual-trips/register',held)).toBe(false);
 }
});
