import {z} from 'zod';
import {AppError} from './errors.ts';
export type FishingOwnerEnvironment=Readonly<Record<string,string|undefined>>;
const id=z.uuid().refine(value=>value===value.toLowerCase());
/** Pure server-configuration validation only. It never grants an actor role
 * or replaces native session/workspace/current-owner authorization. */
export function configuredFishingOwnerBinding(workspaceId:string,env:FishingOwnerEnvironment){
 const workspace=id.safeParse(workspaceId),account=id.safeParse(env.LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID);
 if(!workspace.success||!account.success)throw new AppError('UNAVAILABLE');
 return Object.freeze({workspaceId:workspace.data,accountId:account.data});
}
export type FishingOwnerBinding=ReturnType<typeof configuredFishingOwnerBinding>;
