/** Synthetic native proof fixtures, not an alternate production authority port.
 * MAIN must migrate the exact fresh database first; this file never applies DDL.
 */
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import pg from 'pg';
import { poolStore } from '../calendar/fixture.ts';
import { asId } from '../../../src/lib/ids.ts';
import { seal } from '../../../src/features/identity/crypto.ts';
import type { Actor,AccountRole } from '../../../src/features/identity/types.ts';
import type { ApprovedOffer } from '../../../src/features/fishing/contract.ts';
import type { FishingAuthority,HostedResult,ProviderOperation,ReceiptReadback,RefundResult,SyntheticHostedProvider } from '../../../src/features/fishing-payments/ports.ts';
import { approvedOffer } from '../../../src/features/fishing-payments/domain.ts';
import { FishingPaymentStore } from '../../../src/features/fishing-payments/store.ts';
import { FishingPaymentService } from '../../../src/features/fishing-payments/service.ts';
import { FishingReceiptInbox } from '../../../src/features/fishing-payments/receipts.ts';
import { offerFixture,merchant } from '../../unit/fishing-payments/fixture.ts';
export function nativeUrl(){const raw=process.env.TEST_DATABASE_URL;if(!raw)throw Error('MAIN_MUST_PROVIDE_DISPOSABLE_DATABASE');const u=new URL(raw);if(u.hostname!=='127.0.0.1'||!/^\/ls_calendar_test_rm_pay_[a-f0-9]{32}_test$/.test(u.pathname))throw Error('WRONG_PAYMENT_TEST_TARGET');return raw;}
export class FakeMerchant implements SyntheticHostedProvider {
 readonly execution='synthetic' as const;readonly binding=merchant;
 readonly results=new Map<string,HostedResult|RefundResult>();calls=0;loseResponse=false;
 readback:ReceiptReadback|null=null;
 async create(op:ProviderOperation){this.calls++;let r=this.results.get(op.idempotencyKey);if(!r){r=op.kind==='hosted_invoice'?{kind:'hosted_invoice',providerObjectId:`in_${op.id}`,url:`https://invoice.stripe.com/i/${op.id}`,providerAccountId:op.providerAccountId,livemode:false,currency:'USD',amountCents:op.amountCents,purchaseId:op.purchaseId,dueId:op.dueId!,idempotencyKey:op.idempotencyKey}:{kind:'refund',providerObjectId:`re_${op.id}`,providerAccountId:op.providerAccountId,livemode:false,currency:'USD',amountCents:op.amountCents,purchaseId:op.purchaseId,idempotencyKey:op.idempotencyKey,status:'succeeded'};this.results.set(op.idempotencyKey,r);}if(this.loseResponse)throw Error('synthetic-lost-response');return r;}
 async readOperation(op:ProviderOperation){return this.results.get(op.idempotencyKey)??null;}
 async reconcileReceipt(){if(!this.readback)throw Error('NO_SYNTHETIC_READBACK');return this.readback;}
}
export async function setup(){
 const pool=new pg.Pool({connectionString:nativeUrl(),max:8});
 if(!(await pool.query("SELECT to_regclass('ls_fishing_payments.operations') AS ready")).rows[0]?.ready){await pool.end();throw Error('MAIN_MUST_APPLY_PINNED_CANDIDATE_FIRST');}
 const workspaceId=asId(randomUUID(),'workspace'),now=new Date(),ago=new Date(now.getTime()-3600000),ring={activeKeyId:'synthetic',keys:{synthetic:randomBytes(32)}};
 await pool.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[workspaceId,ago]);
 async function actor(role:AccountRole):Promise<Actor>{const accountId=asId(randomUUID(),'account'),personId=asId(randomUUID(),'person'),sessionDigest=createHash('sha256').update(randomBytes(32)).digest('hex'),expiresAt=Date.now()+3600000;
  await pool.query('INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,$3,$4,$5)',[personId,workspaceId,role==='child'?'minor':'adult',seal('{"displayName":"Synthetic person"}',`person:${workspaceId}:${personId}`,ring),ago]);
  await pool.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,$5,$6,'synthetic-non-login-hash',$6,$6)",[accountId,workspaceId,role,createHash('sha256').update(accountId).digest('hex'),seal(`${accountId}@example.invalid`,`email:${workspaceId}:${accountId}`,ring),ago]);
  await pool.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$3)',[workspaceId,accountId,personId]);await pool.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[sessionDigest,workspaceId,accountId,ago,new Date(expiresAt)]);
  return {id:accountId,workspaceId,personId,role,state:'active',locale:'en',sessionDigest,expiresAt};
 }
 const owner=await actor('practitioner'),parent=await actor('parent'),outsider=await actor('parent'),child=await actor('child');
 const offers=new Map<string,ApprovedOffer>(),proof={allowed:true,attended:2,reviewed:true,reminderConsent:true,quiet:false,stripeNotice:false};
 const authority:FishingAuthority={async loadApprovedOffer(_tx,_actor,id){return offers.get(id)??null;},async authorize(){return proof.allowed;},async withdrawalFacts(){return {attended:proof.attended,revision:`synthetic-attendance-${proof.attended}`,reason:'voluntary',multiChildPrestart:false,reviewedTermsId:proof.reviewed?'synthetic-reviewed-terms':null};},async reminderPolicy(){return {approvedPolicyId:'synthetic-reminder-policy',parentAccountId:parent.id,consented:proof.reminderConsent,channel:'in_app',quietNow:proof.quiet,eligibleNow:true,stripeAlreadyNotifies:proof.stripeNotice,copyVersion:'synthetic-copy-v1'};}};
 const database=poolStore(pool),provider=new FakeMerchant(),deps={database,authority,provider,merchant,clock:{now:()=>new Date()}},store=new FishingPaymentStore(deps),service=new FishingPaymentService(store),inbox=new FishingReceiptInbox(store);
 function offer(mode:'prepay'|'installments'='prepay',transform:(o:ApprovedOffer)=>ApprovedOffer=x=>x){const base=offerFixture(mode);const o=approvedOffer(transform({...base,workspaceId,operatorAccountId:owner.id,payerAccountId:parent.id,terms:{...base.terms,acceptedBy:parent.id}}));offers.set(o.id,o);return o;}
 async function issue(o=offer(),campaignId:string|null=null){const result=await store.registerApprovedOffer(owner,randomUUID(),o.id,o.revision,campaignId);return {offer:o,purchaseId:result.purchaseIds[0]!};}
 async function count(table:'offers'|'purchases'|'operations'|'inbox'|'settlements'|'founder_households'){const sql={offers:'SELECT count(*)::int AS n FROM ls_fishing_payments.offers WHERE workspace_id=$1',purchases:'SELECT count(*)::int AS n FROM ls_fishing_payments.purchases WHERE workspace_id=$1',operations:'SELECT count(*)::int AS n FROM ls_fishing_payments.operations WHERE workspace_id=$1',inbox:'SELECT count(*)::int AS n FROM ls_fishing_payments.inbox WHERE provider_account_id=$1',settlements:'SELECT count(*)::int AS n FROM ls_fishing_payments.settlements WHERE workspace_id=$1',founder_households:'SELECT count(*)::int AS n FROM ls_fishing_payments.founder_households WHERE workspace_id=$1'};return (await pool.query(sql[table],[table==='inbox'?merchant.accountId:workspaceId])).rows[0].n as number;}
 return {pool,database,owner,parent,outsider,child,offers,proof,authority,provider,deps,store,service,inbox,offer,issue,count,workspaceId};
}
export type NativeFixture=Awaited<ReturnType<typeof setup>>;
