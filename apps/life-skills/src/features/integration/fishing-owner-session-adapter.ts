import 'server-only';
import {AppError} from '../../lib/errors.ts';
import {IdentitySessions} from '../identity/session-adapter.ts';
import type {IdentityStore} from '../identity/store.ts';
import type {IdentityConfig} from '../identity/config.ts';
import type {IdentityClock,Actor} from '../identity/types.ts';
import {assertCurrentFishingOwner,boundFishingOwner,configuredFishingOwnerBinding,type FishingOwnerBinding} from '../../lib/fishing-owner-boundary.ts';
import {FISHING_OWNER_APP_SCOPE_V1,type FishingOwnerAppScope} from '../../lib/fishing-owner-app-scope.ts';

/** Existing real session verification followed by the configured native owner
 * restriction. No parent/child account creation, first-practitioner fallback,
 * synthetic source selection or browser-provided scope. This class is NOT yet
 * selected by identityRuntime; route/UI/auth-mail cutover remains separate. */
export class FishingOwnerSessionAdapter extends IdentitySessions{
 private readonly ownerBinding:FishingOwnerBinding;
 constructor(private readonly ownerStore:IdentityStore,config:IdentityConfig,private readonly ownerClock:IdentityClock,
  scope:FishingOwnerAppScope){
  super(ownerStore,config,ownerClock);
  if(scope.version!==FISHING_OWNER_APP_SCOPE_V1||scope.kind!=='fishing_owner'||scope.binding.workspaceId!==config.workspaceId)throw new AppError('UNAVAILABLE');
  this.ownerBinding=configuredFishingOwnerBinding(config.workspaceId,{LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID:scope.binding.accountId});
 }
 override async actor(token:string):Promise<Actor>{
  const actor=await super.actor(token),owner=boundFishingOwner(this.ownerBinding,actor);
  return this.ownerStore.transaction(async tx=>{await assertCurrentFishingOwner(tx,this.ownerBinding,owner,'read',this.ownerClock);return owner;});
 }
 override async resolve(token:string){
  try{const owner=await this.actor(token);return {accountId:owner.id,workspaceId:owner.workspaceId,expiresAt:owner.expiresAt,revoked:false};}
  catch(error){
   if(error instanceof AppError&&error.code==='UNAUTHENTICATED')return null;
   if(error instanceof AppError&&error.code==='FORBIDDEN')throw error;
   throw new AppError('UNAVAILABLE');
  }
 }
}
