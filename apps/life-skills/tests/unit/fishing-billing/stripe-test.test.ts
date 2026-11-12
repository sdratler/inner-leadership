import {createHash} from 'node:crypto';
import {it,expect,vi} from 'vitest';
import {verifyBillingStripeTestEvent,prepareBillingTestCheckout,type BillingStripeSdkVerifier} from '../../../src/features/fishing-billing/stripe-test.ts';
import {syntheticAccepted,syntheticId,syntheticBillingFixtures,syntheticNow} from '../../../src/features/fishing-billing/fixtures.ts';
import {projectBalance} from '../../../src/features/fishing-billing/domain.ts';
vi.mock('server-only',()=>({}));
const binding={accountId:'acct_SYNTHETIC',livemode:false as const,apiVersion:'2026-09-30.endive' as const,verifiedBindingId:'SYNTHETIC-NOT-PROVIDER-VERIFIED'};
const raw=Buffer.from('synthetic raw bytes');
const receipt={eventId:'evt_SYNTHETIC',eventType:'checkout.session.completed' as const,objectId:'cs_SYNTHETIC',providerAccountId:binding.accountId,livemode:false as const,apiVersion:binding.apiVersion,digest:createHash('sha256').update(raw).digest('hex'),createdAt:syntheticNow};
const sdk:BillingStripeSdkVerifier={verify:()=>({kind:'stripe_test_signature_only',receipt})};
it('delegates exact raw bytes to mandatory reviewed SDK verifier without claiming settlement',()=>{
 const verify=vi.fn(sdk.verify),cap=verifyBillingStripeTestEvent({rawBody:raw,signatureHeader:'SYNTHETIC',binding,sdk:{verify},now:new Date(syntheticNow)});
 expect(verify.mock.calls[0]![0]).toEqual(Uint8Array.from(raw));expect(cap).toEqual({});
});
it.each(['wrong_account','live','version','digest','clock','sdk_reject'] as const)('fails closed on %s at the test ingress adapter',bad=>{
 const changed={...receipt};let now=new Date(syntheticNow);
 if(bad==='wrong_account')changed.providerAccountId='acct_OTHER';
 if(bad==='live')Object.assign(changed,{livemode:true});
 if(bad==='version')Object.assign(changed,{apiVersion:'unreviewed'});
 if(bad==='digest')changed.digest='a'.repeat(64);
 if(bad==='clock')now=new Date(NaN);
 const verifier:BillingStripeSdkVerifier={verify:()=>{if(bad==='sdk_reject')throw new Error('SYNTHETIC_BAD_SIGNATURE');return {kind:'stripe_test_signature_only',receipt:changed};}};
 expect(()=>verifyBillingStripeTestEvent({rawBody:raw,signatureHeader:'SYNTHETIC',binding,sdk:verifier,now})).toThrow();
});
it('prepares one-time partial card amount from accepted current line balances and opaque metadata',()=>{
 const q=syntheticAccepted(),b=syntheticBillingFixtures().twoChildPartial.balance;
 const request=prepareBillingTestCheckout({quote:q,balance:b,operationId:syntheticId(400),selection:[{lineId:q.lines[1]!.id,amountMinor:10000}],binding,cardOnlyConfigurationId:'pmc_SYNTHETIC',approvedProductLabel:'SYNTHETIC TEST ONLY'});
 expect(request).toMatchObject({amountMinor:10000,idempotencyKey:syntheticId(400),params:{mode:'payment',line_items:[{price_data:{unit_amount:10000,currency:'usd'}}]}});
 expect(Object.keys(request.params.metadata)).toEqual(['billing_quote_id','billing_attempt_id']);
 expect(request.params).not.toHaveProperty('payment_method_types');expect(request.params).not.toHaveProperty('subscription_data');
});
it('does not prepare stale, cross-family, excessive, unaccepted or unconfigured Checkout',()=>{
 const q=syntheticAccepted(),b=projectBalance(q,[]);
 const input={quote:q,balance:b,operationId:syntheticId(401),selection:[{lineId:q.lines[0]!.id,amountMinor:65000}],binding,cardOnlyConfigurationId:'pmc_SYNTHETIC',approvedProductLabel:'SYNTHETIC'};
 for(const invalid of [
  {...input,balance:{...b,revision:99}},
  {...input,balance:{...b,familyId:syntheticId(999)}},
  {...input,selection:[{lineId:q.lines[0]!.id,amountMinor:65001}]},
  {...input,quote:{...q,state:'issued' as const}},
  {...input,cardOnlyConfigurationId:''},
 ])expect(()=>prepareBillingTestCheckout(invalid)).toThrow();
});
