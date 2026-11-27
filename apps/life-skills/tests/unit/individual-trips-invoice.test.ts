import { randomUUID } from 'node:crypto';
import { afterAll,beforeAll,expect,it,vi } from 'vitest';
vi.mock('server-only',()=>({}));
import { tripDatabase } from '../fixtures/individual-trips-database.ts';
import { StripeTripInvoiceLookup,type VerifiedTripInvoice } from '../../src/features/individual-trips/invoice-provider.ts';
import { IndividualTripOwnerActions } from '../../src/features/individual-trips/owner-actions.ts';
import { householdCreditMinor } from '../../src/features/individual-trips/engine.ts';
import { blindEmail,seal } from '../../src/features/identity/crypto.ts';
let f:Awaited<ReturnType<typeof tripDatabase>>;
beforeAll(async()=>{f=await tripDatabase();},25000);afterAll(async()=>{await f?.db.close();});
const request=vi.fn();
const invoice=(overrides:Partial<VerifiedTripInvoice>={}):VerifiedTripInvoice=>({id:'in_synthetic',object:'invoice',livemode:false,currency:'usd',customer:'cus_synthetic',customer_email:'synthetic@example.invalid',status:'open',collection_method:'send_invoice',amount_due:15000,amount_paid:0,amount_remaining:15000,amount_paid_off_stripe:0,total:15000,starting_balance:0,hosted_invoice_url:'https://invoice.stripe.com/i/synthetic',metadata:{},payments:[],...overrides});
it('uses only fixed Stripe GET endpoints with account/mode pins and a complete, stable payment listing',async()=>{
 const snapshot=invoice(),payment={id:'inpay_fixture',object:'invoice_payment',invoice:'in_synthetic',amount_paid:1000,currency:'usd',livemode:false,status:'paid',payment:{type:'payment_intent',payment_intent:'pi_fixture'},status_transitions:{paid_at:1}};
 const replies=[{id:'acct_fixture',object:'account'},snapshot,{object:'list',has_more:false,data:[payment]},snapshot];
 request.mockImplementation(async()=>Response.json(replies.shift()));
 const lookup=new StripeTripInvoiceLookup({accountId:'acct_fixture',livemode:false,restrictedKey:'rk_test_SYNTHETIC'},request);
 expect((await lookup.lookup('in_synthetic')).payments).toHaveLength(1);
 for(const [url,options] of request.mock.calls){expect(url).toMatch(/^https:\/\/api\.stripe\.com\/v1\/(account|invoices\/in_synthetic\?|invoice_payments\?)/);expect(options.method).toBe('GET');expect(options.headers['Stripe-Version']).toBe('2026-11-18.endive');}
 request.mockReset();request.mockResolvedValue(Response.json({id:'acct_wrong',object:'account'}));
 await expect(lookup.lookup('in_synthetic')).rejects.toMatchObject({code:'UNAVAILABLE'});
 await expect(lookup.lookup('https://untrusted.invalid')).rejects.toMatchObject({code:'INVALID_REQUEST'});
});
it('attaches verified hosted invoices, imports partial stable payment IDs once and links outside cash without double-counting',async()=>{
 const {trips,parent,owner}=f;
 async function parentCommand(command:Record<string,unknown>,enroll=false){let revision=0;if(!enroll)revision=(await trips.read(parent.actor)).revision;return trips.execute(parent.actor,{operationId:randomUUID(),expectedRevision:revision,...command},enroll);}
 async function ownerCommand(command:Record<string,unknown>){return trips.execute(owner.actor,{operationId:randomUUID(),expectedRevision:(await trips.read(owner.actor)).revision,...command});}
 const family=await parentCommand({type:'household.create',profile:{guardianName:'Synthetic Parent',phone:'',pickupAreas:['boca'],contactConsent:true,marketingConsent:false}},true);
 const child=await parentCommand({type:'child.save',child:{name:'Synthetic Boy',age:10,mediaUse:false,fishingExperience:'',ownsRod:false}});
 await parentCommand({type:'availability.save',childId:child.id,selection:'any',options:[{date:'2026-12-06',kind:'local',pickupAreas:['boca']}],note:''});
 const departure=await ownerCommand({type:'departure.save',departure:{kind:'local',title:'Synthetic outing',desiredChildLimit:10,activityChildLimit:10,sonAttending:true,otherNonpayingChildren:[],transport:{verified:true,totalSeats:15,driverAdults:1,otherAdults:0,vehicleId:'synthetic-vehicle'},ownerResourceId:'synthetic-owner',minimumPaid:1,operationalReady:true,pickupHub:{id:'boca',label:'Synthetic confirmed hub',permissionConfirmed:true},departureAt:'2026-12-06T15:00:00Z',returnAt:'2026-12-06T19:00:00Z',fishingStartAt:'2026-12-06T15:30:00Z',fishingEndAt:'2026-12-06T18:30:00Z',mediaGroup:'no',equipment:'Loaner rod, tackle and bait',water:'Water supplied'}});
 const prepared=await ownerCommand({type:'offer.prepare',departureId:departure.id,householdId:family.householdId,childIds:[child.id],ownerNote:''}),offerId=prepared.offerId!;
 await trips.recordManualDelivery(owner.actor,{type:'delivery.record_sent',operationId:randomUUID(),expectedRevision:(await trips.read(owner.actor)).revision,offerId,sentAt:f.clock.now().toISOString()},'Synthetic manual WhatsApp delivery receipt');
 let offer=(await trips.read(owner.actor)).offers[0]!;
 await parentCommand({type:'offer.accept',offerId,quoteId:offer.quoteId,acceptedDate:offer.snapshot.date,pickupHubId:offer.snapshot.pickupHubId});
 let snapshot=invoice({customer_email:parent.email,metadata:{fishing_workspace_id:f.workspace,fishing_household_id:offer.householdId,fishing_offer_id:offer.id,fishing_quote_id:offer.quoteId}});
 const provider={lookup:vi.fn(async()=>structuredClone(snapshot))},actions=new IndividualTripOwnerActions(trips,provider);
 const action=async(action:'attach_invoice'|'reconcile_invoice',extra:Record<string,unknown>={})=>actions.execute(owner.actor,{action,offerId,operationId:randomUUID(),expectedRevision:(await trips.read(owner.actor)).revision,...(action==='attach_invoice'?{invoiceId:snapshot.id}:{}),...extra} as Parameters<typeof actions.execute>[1]);
 snapshot.customer_email='wrong-household@example.invalid';await expect(action('attach_invoice')).rejects.toMatchObject({code:'FORBIDDEN'});snapshot.customer_email=parent.email;
 await action('attach_invoice');
 const changedEmail='legitimate-new-parent@example.invalid';await f.db.query('UPDATE ls_identity.accounts SET email_blind=$2,email_ciphertext=$3 WHERE id=$1',[parent.actor.id,blindEmail(changedEmail,f.config.lookupKey),seal(changedEmail,`email:${f.workspace}:${parent.actor.id}`,f.config.keyring)]);
 snapshot={...snapshot,amount_paid:10000,amount_remaining:5000,payments:[{id:'inpay_partial',object:'invoice_payment',invoice:snapshot.id,status:'paid',amount_paid:10000,currency:'usd',livemode:false,payment:{type:'payment_intent',payment_intent:'pi_partial'},status_transitions:{paid_at:Math.floor(f.clock.now().getTime()/1000)}}]};
 // Provider seconds must work against a real nonzero-ms delivery instant.
 await action('reconcile_invoice');await action('reconcile_invoice');
 let state=await trips.read(owner.actor);expect(state.receipts).toHaveLength(1);expect(state.receipts[0]!.amountMinor).toBe(10000);expect(state.offers[0]!.status).toBe('partially_paid');
 const cash=await ownerCommand({type:'cash.record_received',offerId,receiptReference:'synthetic-cash-2000',amountMinor:2000});
 const cash2=await ownerCommand({type:'cash.record_received',offerId,receiptReference:'synthetic-cash-3000',amountMinor:3000});
 snapshot={...snapshot,status:'paid',amount_paid:15000,amount_remaining:0,amount_paid_off_stripe:5000};
 await expect(action('reconcile_invoice')).rejects.toMatchObject({code:'CONFLICT'});
 await expect(action('reconcile_invoice',{cashReceiptId:cash.receiptId})).rejects.toMatchObject({code:'CONFLICT'});
 const cashReceiptIds=[cash.receiptId,cash2.receiptId];
 await action('reconcile_invoice',{cashReceiptIds});await action('reconcile_invoice',{cashReceiptIds});
 state=await trips.read(owner.actor);expect(state.receipts).toHaveLength(3);expect(state.receipts.reduce((s,r)=>s+r.amountMinor,0)).toBe(15000);expect(state.offers[0]!.invoice?.status).toBe('paid');
 await parentCommand({type:'booking.cancel',offerId,childIds:[child.id],reason:'parent'});
 expect(householdCreditMinor(await trips.read(owner.actor),offer.householdId)).toBe(15000);
 snapshot={...snapshot,metadata:{...snapshot.metadata,fishing_household_id:randomUUID()}};await expect(action('reconcile_invoice',{cashReceiptId:cash.receiptId})).rejects.toMatchObject({code:'FORBIDDEN'});
 expect(provider.lookup).toHaveBeenCalled();offer=(await trips.read(owner.actor)).offers[0]!;expect(offer.children[0]!.creditRestoredMinor).toBe(15000);
});
