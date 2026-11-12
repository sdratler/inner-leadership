import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,beforeEach,it,expect,vi} from 'vitest';
import {asId} from '../../src/lib/ids.ts';
import {AppError} from '../../src/lib/errors.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {FishingBillingStore,type BillingAuthority,type BillingFinancialServiceAuthority} from '../../src/features/fishing-billing/native.ts';
import {FishingBillingCards,type BillingStripeTestProvider} from '../../src/features/fishing-billing/cards.ts';
import {FishingBillingStripeInbox,billingStripeSignedReceiptSchema,type BillingStripeInboxAuthority} from '../../src/features/fishing-billing/stripe-test.ts';
import {syntheticDefinition} from '../../src/features/fishing-billing/fixtures.ts';
import type {CreateFamilyOffer} from '../../src/features/fishing-billing/contracts.ts';
import {BILLING_DTO_V2} from '../../src/features/fishing-billing/contracts-v2.ts';
import {seal,unseal,tokenDigest} from '../../src/features/identity/crypto.ts';
import {FishingBillingGuestOwnerStore} from '../../src/lib/fishing-billing-guest-owner-store.ts';
import {OWNER_MONEY_V3} from '../../src/lib/fishing-billing-owner-contract-v3.ts';
import {BILLING_GUEST_V3} from '../../src/lib/fishing-billing-guest-contract-v3.ts';
import {bindGuestIssuedMaterial,bindGuestDisplayBundle,verifyGuestFamilyOffer} from '../../src/lib/fishing-billing-guest-material-v3.ts';
import {FishingBillingGuestGrantResolver,guestGrantLifecycleSchema,guestPresentationEvidenceSchema,type BillingGuestGrantAuthority} from '../../src/lib/fishing-billing-guest-grant-resolver.ts';
import {FishingBillingGuestNativeV3} from '../../src/features/fishing-billing/guest-native-v3.ts';
import Stripe from 'stripe';
import {createFishingBillingTestCheckout,type BillingCheckoutDependencies,type BillingCheckoutEffect} from '../../src/lib/fishing-billing-stripe-checkout.ts';
import {createFishingBillingTestReadback,type BillingPaymentReadDependencies,type BillingPaymentReadEffect} from '../../src/lib/fishing-billing-stripe-readback.ts';
import {fishingBillingTestWebhookHttp,FISHING_BILLING_TEST_WEBHOOK_PATH,type FishingBillingTestWebhookDeps} from '../../src/lib/fishing-billing-stripe-webhook-http.ts';
vi.mock('server-only',()=>({}));
// Memory-only actual Native + official SDK composition through injected HTTP.
// Only HTTP replies, native legal/source/admission inputs and clock are synthetic.
// PGlite queues transactions: real multi-connection contention remains separate.
const db=new PGlite(),workspace=asId(randomUUID(),'workspace'),otherWorkspace=asId(randomUUID(),'workspace');
const now=new Date('2035-01-06T15:00:00Z'),clock={now:()=>now};
let owner:Actor,parent:Actor,serviceRevoked=false;
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}},key=Buffer.alloc(32,9);
const binding={accountId:'acct_SYNTHETIC',livemode:false as const,apiVersion:'2026-09-30.endive' as const,verifiedBindingId:'SYNTHETIC-SERVICE'};
const config={binding,cardOnlyConfigurationId:'pmc_SYNTHETIC',approvedProductLabel:'SYNTHETIC ONLY'};
const binder:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=> (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
async function admitted(tx:SqlSession,familyId:string,childIds:string[]){
 const rows=await tx.query('SELECT family_id FROM synthetic_sdk.admission WHERE family_id=$1 AND revoked=false',[familyId]);if(rows.length!==1)throw new AppError('FORBIDDEN');
 const members=await tx.query<{id:string}>("SELECT person_id AS id FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND role='child'",[workspace,familyId]);
 if(!childIds.every(id=>members.some(m=>m.id===id)))throw new AppError('FORBIDDEN');
}
const authority:BillingAuthority={
 authorize:async(c,action,s)=>{
  if(s.familyId===null){if(c.actor.id!==owner.id||action!=='publish')throw new AppError('FORBIDDEN');return;}
  if(c.actor.id!==owner.id&&c.actor.id!==parent.id)throw new AppError('FORBIDDEN');
  if(s.programKey!=='fishing_monthly_club')throw new AppError('FORBIDDEN');await admitted(c.tx,s.familyId,s.childIds);
 },
 reminderPermission:async(_c,_q,p,guardianId,channel)=>({
  audience:{guardianId,channel,audience:'individual',locale:'en',verified:true,consented:true,active:true},
  sendWindowOpen:true,ownerEnabled:true,policyCurrent:p.id==='SYNTHETIC-FLOW-REMINDER'&&p.source.sha256==='a'.repeat(64),
 }),
};
const financial:BillingFinancialServiceAuthority={authorize:async(c,b,s)=>{
 if(serviceRevoked||b.accountId!==binding.accountId||b.verifiedBindingId!==binding.verifiedBindingId||b.livemode!==false||c.workspaceId!==workspace||!s.familyId)throw new AppError('FORBIDDEN');
 await admitted(c.tx,s.familyId,s.childIds);
}};
const inboxAuthority:BillingStripeInboxAuthority={authorize:async(_tx,w,b)=>{if(serviceRevoked||w!==workspace||b.accountId!==binding.accountId||b.verifiedBindingId!==binding.verifiedBindingId)throw new AppError('FORBIDDEN');}};
const native=(dbinder=binder,service:BillingFinancialServiceAuthority|null=financial)=>new FishingBillingStore(dbinder,workspace,ring,key,authority,clock,null,service);
async function actor(role:'practitioner'|'parent',ws=workspace){
 const id=randomUUID(),digest=id.replaceAll('-','').padEnd(64,'0');
 await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'adult','SYNTHETIC',$3)",[id,ws,now]);
 await db.query("INSERT INTO ls_identity.accounts(id,workspace_id,role,state,locale,email_blind,email_ciphertext,email_verified_at,password_hash,created_at,updated_at) VALUES($1,$2,$3,'active','en',$4,'SYNTHETIC',$5,'SYNTHETIC',$5,$5)",[id,ws,role,digest,now]);
 await db.query('INSERT INTO ls_identity.account_subjects(workspace_id,account_id,person_id) VALUES($1,$2,$2)',[ws,id]);
 await db.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[digest,ws,id,now,new Date('2036-01-01T00:00:00Z')]);
 return {id:asId(id,'account'),workspaceId:ws,personId:asId(id,'person'),role,state:'active',locale:'en',sessionDigest:digest,expiresAt:Date.parse('2036-01-01T00:00:00Z')} as Actor;
}
beforeAll(async()=>{
 await db.exec('CREATE SCHEMA ls_control');
 for(const file of ['0001_ls_foundation.sql','0010_ls_identity_cases_20260906.sql'])await db.exec(await readFile('migrations/'+file,'utf8'));
 await db.exec(await readFile('tests/fixtures/fishing-billing.sql','utf8'));
 await db.exec(await readFile('migrations/proposals/UNNUMBERED_ls_fishing_billing_guest_v3.sql','utf8'));
 await db.exec('CREATE SCHEMA synthetic_sdk;CREATE TABLE synthetic_sdk.admission(family_id uuid PRIMARY KEY,revoked boolean DEFAULT false,recipient_id uuid,assurance_id uuid);CREATE TABLE synthetic_sdk.guest_presentations(grant_id uuid PRIMARY KEY,body jsonb,challenge text);CREATE TABLE synthetic_sdk.rate_limits(key text PRIMARY KEY,count integer NOT NULL)');
 for(const w of [workspace,otherWorkspace])await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[w,now]);
 owner=await actor('practitioner');parent=await actor('parent');
},20000);
afterAll(async()=>{await db.close();});
async function familyInput(){
 const familyId=randomUUID(),children=[randomUUID(),randomUUID()],d=syntheticDefinition(),definitionId=randomUUID();
 await db.query('INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,$3,$4)',[familyId,workspace,'SYNTHETIC',now]);
 await db.query('INSERT INTO synthetic_sdk.admission(family_id) VALUES($1)',[familyId]);
 for(const child of children){
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'minor','SYNTHETIC',$3)",[child,workspace,now]);
  await db.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'child')",[workspace,familyId,child]);
 }
 await native().publishOffer(owner,{operationId:randomUUID(),offer:{version:d.version,id:definitionId,programKey:d.programKey,environment:d.environment,currency:d.currency,unitAmountMinor:d.unitAmountMinor,effectiveAt:d.effectiveAt,source:d.source,terms:d.terms,policies:d.policies}});
 const cmd:CreateFamilyOffer={operationId:randomUUID(),id:randomUUID(),familyId,definitionId,override:null,children:children.map(childId=>({lineId:randomUUID(),childId,groupId:null,period:{id:randomUUID(),startsAt:'2035-01-01T05:00:00Z',endsAt:'2035-02-01T05:00:00Z',timeZone:'America/New_York'},dueAt:'2035-01-05T22:00:00Z'}))};
 return cmd;
}
async function family(accept=true){
 const cmd=await familyInput();
 await native().createOffer(owner,cmd);const issued=await native().issueOffer(owner,{operationId:randomUUID(),expectedVersion:1,quoteId:cmd.id});
 const q=accept?(await native().acceptOffer(parent,{operationId:randomUUID(),expectedVersion:2,quoteId:cmd.id,terms:issued.result.quote.definition.terms,acknowledged:true})).result.quote:issued.result.quote;return q;
}
// Actual new guest owner/native acceptance and concrete card coordinator, with
// synthetic SQL admission/display records and the existing MOCK provider only.
const guestMoney=()=>new FishingBillingGuestOwnerStore(binder,workspace,ring,key,clock,authority);
const guestAuthority:BillingGuestGrantAuthority={
 target:async c=>{const rows=await c.tx.query('SELECT id FROM ls_identity.workspaces WHERE id=$1',[workspace]);if(c.workspaceId!==workspace||rows.length!==1)throw new AppError('UNAVAILABLE');},
 current:async(c,g,mode)=>{
  await admitted(c.tx,g.offer.material.familyId,g.offer.material.lines.map(l=>l.childId));
  const rows=await c.tx.query<{recipient:string;assurance:string}>('SELECT recipient_id AS recipient,assurance_id AS assurance FROM synthetic_sdk.admission WHERE family_id=$1 AND revoked=false',[g.offer.material.familyId]);
  const issuers=await c.tx.query("SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active'",[workspace,g.issuedByAccountId]);
  const quotes=await c.tx.query<{ciphertext:string}>('SELECT payload_ciphertext AS ciphertext FROM ls_fishing_billing.quotes WHERE workspace_id=$1 AND id=$2',[workspace,g.offer.material.quoteId]);
  if(rows.length!==1||!rows[0]!.recipient||!rows[0]!.assurance||issuers.length!==1||quotes.length!==1)throw new AppError('FORBIDDEN');
  const q=verifyGuestFamilyOffer(JSON.parse(unseal(quotes[0]!.ciphertext,'ls_fishing_billing/guest/v3/quote/'+workspace+'/'+g.offer.material.quoteId,ring)));
  if(mode==='fresh'?q.state!=='issued':q.acceptance?.grantId!==g.id)throw new AppError('FORBIDDEN');
  return {workspaceId:workspace,familyId:q.familyId,quoteId:q.id,grantId:g.id,recipientBindingEvidenceId:rows[0]!.recipient,assuranceEvidenceId:rows[0]!.assurance,admissionPolicy:q.definition.source};
 },
 display:async(c,g,challenge)=>{
  const rows=await c.tx.query<{body:unknown;challenge:string}>('SELECT body,challenge FROM synthetic_sdk.guest_presentations WHERE grant_id=$1',[g.id]);
  if(rows.length!==1||challenge!==rows[0]!.challenge)throw new AppError('FORBIDDEN');return guestPresentationEvidenceSchema.parse(rows[0]!.body);
 },
};
async function guestFamily(){
 const cmd=await familyInput();await guestMoney().createOffer(owner,cmd);
 const q=(await guestMoney().issueOffer(owner,{operationId:randomUUID(),quoteId:cmd.id,expectedVersion:1})).quote;
 const offer=bindGuestIssuedMaterial({workspaceId:workspace,familyId:q.familyId,quoteId:q.id,issuedRevision:q.revision,definition:q.definition,lines:q.lines,createdAt:q.createdAt,issuedAt:q.issuedAt,override:q.override});
 const display=bindGuestDisplayBundle({id:randomUUID(),version:'SYNTHETIC FINANCIAL TERMS',locale:'en',offerSnapshotSha256:offer.sha256,documents:[{purpose:'financial_terms',source:q.definition.terms,displayedTextSha256:'b'.repeat(64),releaseEvidenceId:randomUUID()}]});
 const token=randomBytes(32).toString('base64url'),challenge='z'.repeat(43),recipient=randomUUID(),assurance=randomUUID();
 const lifecycle=guestGrantLifecycleSchema.parse({version:BILLING_GUEST_V3,state:'active',revokedAt:null,use:null,grant:{version:BILLING_GUEST_V3,id:randomUUID(),action:'accept_financial_offer',offer,displayBundle:display,recipientBindingEvidenceId:recipient,admissionPolicy:q.definition.source,tokenDigest:tokenDigest(token),issuedAt:now.toISOString(),expiresAt:new Date(now.valueOf()+86400000).toISOString(),issuedByAccountId:owner.id}}),g=lifecycle.grant;
 await db.query('UPDATE synthetic_sdk.admission SET recipient_id=$2,assurance_id=$3 WHERE family_id=$1',[q.familyId,recipient,assurance]);
 await db.query('INSERT INTO ls_fishing_billing.guest_grants VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[workspace,g.id,q.id,g.action,g.tokenDigest,'active',g.issuedAt,g.expiresAt,seal(JSON.stringify(lifecycle),'ls_fishing_billing/guest_grant/v3/'+workspace+'/'+g.id,ring)]);
 const presentation={action:'accept_financial_offer',grantId:g.id,displayBundleId:display.id,displayBundleSha256:display.sha256,locale:display.locale,evidenceId:randomUUID(),affirmation:{version:'SYNTHETIC STATEMENT',guardianAuthorityText:'SYNTHETIC GUARDIAN TEXT',financialTermsText:'SYNTHETIC FINANCIAL TEXT'}};
 await db.query('INSERT INTO synthetic_sdk.guest_presentations VALUES($1,$2::jsonb,$3)',[g.id,JSON.stringify(presentation),challenge]);
 const resolver=new FishingBillingGuestGrantResolver(workspace,ring,key,clock,guestAuthority),acceptance=new FishingBillingGuestNativeV3(binder,workspace,ring,clock,resolver);
 await acceptance.acceptFinancialOffer(token,{operationId:randomUUID(),expectedVersion:2,displayBundleId:display.id,displayBundleSha256:display.sha256,displayChallenge:challenge,parent:{submittedName:'SYNTHETIC GUEST ONLY',guardianAuthorityAttested:true,financialTermsAffirmed:true}});
 return guestMoney().readQuote(owner,q.id);
}

const origin='https://fishing-sdk.invalid',secret='whsec_SYNTHETIC_ONLY_0000000000000000',sdkKey='rk_test_'+'SYNTHETIC_ONLY'.repeat(3);
const defaultNetwork=vi.fn<typeof fetch>(async()=>{throw new Error('SYNTHETIC_DEFAULT_NETWORK_FORBIDDEN');});
beforeAll(()=>{vi.stubGlobal('fetch',defaultNetwork);});
afterAll(()=>{expect(defaultNetwork).not.toHaveBeenCalled();vi.unstubAllGlobals();});
beforeEach(async()=>{serviceRevoked=false;await db.exec('UPDATE synthetic_sdk.admission SET revoked=false');});
const json=(body:unknown)=>new Response(JSON.stringify(body),{headers:{'content-type':'application/json'}});
type Source='historical_account'|'guest_successor';
type CreateMode='normal'|'missing_admission'|'missing_transport'|'revoked_before_first'|'revoked_before_post'|'lost_reply';
type ReadMode='normal'|'missing_admission'|'missing_transport'|'revoked_before_next_get';
async function pipeline(kind:Source,createMode:CreateMode='normal',readMode:ReadMode='normal'){
 const quote=kind==='historical_account'?await family():await guestFamily(),operationId=randomUUID(),amountMinor=65000;
 const command={operationId,quoteId:quote.id,expectedVersion:quote.revision,selection:[{lineId:quote.lines[0]!.id,amountMinor}]};
 const sessionId='cs_test_'+operationId.replaceAll('-',''),paymentIntentId='pi_'+operationId.replaceAll('-',''),chargeId='ch_'+operationId.replaceAll('-','');
 const metadata={billing_quote_id:quote.id,billing_attempt_id:operationId};
 const created:{path:string;method:string;operationKey:string|null;body:string}[]=[],reads:{path:string;query:URLSearchParams}[]=[],admissions:{stage:'create'|'read';source:Source;state:string}[]=[];
 let providerCreated=false;
 const current=async()=>{
  const frame=await native().withCurrentCardServiceV3(binding,quote.id,async l=>l.frame),attempt=await coordinator.readAttempt(owner,quote.id,operationId);
  expect(frame.source.kind).toBe(kind);expect(frame.source.quote.id).toBe(quote.id);expect(frame.source.quote.familyId).toBe(quote.familyId);
  expect(frame.payableBasis).not.toBeNull();expect(attempt).toMatchObject({workspaceId:workspace,quoteId:quote.id,familyId:quote.familyId,actorId:owner.id,command:{operationId},binding});expect(attempt.dispatchId).not.toBeNull();
  return {frame,attempt};
 };
 const createAdmission={authorize:async(effect:BillingCheckoutEffect)=>{
  const {frame,attempt}=await current();admissions.push({stage:'create',source:frame.source.kind,state:attempt.state});
  expect(effect).toMatchObject({effect:'create_checkout',binding,operationId,quoteId:quote.id,amountMinor,configurationId:config.cardOnlyConfigurationId});
  expect(attempt.state).toBe('unknown');expect(frame.source.quote.revision).toBe(attempt.balanceVersion);expect(frame.balance.remainingMinor).toBeGreaterThanOrEqual(amountMinor);
  expect(attempt.preparation.result).toMatchObject({amountMinor,allocations:command.selection});if(createMode==='revoked_before_first')throw new AppError('UNAVAILABLE');
 }};
 const createTransport:typeof fetch=async(input,init)=>{
  const url=new URL(String(input)),method=init?.method??'GET',headers=new Headers(init?.headers);expect(url.origin).toBe('https://api.stripe.com');
  created.push({path:url.pathname,method,operationKey:headers.get('idempotency-key'),body:String(init?.body??'')});
  if(url.pathname==='/v1/account')return json({object:'account',id:binding.accountId});
  if(url.pathname==='/v1/balance'){
   if(createMode==='revoked_before_post')await db.query('UPDATE synthetic_sdk.admission SET revoked=true WHERE family_id=$1',[quote.familyId]);
   return json({object:'balance',livemode:false,available:[],pending:[]});
  }
  expect(url.pathname).toBe('/v1/checkout/sessions');expect(method.toUpperCase()).toBe('POST');const params=new URLSearchParams(String(init?.body));
  expect(headers.get('idempotency-key')).toBe(operationId);expect(params.get('metadata[billing_quote_id]')).toBe(quote.id);expect(params.get('metadata[billing_attempt_id]')).toBe(operationId);expect(params.get('line_items[0][price_data][unit_amount]')).toBe(String(amountMinor));
  providerCreated=true;if(createMode==='lost_reply')throw new Error('SYNTHETIC_CREATE_COMMITTED_REPLY_LOST');
  return json({object:'checkout.session',id:sessionId,livemode:false,mode:'payment',amount_total:amountMinor,currency:'usd',client_reference_id:quote.id,integration_identifier:params.get('integration_identifier'),metadata,payment_method_configuration_details:{id:config.cardOnlyConfigurationId},url:'https://checkout.stripe.com/c/pay/'+sessionId,payment_status:'unpaid'});
 };
 const readAdmission={authorize:async(effect:BillingPaymentReadEffect)=>{
  const {frame,attempt}=await current();admissions.push({stage:'read',source:frame.source.kind,state:attempt.state});expect(providerCreated).toBe(true);
  expect(effect.binding).toEqual(binding);expect(effect.objectId).toBe(sessionId);expect(['open','unknown','paid']).toContain(attempt.state);expect(attempt.sessionId===null||attempt.sessionId===sessionId).toBe(true);
  const row=(await db.query<{workspace_id:string;body_digest:string;receipt_ciphertext:string}>('SELECT workspace_id,body_digest,receipt_ciphertext FROM ls_fishing_billing.stripe_events WHERE account_id=$1 AND livemode=false AND event_id=$2',[binding.accountId,effect.eventId])).rows[0];expect(row?.workspace_id).toBe(workspace);
  const receipt=billingStripeSignedReceiptSchema.parse(JSON.parse(unseal(row!.receipt_ciphertext,'ls_fishing_billing/stripe_event/v1/'+workspace+'/'+binding.accountId+'/'+effect.eventId,ring)));
  expect(receipt).toMatchObject({eventId:effect.eventId,eventType:effect.eventType,objectId:effect.objectId,providerAccountId:binding.accountId,livemode:false,apiVersion:binding.apiVersion,digest:row!.body_digest});
 }};
 const captured=Math.floor(now.valueOf()/1000),charge={object:'charge',id:chargeId,livemode:false,currency:'usd',payment_intent:paymentIntentId,disputed:false,paid:true,captured:true,status:'succeeded',amount_captured:amountMinor,payment_method_details:{type:'card'},balance_transaction:{object:'balance_transaction',type:'charge',amount:amountMinor,fee:1950,net:amountMinor-1950,currency:'usd',source:chargeId,created:captured}};
 const paymentIntent={object:'payment_intent',id:paymentIntentId,livemode:false,currency:'usd',metadata,amount:amountMinor,amount_received:amountMinor,payment_method_types:['card'],status:'succeeded',created:captured-1000,latest_charge:charge};
 const paidSession={object:'checkout.session',id:sessionId,livemode:false,mode:'payment',status:'complete',currency:'usd',payment_method_types:['card'],metadata,client_reference_id:quote.id,amount_total:amountMinor,payment_status:'paid',payment_intent:paymentIntent};
 const readTransport:typeof fetch=async(input,init)=>{
  const url=new URL(String(input));expect(url.origin).toBe('https://api.stripe.com');expect((init?.method??'GET').toUpperCase()).toBe('GET');reads.push({path:url.pathname,query:url.searchParams});
  if(url.pathname==='/v1/account'){
   if(readMode==='revoked_before_next_get')await db.query('UPDATE synthetic_sdk.admission SET revoked=true WHERE family_id=$1',[quote.familyId]);
   return json({object:'account',id:binding.accountId});
  }
  if(url.pathname==='/v1/balance')return json({object:'balance',livemode:false,available:[],pending:[]});
  if(url.pathname==='/v1/checkout/sessions/'+sessionId)return json(paidSession);
  if(url.pathname==='/v1/refunds')return json({object:'list',has_more:false,data:[]});throw new Error('SYNTHETIC_UNEXPECTED_READ_PATH');
 };
 const createDeps:BillingCheckoutDependencies={binding,key:sdkKey,origin,successUrl:origin+'/payment/result',cancelUrl:origin+'/payment/cancel',admission:createMode==='missing_admission'?null:createAdmission,transport:createMode==='missing_transport'?null:createTransport};
 const readDeps:BillingPaymentReadDependencies={binding,key:sdkKey,clock,admission:readMode==='missing_admission'?null:readAdmission,transport:readMode==='missing_transport'?null:readTransport};
 const provider:BillingStripeTestProvider={...createFishingBillingTestCheckout(createDeps),...createFishingBillingTestReadback(readDeps)};
 const coordinator=new FishingBillingCards(native(),ring,key,config,inboxAuthority,provider);const preparation=await coordinator.prepare(owner,command);
 const inbox=new FishingBillingStripeInbox(binder,workspace,ring,clock,inboxAuthority);
 const deps:FishingBillingTestWebhookDeps={origin,binding,endpointSecret:secret,now:clock.now,admit:async()=>{await native().withCurrentCardServiceV3(binding,quote.id,async l=>{expect(l.frame.source.kind).toBe(kind);});},
  rateLimitKey:'SYNTHETIC_RATE_LIMIT_KEY_0000000000000000',limits:{consume:async k=>{
   const row=(await db.query<{count:number}>('INSERT INTO synthetic_sdk.rate_limits(key,count) VALUES($1,1) ON CONFLICT(key) DO UPDATE SET count=synthetic_sdk.rate_limits.count+1 RETURNING count',[k])).rows[0]!;return {count:row.count,retryAfterMs:0};
  }},inbox};
 const event={id:'evt_'+randomUUID().replaceAll('-',''),object:'event',type:'checkout.session.completed',api_version:binding.apiVersion,livemode:false,created:captured,data:{object:{id:sessionId,object:'checkout.session'}},description:'סינתטי בלבד'};
 const bytes=JSON.stringify(event,null,2)+'\n',signature=Stripe.webhooks.generateTestHeaderString({payload:bytes,secret,timestamp:captured});
 const request=(raw=bytes)=>new Request(origin+FISHING_BILLING_TEST_WEBHOOK_PATH,{method:'POST',headers:{'content-type':'application/json','x-forwarded-proto':'https','x-forwarded-host':'fishing-sdk.invalid','stripe-signature':signature},body:raw});
 const receive=(raw=bytes)=>fishingBillingTestWebhookHttp(request(raw),async()=>deps);
 return {quote,kind,command,preparation,coordinator,created,reads,admissions,event,bytes,receive,sessionId};
}
it.each(['historical_account','guest_successor'] as const)('actual SDK composition reconciles %s once through actual signed intake and the same mixed ledger',async kind=>{
 const f=await pipeline(kind),opened=await f.coordinator.createCheckout(owner,f.quote.id,f.command.operationId);expect(opened.state).toBe('open');
 expect(f.created.map(c=>c.path)).toEqual(['/v1/account','/v1/balance','/v1/checkout/sessions']);expect(f.admissions.filter(a=>a.stage==='create')).toEqual([{stage:'create',source:kind,state:'unknown'},{stage:'create',source:kind,state:'unknown'}]);
 expect((await native().readCurrentLedgerV3(owner,f.quote.id)).balance.paidMinor).toBe(0);
 const received=await f.receive();expect(received.status).toBe(202);expect((await received.json()).data).toEqual({received:true,processed:false,replayed:false});
 const stored=(await db.query<{body_digest:string}>('SELECT body_digest FROM ls_fishing_billing.stripe_events WHERE event_id=$1',[f.event.id])).rows[0]!;expect(stored.body_digest).toBe(createHash('sha256').update(f.bytes).digest('hex'));
 expect((await native().readCurrentLedgerV3(owner,f.quote.id)).balance.paidMinor).toBe(0);
 const result=await f.coordinator.processEvent(f.event.id);expect(result.review).toBe(false);expect(result.receiptIds).toHaveLength(1);const readCount=f.reads.length;
 expect(f.reads.map(c=>c.path)).toEqual(['/v1/account','/v1/balance','/v1/checkout/sessions/'+f.sessionId,'/v1/refunds']);expect(f.reads[2]!.query.get('expand[0]')).toBe('payment_intent.latest_charge.balance_transaction');
 expect((await f.receive()).status).toBe(202);expect(await f.coordinator.processEvent(f.event.id)).toEqual(result);expect(f.reads).toHaveLength(readCount);
 let frame=await native().readCurrentLedgerV3(owner,f.quote.id);expect(frame.source.kind).toBe(kind);expect(frame.balance).toMatchObject({paidMinor:65000,remainingMinor:65000});expect(frame.balance.receipts).toHaveLength(1);
 const cash={version:kind==='guest_successor'?OWNER_MONEY_V3:BILLING_DTO_V2,operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:frame.source.quote.revision,currency:'USD',amountMinor:20000,allocations:[{lineId:f.quote.lines[1]!.id,amountMinor:20000}],receivedPrecision:'date',receivedDate:'2035-01-06',timeZone:'America/New_York'};
 if(kind==='guest_successor')await guestMoney().recordCashDate(owner,cash);else await native().recordCashDate(owner,cash);
 frame=await native().readCurrentLedgerV3(owner,f.quote.id);expect(frame.balance).toMatchObject({paidMinor:85000,remainingMinor:45000});expect(frame.balance.receipts).toHaveLength(2);
 expect(await f.coordinator.readPreparationReceipt(owner,f.quote.id,f.command.operationId)).toEqual({...f.preparation,replayed:true});expect(f.preparation).toMatchObject({version:'JLFA-FISHING-CARD-v1',entityVersion:4,result:{amountMinor:65000}});
});
it('actual SDK composition preserves UNKNOWN after lost create reply and reconciles the signed event without a second dispatch',async()=>{
 const f=await pipeline('guest_successor','lost_reply');expect((await f.coordinator.createCheckout(owner,f.quote.id,f.command.operationId)).state).toBe('unknown');expect(f.created).toHaveLength(3);
 expect((await f.coordinator.createCheckout(owner,f.quote.id,f.command.operationId)).state).toBe('unknown');expect(f.created).toHaveLength(3);
 expect((await f.receive()).status).toBe(202);expect((await f.coordinator.processEvent(f.event.id)).review).toBe(false);expect((await native().readCurrentLedgerV3(owner,f.quote.id)).balance).toMatchObject({paidMinor:65000,remainingMinor:65000});
 expect(f.created.filter(c=>c.method.toUpperCase()==='POST')).toHaveLength(1);expect((await f.coordinator.readAttempt(owner,f.quote.id,f.command.operationId)).state).toBe('paid');
});
it.each(['missing_admission','missing_transport','revoked_before_first','revoked_before_post'] as const)('actual SDK composition denies create %s without a Checkout POST',async mode=>{
 const f=await pipeline('guest_successor',mode);expect((await f.coordinator.createCheckout(owner,f.quote.id,f.command.operationId)).state).toBe('unknown');
 expect(f.created.filter(c=>c.method.toUpperCase()==='POST')).toHaveLength(0);expect(f.created).toHaveLength(mode==='revoked_before_post'?2:0);
 await db.query('UPDATE synthetic_sdk.admission SET revoked=false WHERE family_id=$1',[f.quote.familyId]);expect((await native().readCurrentLedgerV3(owner,f.quote.id)).balance.paidMinor).toBe(0);
});
it.each(['missing_admission','missing_transport','revoked_before_next_get'] as const)('actual SDK composition keeps durable intake unresolved when payment read %s is denied',async mode=>{
 const f=await pipeline('guest_successor','normal',mode);await f.coordinator.createCheckout(owner,f.quote.id,f.command.operationId);expect((await f.receive()).status).toBe(202);
 await expect(f.coordinator.processEvent(f.event.id)).rejects.toThrow('UNAVAILABLE');expect(f.reads).toHaveLength(mode==='revoked_before_next_get'?1:0);
 await db.query('UPDATE synthetic_sdk.admission SET revoked=false WHERE family_id=$1',[f.quote.familyId]);expect((await native().readCurrentLedgerV3(owner,f.quote.id)).balance.paidMinor).toBe(0);
 expect((await db.query<{state:string}>('SELECT state FROM ls_fishing_billing.stripe_events WHERE event_id=$1',[f.event.id])).rows[0]!.state).toBe('pending');
});
it('actual SDK composition rejects tampered signed bytes before any native inbox or money mutation',async()=>{
 const f=await pipeline('guest_successor');await f.coordinator.createCheckout(owner,f.quote.id,f.command.operationId);
 expect((await f.receive(f.bytes.replace(f.event.id,'evt_TAMPERED'))).status).toBe(400);expect(f.reads).toHaveLength(0);
 expect((await db.query('SELECT event_id FROM ls_fishing_billing.stripe_events WHERE event_id=$1',[f.event.id])).rows).toHaveLength(0);expect((await native().readCurrentLedgerV3(owner,f.quote.id)).balance.paidMinor).toBe(0);
});
