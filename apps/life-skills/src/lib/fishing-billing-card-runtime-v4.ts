import 'server-only';
import {AppError} from './errors.ts';
import {createFishingBillingTestCheckout,validateFishingBillingTestCheckoutDependencies,type BillingCheckoutAdmission,type BillingCheckoutEffect,type BillingCheckoutDependencies} from './fishing-billing-stripe-checkout.ts';
import {createFishingBillingTestReadback,type BillingPaymentReadDependencies} from './fishing-billing-stripe-readback.ts';
import {FishingServiceBillingCardsV4} from '../features/fishing-billing/guest-service-cards-v4.ts';
import {billingStripeBindingSchema} from '../features/fishing-billing/card-binding.ts';
import type {BillingStripeTestProvider} from '../features/fishing-billing/cards.ts';

type NativeArguments=ConstructorParameters<typeof FishingServiceBillingCardsV4>;
export type FishingServiceTestCardsV4Dependencies={
 db:NativeArguments[0];workspaceId:NativeArguments[1];current:NativeArguments[2];owner:NativeArguments[3];
 ring:NativeArguments[4];digestKey:NativeArguments[5];configuration:NativeArguments[6];inbox:NativeArguments[7];
 refund:NativeArguments[9];reservation:NativeArguments[10];checkoutEffect:NativeArguments[11];
 checkout:Omit<BillingCheckoutDependencies,'binding'|'admission'>;
 readback:Omit<BillingPaymentReadDependencies,'binding'>;
};
/** Unmounted, explicit-dependency composition. It creates no provider request,
 * route, credentials, environment switch or authority. All independent native
 * permissions remain mandatory at their existing effect-specific boundaries.
 * The official TEST SDK always calls the admission belonging to the exact
 * cards instance whose original committed UNKNOWN is being dispatched. */
export function composeFishingServiceTestCardsV4(input:FishingServiceTestCardsV4Dependencies):FishingServiceBillingCardsV4{
 const binding=Object.freeze(billingStripeBindingSchema.parse(input.configuration.binding));
 const configuration=Object.freeze({...input.configuration,binding});
 // This closure is assigned once, after construction. It is not a permission
 // cache and cannot be supplied by a caller or swapped for a different cards
 // instance. Missing initialization denies before any SDK account lookup.
 const pairing:{admission?:Readonly<BillingCheckoutAdmission>}={};
 const pairedAdmission:BillingCheckoutAdmission=Object.freeze({
  authorize:(effect:BillingCheckoutEffect)=>{
   const admission=pairing.admission;
   if(!admission)throw new AppError('UNAVAILABLE');
   return admission.authorize(effect);
  },
 });
 const officialCheckout={...input.checkout,binding,admission:pairedAdmission};
 // Missing/invalid SDK configuration must fail before the native producer can
 // reserve UNKNOWN. This pure shared validator grants no service permission.
 validateFishingBillingTestCheckoutDependencies(officialCheckout);
 const checkout=createFishingBillingTestCheckout(officialCheckout);
 const readback=createFishingBillingTestReadback({...input.readback,binding});
 const provider:BillingStripeTestProvider=Object.freeze({
  createCheckout:checkout.createCheckout.bind(checkout),
  readPayment:readback.readPayment.bind(readback),
 });
 const cards=new FishingServiceBillingCardsV4(input.db,input.workspaceId,input.current,input.owner,input.ring,
  Buffer.from(input.digestKey),configuration,input.inbox,provider,input.refund,input.reservation,input.checkoutEffect);
 pairing.admission=cards.checkoutAdmission();
 Object.freeze(pairing);
 return cards;
}
