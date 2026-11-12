import 'server-only';
import {AppError} from './errors.ts';
import {assertCurrentFishingOwner} from './fishing-owner-boundary.ts';
import {readCutoverState} from '../features/contact-ops/server/cutover-state.ts';
import type {requireFishingOwnerPage} from '../features/integration/page-session.ts';
import type {FishingOwnerAvailability} from '../features/fishing-owner/fishing-owner-navigation-model.ts';

/** Actual server scope/native schema availability, not a menu-based grant.
 * Missing schema is unavailable; driver/auth failure remains a failure.
 * No initialization, legacy source read or provider probe occurs. */
export async function fishingOwnerSurfaceAvailability(context:Awaited<ReturnType<typeof requireFishingOwnerPage>>):Promise<FishingOwnerAvailability>{
 const {identity:r,scope,actor}=context;
 return r.store.transaction(async tx=>{
  await assertCurrentFishingOwner(tx,scope.binding,actor,'read',r.clock);
  if((await readCutoverState(tx,scope.binding.workspaceId,r.config.keyring,false)).phase!=='academy_native')throw new AppError('UNAVAILABLE');
  const rows=await tx.query<{inquiries:boolean;contacts:boolean;groups:boolean;marketing:boolean}>(`SELECT
   to_regclass('ls_service_interest.public_applications') IS NOT NULL AS inquiries,
   to_regclass('ls_contact_ops.academy_crm_contacts') IS NOT NULL AS contacts,
   to_regclass('ls_fishing_billing.group_preparation_heads') IS NOT NULL AS groups,
   to_regclass('ls_service_interest.fishing_marketing_snapshot') IS NOT NULL AS marketing`);
  if(rows.length!==1)throw new AppError('UNAVAILABLE');
  await assertCurrentFishingOwner(tx,scope.binding,actor,'read',r.clock);
  const available=(value:boolean)=>value?{state:'available' as const}:{state:'unavailable' as const,reason:'setup_required' as const};
  return Object.freeze({inquiries:available(rows[0]!.inquiries),family_contacts:available(rows[0]!.contacts),groups_calendar:available(rows[0]!.groups),
   marketing:available(rows[0]!.marketing),settings:{state:'available'}});
 });
}
