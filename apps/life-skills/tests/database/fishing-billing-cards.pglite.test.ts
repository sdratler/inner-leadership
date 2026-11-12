import {randomUUID,randomBytes,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {asId} from '../../src/lib/ids.ts';
import {AppError} from '../../src/lib/errors.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {FishingBillingStore,type BillingAuthority,type BillingFinancialServiceAuthority,type BillingOutboxReservation} from '../../src/features/fishing-billing/native.ts';
import {FishingBillingCards,type BillingStripeTestProvider,type BillingRefundAllocationAuthority,type BillingCurrentRefundAllocationAuthorityV3} from '../../src/features/fishing-billing/cards.ts';
import {FishingBillingStripeInbox,verifyBillingStripeTestEvent,type BillingStripeInboxAuthority} from '../../src/features/fishing-billing/stripe-test.ts';
import {syntheticDefinition} from '../../src/features/fishing-billing/fixtures.ts';
import type {FamilyOffer,CreateFamilyOffer,ReminderPolicy} from '../../src/features/fishing-billing/contracts.ts';
import type {ProviderPaymentSnapshot,CardAttempt} from '../../src/features/fishing-billing/card-contracts.ts';
import {BILLING_DTO_V2} from '../../src/features/fishing-billing/contracts-v2.ts';
import {seal,unseal,tokenDigest} from '../../src/features/identity/crypto.ts';
import {FishingBillingGuestOwnerStore} from '../../src/lib/fishing-billing-guest-owner-store.ts';
import {OWNER_MONEY_V3} from '../../src/lib/fishing-billing-owner-contract-v3.ts';
import {BILLING_GUEST_V3} from '../../src/lib/fishing-billing-guest-contract-v3.ts';
import {bindGuestIssuedMaterial,bindGuestDisplayBundle,verifyGuestFamilyOffer} from '../../src/lib/fishing-billing-guest-material-v3.ts';
import {FishingBillingGuestGrantResolver,guestGrantLifecycleSchema,guestPresentationEvidenceSchema,type BillingGuestGrantAuthority} from '../../src/lib/fishing-billing-guest-grant-resolver.ts';
import {FishingBillingGuestNativeV3} from '../../src/features/fishing-billing/guest-native-v3.ts';
vi.mock('server-only',()=>({}));
// Memory-only native SQL; test provider ports below never connect to Stripe.
// PGlite queues transactions: real multi-connection contention remains separate.
const db=new PGlite(),workspace=asId(randomUUID(),'workspace'),otherWorkspace=asId(randomUUID(),'workspace');
const now=new Date('2035-01-06T15:00:00Z'),clock={now:()=>now};
let owner:Actor,parent:Actor,outsider:Actor,serviceRevoked=false;
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}},key=Buffer.alloc(32,9);
const binding={accountId:'acct_SYNTHETIC',livemode:false as const,apiVersion:'2026-09-30.endive' as const,verifiedBindingId:'SYNTHETIC-SERVICE'};
const config={binding,cardOnlyConfigurationId:'pmc_SYNTHETIC',approvedProductLabel:'SYNTHETIC ONLY'};
const binder:IdentityStore={transaction:work=>db.transaction(tx=>work({query:async<T extends object>(sql:string,values:readonly unknown[]=[])=> (await tx.query<T>(sql,[...values])).rows} as SqlSession))};
async function admitted(tx:SqlSession,familyId:string,childIds:string[]){
 const rows=await tx.query('SELECT family_id FROM synthetic_cards.admission WHERE family_id=$1 AND revoked=false',[familyId]);if(rows.length!==1)throw new AppError('FORBIDDEN');
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
const outbox:BillingOutboxReservation={reserve:async(c,payload)=>{
 await c.tx.query('INSERT INTO synthetic_cards.existing_outbox(dispatch_id,intent_id,payload) VALUES($1,$2,$3::jsonb)',[payload.intent.dispatchId,payload.intent.id,JSON.stringify(payload)]);
}};
const native=(dbinder=binder,service:BillingFinancialServiceAuthority|null=financial)=>new FishingBillingStore(dbinder,workspace,ring,key,authority,clock,outbox,service);
const calls:{created:unknown[];reads:number}={created:[],reads:0};
const snapshots=new Map<string,ProviderPaymentSnapshot>();
let createHook:((request:Parameters<BillingStripeTestProvider['createCheckout']>[0])=>Promise<void>)|null=null;
let readHook:(()=>Promise<void>)|null=null;
const provider:BillingStripeTestProvider={
 createCheckout:async request=>{
  calls.created.push(request);if(createHook)await createHook(request);
  return {accountId:binding.accountId,livemode:false,apiVersion:binding.apiVersion,quoteId:request.quoteId,attemptId:request.operationId,id:'cs_'+request.operationId.replaceAll('-',''),amountMinor:request.amountMinor,currency:'USD',url:'https://checkout.stripe.com/c/pay/SYNTHETIC',paymentStatus:'unpaid'};
 },
 readPayment:async receipt=>{calls.reads++;if(readHook)await readHook();const snapshot=snapshots.get(receipt.eventId);if(!snapshot)throw new AppError('UNAVAILABLE');return snapshot;},
};
const refundAuthority:BillingRefundAllocationAuthority={allocations:async(c,_q,r)=>{
 const row=(await c.tx.query<{value:{lineId:string;amountMinor:number}[]}>('SELECT allocations AS value FROM synthetic_cards.refund_allocations WHERE refund_id=$1',[r.id]))[0];return row?.value??null;
}};
const cards=(ledger=native(),transport:BillingStripeTestProvider|null=provider,refund:BillingRefundAllocationAuthority|null=refundAuthority)=>new FishingBillingCards(ledger,ring,key,config,inboxAuthority,transport,refund);
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
 await db.exec('CREATE SCHEMA synthetic_cards;CREATE TABLE synthetic_cards.admission(family_id uuid PRIMARY KEY,revoked boolean DEFAULT false,recipient_id uuid,assurance_id uuid);CREATE TABLE synthetic_cards.guest_presentations(grant_id uuid PRIMARY KEY,body jsonb,challenge text);CREATE TABLE synthetic_cards.refund_allocations(refund_id text PRIMARY KEY,allocations jsonb NOT NULL);CREATE TABLE synthetic_cards.existing_outbox(dispatch_id uuid PRIMARY KEY,intent_id uuid UNIQUE,payload jsonb NOT NULL)');
 for(const w of [workspace,otherWorkspace])await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[w,now]);
 owner=await actor('practitioner');parent=await actor('parent');outsider=await actor('practitioner',otherWorkspace);
},20000);
afterAll(async()=>{await db.close();});
async function familyInput(){
 const familyId=randomUUID(),children=[randomUUID(),randomUUID()],d=syntheticDefinition(),definitionId=randomUUID();
 await db.query('INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,$3,$4)',[familyId,workspace,'SYNTHETIC',now]);
 await db.query('INSERT INTO synthetic_cards.admission(family_id) VALUES($1)',[familyId]);
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
async function prepared(q?:FamilyOffer,amount=65000){
 const quote=q??await family(),command={operationId:randomUUID(),expectedVersion:quote.revision,quoteId:quote.id,selection:[{lineId:quote.lines[0]!.id,amountMinor:amount}]};
 const preparation=await cards().prepare(parent,command);return {quote,command,preparation};
}
async function opened(){
 const f=await prepared(),attempt=await cards().createCheckout(parent,f.quote.id,f.command.operationId);return {...f,attempt};
}
function payment(f:{quote:{id:string};attempt:Pick<CardAttempt,'id'|'sessionId'>},change:Partial<ProviderPaymentSnapshot>={}):ProviderPaymentSnapshot{
 return {accountId:binding.accountId,livemode:false,apiVersion:binding.apiVersion,quoteId:f.quote.id,attemptId:f.attempt.id,sessionId:f.attempt.sessionId!,
  paymentIntentId:'pi_'+f.attempt.id.replaceAll('-',''),currency:'USD',amountMinor:65000,receivedMinor:65000,status:'paid',method:'card',paidAt:now.toISOString(),observedAt:now.toISOString(),refunds:[],dispute:'none',...change};
}
async function event(snapshot:ProviderPaymentSnapshot,kind:'checkout.session.completed'|'payment_intent.succeeded'|'refund.updated'='payment_intent.succeeded'){
 const eventId='evt_'+randomUUID().replaceAll('-',''),objectId=kind.startsWith('checkout')?snapshot.sessionId:kind.startsWith('refund')?snapshot.refunds[0]!.id:snapshot.paymentIntentId;
 const bytes=Buffer.from('SYNTHETIC_ADAPTER_EVENT_'+eventId),receipt={eventId,eventType:kind,objectId,providerAccountId:binding.accountId,livemode:false as const,apiVersion:binding.apiVersion,digest:createHash('sha256').update(bytes).digest('hex'),createdAt:now.toISOString()};
 const cap=verifyBillingStripeTestEvent({rawBody:bytes,signatureHeader:'SYNTHETIC_ADAPTER',binding,now,sdk:{verify:()=>({kind:'stripe_test_signature_only',receipt})}});
 await new FishingBillingStripeInbox(binder,workspace,ring,clock,inboxAuthority).ingest(cap);snapshots.set(eventId,snapshot);return eventId;
}
// Actual new guest owner/native acceptance and concrete card coordinator, with
// synthetic SQL admission/display records and the existing MOCK provider only.
const guestMoney=()=>new FishingBillingGuestOwnerStore(binder,workspace,ring,key,clock,authority);
const guestAuthority:BillingGuestGrantAuthority={
 target:async c=>{const rows=await c.tx.query('SELECT id FROM ls_identity.workspaces WHERE id=$1',[workspace]);if(c.workspaceId!==workspace||rows.length!==1)throw new AppError('UNAVAILABLE');},
 current:async(c,g,mode)=>{
  await admitted(c.tx,g.offer.material.familyId,g.offer.material.lines.map(l=>l.childId));
  const rows=await c.tx.query<{recipient:string;assurance:string}>('SELECT recipient_id AS recipient,assurance_id AS assurance FROM synthetic_cards.admission WHERE family_id=$1 AND revoked=false',[g.offer.material.familyId]);
  const issuers=await c.tx.query("SELECT id FROM ls_identity.accounts WHERE workspace_id=$1 AND id=$2 AND role='practitioner' AND state='active'",[workspace,g.issuedByAccountId]);
  const quotes=await c.tx.query<{ciphertext:string}>('SELECT payload_ciphertext AS ciphertext FROM ls_fishing_billing.quotes WHERE workspace_id=$1 AND id=$2',[workspace,g.offer.material.quoteId]);
  if(rows.length!==1||!rows[0]!.recipient||!rows[0]!.assurance||issuers.length!==1||quotes.length!==1)throw new AppError('FORBIDDEN');
  const q=verifyGuestFamilyOffer(JSON.parse(unseal(quotes[0]!.ciphertext,'ls_fishing_billing/guest/v3/quote/'+workspace+'/'+g.offer.material.quoteId,ring)));
  if(mode==='fresh'?q.state!=='issued':q.acceptance?.grantId!==g.id)throw new AppError('FORBIDDEN');
  return {workspaceId:workspace,familyId:q.familyId,quoteId:q.id,grantId:g.id,recipientBindingEvidenceId:rows[0]!.recipient,assuranceEvidenceId:rows[0]!.assurance,admissionPolicy:q.definition.source};
 },
 display:async(c,g,challenge)=>{
  const rows=await c.tx.query<{body:unknown;challenge:string}>('SELECT body,challenge FROM synthetic_cards.guest_presentations WHERE grant_id=$1',[g.id]);
  if(rows.length!==1||challenge!==rows[0]!.challenge)throw new AppError('FORBIDDEN');return guestPresentationEvidenceSchema.parse(rows[0]!.body);
 },
};
async function guestFamily(){
 calls.created.length=0;calls.reads=0;
 const cmd=await familyInput();await guestMoney().createOffer(owner,cmd);
 const q=(await guestMoney().issueOffer(owner,{operationId:randomUUID(),quoteId:cmd.id,expectedVersion:1})).quote;
 const offer=bindGuestIssuedMaterial({workspaceId:workspace,familyId:q.familyId,quoteId:q.id,issuedRevision:q.revision,definition:q.definition,lines:q.lines,createdAt:q.createdAt,issuedAt:q.issuedAt,override:q.override});
 const display=bindGuestDisplayBundle({id:randomUUID(),version:'SYNTHETIC FINANCIAL TERMS',locale:'en',offerSnapshotSha256:offer.sha256,documents:[{purpose:'financial_terms',source:q.definition.terms,displayedTextSha256:'b'.repeat(64),releaseEvidenceId:randomUUID()}]});
 const token=randomBytes(32).toString('base64url'),challenge='z'.repeat(43),recipient=randomUUID(),assurance=randomUUID();
 const lifecycle=guestGrantLifecycleSchema.parse({version:BILLING_GUEST_V3,state:'active',revokedAt:null,use:null,grant:{version:BILLING_GUEST_V3,id:randomUUID(),action:'accept_financial_offer',offer,displayBundle:display,recipientBindingEvidenceId:recipient,admissionPolicy:q.definition.source,tokenDigest:tokenDigest(token),issuedAt:now.toISOString(),expiresAt:new Date(now.valueOf()+86400000).toISOString(),issuedByAccountId:owner.id}}),g=lifecycle.grant;
 await db.query('UPDATE synthetic_cards.admission SET recipient_id=$2,assurance_id=$3 WHERE family_id=$1',[q.familyId,recipient,assurance]);
 await db.query('INSERT INTO ls_fishing_billing.guest_grants VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)',[workspace,g.id,q.id,g.action,g.tokenDigest,'active',g.issuedAt,g.expiresAt,seal(JSON.stringify(lifecycle),'ls_fishing_billing/guest_grant/v3/'+workspace+'/'+g.id,ring)]);
 const presentation={action:'accept_financial_offer',grantId:g.id,displayBundleId:display.id,displayBundleSha256:display.sha256,locale:display.locale,evidenceId:randomUUID(),affirmation:{version:'SYNTHETIC STATEMENT',guardianAuthorityText:'SYNTHETIC GUARDIAN TEXT',financialTermsText:'SYNTHETIC FINANCIAL TEXT'}};
 await db.query('INSERT INTO synthetic_cards.guest_presentations VALUES($1,$2::jsonb,$3)',[g.id,JSON.stringify(presentation),challenge]);
 const resolver=new FishingBillingGuestGrantResolver(workspace,ring,key,clock,guestAuthority),acceptance=new FishingBillingGuestNativeV3(binder,workspace,ring,clock,resolver);
 await acceptance.acceptFinancialOffer(token,{operationId:randomUUID(),expectedVersion:2,displayBundleId:display.id,displayBundleSha256:display.sha256,displayChallenge:challenge,parent:{submittedName:'SYNTHETIC GUEST ONLY',guardianAuthorityAttested:true,financialTermsAffirmed:true}});
 return guestMoney().readQuote(owner,q.id);
}
async function guestOpened(){
 const quote=await guestFamily(),command={operationId:randomUUID(),quoteId:quote.id,expectedVersion:quote.revision,selection:[{lineId:quote.lines[0]!.id,amountMinor:65000}]};
 const preparation=await cards().prepare(owner,command),attempt=await cards().createCheckout(owner,quote.id,command.operationId);return {quote,command,preparation,attempt};
}
it('current guest card preserves generic preparation and actual guest provenance without a parent account',async()=>{
 const before=(await db.query('SELECT id FROM ls_identity.accounts WHERE workspace_id=$1',[workspace])).rows.length;
 const q=await guestFamily(),cmd={operationId:randomUUID(),quoteId:q.id,expectedVersion:3,selection:[{lineId:q.lines[0]!.id,amountMinor:20000}]};
 const first=await cards().prepare(owner,cmd);expect(first).toMatchObject({version:'JLFA-FISHING-CARD-v1',entityVersion:4,result:{amountMinor:20000}});
 expect(await cards().prepare(owner,cmd)).toEqual({...first,replayed:true});expect(await cards().readPreparationReceipt(owner,q.id,cmd.operationId)).toEqual({...first,replayed:true});
 const frame=await native().readCurrentLedgerV3(owner,q.id);expect(frame.source.kind).toBe('guest_successor');expect(frame.source.quote.version).toBe(BILLING_GUEST_V3);expect(frame.balance.pendingAttemptIds).toEqual([cmd.operationId]);
 expect((await db.query('SELECT id FROM ls_identity.accounts WHERE workspace_id=$1',[workspace])).rows).toHaveLength(before);expect(calls.created).toHaveLength(0);
});
it('current guest card reconciles MOCK signed facts and actual Root date cash to the same two-child ledger',async()=>{
 const f=await guestOpened(),id=await event(payment(f));const paid=await cards().processEvent(id);expect(paid.review).toBe(false);expect(await cards().processEvent(id)).toEqual(paid);
 let frame=await native().readCurrentLedgerV3(owner,f.quote.id);expect(frame.balance).toMatchObject({paidMinor:65000,remainingMinor:65000});
 await guestMoney().recordCashDate(owner,{version:OWNER_MONEY_V3,operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:frame.source.quote.revision,currency:'USD',amountMinor:20000,allocations:[{lineId:f.quote.lines[1]!.id,amountMinor:20000}],receivedPrecision:'date',receivedDate:'2035-01-06',timeZone:'America/New_York'});
 frame=await native().readCurrentLedgerV3(owner,f.quote.id);expect(frame.balance).toMatchObject({paidMinor:85000,remainingMinor:45000});
 await guestMoney().recordCashDate(owner,{version:OWNER_MONEY_V3,operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:frame.source.quote.revision,currency:'USD',amountMinor:45000,allocations:[{lineId:f.quote.lines[1]!.id,amountMinor:45000}],receivedPrecision:'date',receivedDate:'2035-01-06',timeZone:'America/New_York'});
 frame=await native().readCurrentLedgerV3(owner,f.quote.id);expect(frame.source.kind).toBe('guest_successor');expect(frame.balance).toMatchObject({state:'paid',paidMinor:130000,remainingMinor:0});expect(frame.balance.receipts).toHaveLength(3);expect(calls.created).toHaveLength(1);
});
it('current guest card is stale after an actual cash update and cannot dispatch its old amount',async()=>{
 const q=await guestFamily(),cmd={operationId:randomUUID(),quoteId:q.id,expectedVersion:3,selection:[{lineId:q.lines[0]!.id,amountMinor:20000}]};await cards().prepare(owner,cmd);
 await guestMoney().recordCashDate(owner,{version:OWNER_MONEY_V3,operationId:randomUUID(),quoteId:q.id,expectedVersion:4,currency:'USD',amountMinor:10000,allocations:[{lineId:q.lines[0]!.id,amountMinor:10000}],receivedPrecision:'date',receivedDate:'2035-01-06',timeZone:'America/New_York'});
 expect((await cards().createCheckout(owner,q.id,cmd.operationId)).state).toBe('stale');expect(calls.created).toHaveLength(0);expect((await native().readCurrentLedgerV3(owner,q.id)).balance.paidMinor).toBe(10000);
});
it('current guest card open provider exception forces actual current review and blocks a new preparation',async()=>{
 const f=await guestOpened(),id=await event(payment(f,{amountMinor:65001}));expect((await cards().processEvent(id)).review).toBe(true);
 const frame=await native().readCurrentLedgerV3(owner,f.quote.id);expect(frame.balance.state).toBe('review_required');expect(frame.cardExceptions.some(e=>e.state==='open')).toBe(true);
 await expect(cards().prepare(owner,{operationId:randomUUID(),quoteId:f.quote.id,expectedVersion:frame.source.quote.revision,selection:[{lineId:f.quote.lines[1]!.id,amountMinor:100}]})).rejects.toThrow('UNAVAILABLE');
});
it('current guest card refund requires explicit current-frame native allocation and retains original facts',async()=>{
 const f=await guestOpened(),snapshot=payment(f);await cards().processEvent(await event(snapshot));const refundId='re_'+randomUUID().replaceAll('-','');
 await db.query('INSERT INTO synthetic_cards.refund_allocations VALUES($1,$2::jsonb)',[refundId,JSON.stringify([{lineId:f.quote.lines[0]!.id,amountMinor:10000}])]);
 const refundEvent=await event({...snapshot,refunds:[{id:refundId,amountMinor:10000,state:'succeeded',occurredAt:now.toISOString()}]},'refund.updated');
 expect(await cards().processEvent(refundEvent)).toMatchObject({review:true,reason:'refund_allocation_required'});
 const currentAllocation:BillingCurrentRefundAllocationAuthorityV3={allocations:async(c,frame,r,original)=>{
  expect(frame.source.kind).toBe('guest_successor');expect(frame.source.quote.id).toBe(f.quote.id);expect(original.kind).toBe('card');
  const row=(await c.tx.query<{value:{lineId:string;amountMinor:number}[]}>('SELECT allocations AS value FROM synthetic_cards.refund_allocations WHERE refund_id=$1',[r.id]))[0];
  if(!row||!row.value.every(a=>frame.source.quote.lines.some(l=>l.id===a.lineId)))return null;return row.value;
 }};
 const approved=new FishingBillingCards(native(),ring,key,config,inboxAuthority,provider,refundAuthority,currentAllocation);
 expect((await approved.processEvent(refundEvent)).review).toBe(false);
 const frame=await native().readCurrentLedgerV3(owner,f.quote.id);expect(frame.balance).toMatchObject({paidMinor:55000,remainingMinor:75000});expect(frame.balance.receipts.filter(r=>r.kind==='refund')).toHaveLength(1);
});
it('prepares an immutable partial attempt under a current accepted balance; same command recovers exactly',async()=>{
 const f=await prepared(undefined,20000);
 expect(f.preparation).toMatchObject({entityVersion:4,result:{amountMinor:20000}});
 expect(await cards().prepare(parent,f.command)).toEqual({...f.preparation,replayed:true});
 expect(await cards().readPreparationReceipt(parent,f.quote.id,f.command.operationId)).toEqual({...f.preparation,replayed:true});
 expect((await native().readBalance(owner,f.quote.id)).balance).toMatchObject({revision:4,paidMinor:0,pendingAttemptIds:[f.command.operationId]});
 await expect(cards().prepare(parent,{...f.command,selection:[{lineId:f.quote.lines[1]!.id,amountMinor:20000}]})).rejects.toThrow('CONFLICT');
 await expect(cards().prepare(parent,{...f.command,operationId:randomUUID(),expectedVersion:4})).rejects.toThrow('CONFLICT');
});
it('unaccepted/stale/cross-workspace/zero card inputs cannot create an attempt',async()=>{
 const q=await family(false),cmd={operationId:randomUUID(),expectedVersion:2,quoteId:q.id,selection:[{lineId:q.lines[0]!.id,amountMinor:100}]};
 await expect(cards().prepare(parent,cmd)).rejects.toThrow('UNAVAILABLE');
 await expect(cards().prepare(outsider,cmd)).rejects.toThrow('FORBIDDEN');
 await expect(cards().prepare(parent,{...cmd,selection:[{lineId:q.lines[0]!.id,amountMinor:0}]})).rejects.toThrow();
});
it('commits UNKNOWN before SDK creation, uses one operation key and never credits from a session response',async()=>{
 const f=await prepared(),start=calls.created.length;
 createHook=async request=>{
  const row=(await db.query<{state:string}>('SELECT state FROM ls_fishing_billing.card_attempts WHERE id=$1',[request.operationId])).rows[0]!;
  expect(row.state).toBe('unknown');expect((await native().readBalance(owner,f.quote.id)).balance.paidMinor).toBe(0);
 };
 try{
  const results=await Promise.all([cards().createCheckout(parent,f.quote.id,f.command.operationId),cards().createCheckout(parent,f.quote.id,f.command.operationId)]);
  expect(calls.created.length-start).toBe(1);expect(results.some(a=>a.state==='open')).toBe(true);
 }finally{createHook=null;}
 expect((await native().readBalance(owner,f.quote.id)).balance).toMatchObject({paidMinor:0,state:'unpaid',revision:6});
});
it('a provider timeout remains UNKNOWN and a repeated click cannot create another session',async()=>{
 const f=await prepared(),start=calls.created.length;createHook=async()=>{throw new Error('SYNTHETIC_TIMEOUT');};
 try{expect((await cards().createCheckout(parent,f.quote.id,f.command.operationId)).state).toBe('unknown');}finally{createHook=null;}
 expect((await cards().createCheckout(parent,f.quote.id,f.command.operationId)).state).toBe('unknown');
 expect(calls.created.length-start).toBe(1);expect((await native().readBalance(owner,f.quote.id)).balance.paidMinor).toBe(0);
});
it('cash before dispatch invalidates the old attempt without calling the provider',async()=>{
 const f=await prepared(),start=calls.created.length;
 await native().recordCash(owner,{operationId:randomUUID(),expectedVersion:4,quoteId:f.quote.id,currency:'USD',amountMinor:65000,receivedAt:now.toISOString(),allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:65000}]});
 expect((await cards().createCheckout(parent,f.quote.id,f.command.operationId)).state).toBe('stale');
 expect(calls.created.length).toBe(start);
});
it('cash/card in flight retains both actual funds and flags overpayment rather than hiding a late payment',async()=>{
 const f=await prepared();
 createHook=async()=>{await native().recordCash(owner,{operationId:randomUUID(),expectedVersion:5,quoteId:f.quote.id,currency:'USD',amountMinor:65000,receivedAt:now.toISOString(),allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:65000}]});};
 let attempt;try{attempt=await cards().createCheckout(parent,f.quote.id,f.command.operationId);}finally{createHook=null;}
 expect(attempt.state).toBe('stale');
 const id=await event(payment({...f,attempt}));expect((await cards().processEvent(id)).review).toBe(false);
 expect((await native().readBalance(owner,f.quote.id)).balance).toMatchObject({state:'overpaid',paidMinor:130000,excessMinor:65000,remainingMinor:65000,revision:8});
});
it('different signed events for one transaction credit once and every money change fences stale cash dialogs',async()=>{
 const f=await opened(),s=payment(f),e1=await event(s),e2=await event(s,'checkout.session.completed');
 const first=await cards().processEvent(e1);expect(first.receiptIds).toHaveLength(1);
 expect((await cards().processEvent(e2)).receiptIds).toHaveLength(0);expect(await cards().processEvent(e1)).toEqual(first);
 const b=(await native().readBalance(owner,f.quote.id)).balance;expect(b).toMatchObject({paidMinor:65000,remainingMinor:65000,revision:7});expect(b.receipts).toHaveLength(1);
 await expect(native().recordCash(owner,{operationId:randomUUID(),expectedVersion:6,quoteId:f.quote.id,currency:'USD',amountMinor:1,receivedAt:now.toISOString(),allocations:[{lineId:f.quote.lines[1]!.id,amountMinor:1}]})).rejects.toThrow('CONFLICT');
});
it('pending and failed states remain unpaid; a later actual paid read can settle without event-order assumptions',async()=>{
 const f=await opened();
 const pending=await event(payment(f,{status:'pending',receivedMinor:0,paidAt:null}));await cards().processEvent(pending);
 expect((await cards().readAttempt(parent,f.quote.id,f.attempt.id)).state).toBe('pending');
 const failed=await event(payment(f,{status:'failed',receivedMinor:0,paidAt:null}));await cards().processEvent(failed);
 expect((await native().readBalance(owner,f.quote.id)).balance.paidMinor).toBe(0);
 const late=await event(payment(f));await cards().processEvent(late);
 expect((await native().readBalance(owner,f.quote.id)).balance.paidMinor).toBe(65000);
});
it('a refund arriving first reads current provider facts and appends one original payment plus one explicit-allocation refund',async()=>{
 const f=await opened(),refund={id:'re_'+randomUUID().replaceAll('-',''),amountMinor:20000,state:'succeeded' as const,occurredAt:now.toISOString()};
 await db.query('INSERT INTO synthetic_cards.refund_allocations(refund_id,allocations) VALUES($1,$2::jsonb)',[refund.id,JSON.stringify([{lineId:f.quote.lines[0]!.id,amountMinor:20000}])]);
 const s=payment(f,{refunds:[refund]});await cards().processEvent(await event(s,'refund.updated'));
 const b=(await native().readBalance(owner,f.quote.id)).balance;expect(b).toMatchObject({paidMinor:45000,remainingMinor:85000,revision:7});expect(b.receipts).toHaveLength(2);
 expect(b.receipts.find(r=>r.kind==='refund')!.originalReceiptId).toBe(b.receipts.find(r=>r.kind==='card')!.id);
 await cards().processEvent(await event(s));expect((await native().readBalance(owner,f.quote.id)).balance.receipts).toHaveLength(2);
});
it('an actual refund without authorized allocations is retained as a financial review exception, never guessed',async()=>{
 const f=await opened(),s=payment(f,{refunds:[{id:'re_'+randomUUID().replaceAll('-',''),amountMinor:20000,state:'succeeded',occurredAt:now.toISOString()}]});
 const id=await event(s,'refund.updated');expect(await cards().processEvent(id)).toMatchObject({review:true,reason:'refund_allocation_required'});
 expect((await native().readBalance(owner,f.quote.id)).balance.state).toBe('review_required');
 expect((await db.query('SELECT id FROM ls_fishing_billing.card_exceptions WHERE quote_id=$1',[f.quote.id])).rows).toHaveLength(1);
});
it('wrong account/mode/currency/amount and cross-order facts cannot credit a family',async()=>{
 for(const bad of ['account','mode','currency','amount','quote']){
  const f=await opened(),s=payment(f),id=await event(s);
  if(bad==='account')s.accountId='acct_OTHER';if(bad==='mode')Object.assign(s,{livemode:true});if(bad==='currency')Object.assign(s,{currency:'ILS'});
  if(bad==='amount')s.amountMinor=65001;if(bad==='quote')s.quoteId=(await family()).id;
  if(bad==='amount')expect((await cards().processEvent(id)).review).toBe(true);else await expect(cards().processEvent(id)).rejects.toThrow();
  expect((await native().readBalance(owner,f.quote.id)).balance.paidMinor).toBe(0);
 }
});
it('settlement storage failure rolls back receipts, balances, status and processed event before a safe same-event recovery',async()=>{
 const f=await opened(),id=await event(payment(f));
 const broken:IdentityStore={transaction:work=>binder.transaction(tx=>work({query:(sql,v)=>{if(sql.startsWith('INSERT INTO ls_fishing_billing.card_settlements'))throw new Error('SYNTHETIC_SETTLEMENT_FAILURE');return tx.query(sql,v);}}))};
 await expect(cards(native(broken)).processEvent(id)).rejects.toThrow('SYNTHETIC_SETTLEMENT_FAILURE');
 expect((await native().readBalance(owner,f.quote.id)).balance).toMatchObject({paidMinor:0,revision:6});
 expect((await db.query<{state:string}>('SELECT state FROM ls_fishing_billing.stripe_events WHERE event_id=$1',[id])).rows[0]!.state).toBe('pending');
 await cards().processEvent(id);expect((await native().readBalance(owner,f.quote.id)).balance.receipts).toHaveLength(1);
});
it('revoked service/family, missing service and missing provider fail before an external create or settlement',async()=>{
 const f=await prepared(),start=calls.created.length;
 await expect(cards(native(),null).createCheckout(parent,f.quote.id,f.command.operationId)).rejects.toThrow('UNAVAILABLE');
 await expect(cards(native(binder,null)).createCheckout(parent,f.quote.id,f.command.operationId)).rejects.toThrow('UNAVAILABLE');
 serviceRevoked=true;
 try{await expect(cards().createCheckout(parent,f.quote.id,f.command.operationId)).rejects.toThrow('FORBIDDEN');}finally{serviceRevoked=false;}
 expect(calls.created.length).toBe(start);
 const openedCase=await opened(),id=await event(payment(openedCase));await db.query('UPDATE synthetic_cards.admission SET revoked=true WHERE family_id=$1',[openedCase.quote.familyId]);
 await expect(cards().processEvent(id)).rejects.toThrow('FORBIDDEN');
});
it('two pre-lock handlers return the exact committed event result instead of replacing receiptIds',async()=>{
 const f=await opened(),id=await event(payment(f));let arrivals=0,release!:()=>void;const barrier=new Promise<void>(resolve=>{release=resolve;});
 readHook=async()=>{arrivals++;if(arrivals===2)release();await barrier;};
 let results;try{results=await Promise.all([cards().processEvent(id),cards().processEvent(id)]);}finally{readHook=null;}
 expect(arrivals).toBe(2);expect(results[0]).toEqual(results[1]);expect(results[0]!.receiptIds).toHaveLength(1);
 expect(await cards().processEvent(id)).toEqual(results[0]);expect((await native().readBalance(owner,f.quote.id)).balance.receipts).toHaveLength(1);
});
it('never-dispatched prepared funds are retained for review without attaching a fabricated charge',async()=>{
 const f=await prepared(),attempt=await cards().readAttempt(parent,f.quote.id,f.command.operationId);
 const s=payment({...f,attempt},{sessionId:'cs_'+attempt.id.replaceAll('-','')});
 const result=await cards().processEvent(await event(s));expect(result).toMatchObject({review:true,reason:'never_dispatched_funds'});
 const b=(await native().readBalance(owner,f.quote.id)).balance;expect(b).toMatchObject({state:'review_required',paidMinor:0});expect(b.receipts).toHaveLength(0);
 expect((await cards().readAttempt(parent,f.quote.id,attempt.id)).dispatchId).toBeNull();
});
it('a genuine UNKNOWN payment may settle before the create HTTP response without losing or downgrading it',async()=>{
 const f=await prepared();
 createHook=async()=>{
  const attempt=await cards().readAttempt(parent,f.quote.id,f.command.operationId);expect(attempt.state).toBe('unknown');expect(attempt.dispatchId).not.toBeNull();
  const s=payment({...f,attempt},{sessionId:'cs_'+attempt.id.replaceAll('-','')});await cards().processEvent(await event(s));
 };
 let result;try{result=await cards().createCheckout(parent,f.quote.id,f.command.operationId);}finally{createHook=null;}
 expect(result.state).toBe('paid');expect((await native().readBalance(owner,f.quote.id)).balance).toMatchObject({paidMinor:65000,revision:6});
});
it('freezes the complete request and eight-letter identifier before dispatch, preserving identical parameters on recovery',async()=>{
 const f=await prepared(),row=(await db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_fishing_billing.card_attempt_requests WHERE attempt_id=$1',[f.command.operationId])).rows[0]!;
 const frozen=JSON.parse(unseal(row.payload_ciphertext,'ls_fishing_billing/card/v1/checkout_request/'+workspace+'/'+f.command.operationId,ring)) as {request:Parameters<BillingStripeTestProvider['createCheckout']>[0]};
 expect(frozen.request.params.integration_identifier).toMatch(/^jlfa_monthly_[a-z]{8}$/);
 await cards().prepare(parent,f.command);expect((await db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_fishing_billing.card_attempt_requests WHERE attempt_id=$1',[f.command.operationId])).rows[0]!.payload_ciphertext).toBe(row.payload_ciphertext);
 createHook=async request=>{expect(request).toEqual(frozen.request);throw new Error('SYNTHETIC_TIMEOUT');};
 try{await cards().createCheckout(parent,f.quote.id,f.command.operationId);}finally{createHook=null;}
 expect((await cards().createCheckout(parent,f.quote.id,f.command.operationId)).state).toBe('unknown');
 expect((await db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_fishing_billing.card_attempt_requests WHERE attempt_id=$1',[f.command.operationId])).rows[0]!.payload_ciphertext).toBe(row.payload_ciphertext);
});
it('combines date-only partial cash and a verified card remainder for a two-child family without inventing a receipt instant',async()=>{
 const q=await family(),cash=await native().recordCashDate(owner,{version:BILLING_DTO_V2,operationId:randomUUID(),expectedVersion:3,quoteId:q.id,currency:'USD',amountMinor:20000,allocations:[{lineId:q.lines[0]!.id,amountMinor:20000}],receivedPrecision:'date',receivedDate:'2035-01-06',timeZone:'America/New_York'});
 const command={operationId:randomUUID(),expectedVersion:4,quoteId:q.id,selection:[{lineId:q.lines[0]!.id,amountMinor:45000},{lineId:q.lines[1]!.id,amountMinor:65000}]};
 await cards().prepare(parent,command);const attempt=await cards().createCheckout(parent,q.id,command.operationId);
 await cards().processEvent(await event(payment({quote:q,attempt},{amountMinor:110000,receivedMinor:110000})));
 const b=(await native().readBalanceV2(owner,q.id)).balance;expect(b).toMatchObject({state:'paid',paidMinor:130000,remainingMinor:0,revision:8});
 expect(b.receipts.find(r=>r.id===cash.result.receiptId)).toMatchObject({receivedDate:'2035-01-06',receivedPrecision:'date'});expect(b.receipts.find(r=>r.id===cash.result.receiptId)).not.toHaveProperty('receivedAt');
 expect(b.receipts.find(r=>r.kind==='card')).toMatchObject({receivedAt:now.toISOString(),amountMinor:110000});
});
it('runs one durable two-child card/cash/reminder journey with fresh balances, paid suppression and a truthful late delivery',async()=>{
 const f=await opened(),quoteId=f.quote.id;
 const policy:ReminderPolicy={id:'SYNTHETIC-FLOW-REMINDER',revision:1,source:{id:'SYNTHETIC',sha256:'a'.repeat(64)},timeZone:'America/New_York',offsetsMinutes:[0,1440]};
 const queued=await native().queueReminders(owner,{quoteId,policy,guardianId:parent.id,channel:'email'});expect(queued).toHaveLength(2);
 const before=await native().readBalanceV2(owner,quoteId);
 const dateCash=await native().recordCashDate(owner,{version:BILLING_DTO_V2,operationId:randomUUID(),quoteId,expectedVersion:before.quote.revision,
  currency:'USD',amountMinor:20000,allocations:[{lineId:f.quote.lines[1]!.id,amountMinor:20000}],receivedPrecision:'date',receivedDate:'2035-01-06',timeZone:'America/New_York'});
 expect(dateCash.result.balance.remainingMinor).toBe(110000);
 const eventId=await event(payment(f)),processed=await cards().processEvent(eventId);
 expect(processed.receiptIds).toHaveLength(1);
 const partial=await native().readBalanceV2(owner,quoteId);expect(partial.balance).toMatchObject({dueMinor:130000,paidMinor:85000,remainingMinor:45000,state:'partial'});
 const target=queued.find(i=>i.sequence===0)!,dispatchId=randomUUID();
 expect(await native().reserveReminder(owner,target.id,dispatchId)).toMatchObject({reserved:true,remainingMinor:45000});
 const reserved=(await db.query<{payload:{intent:{audience:string};amount:{familyId:string;remainingMinor:number;lines:{childId:string;remainingMinor:number}[]}}}>('SELECT payload FROM synthetic_cards.existing_outbox WHERE dispatch_id=$1',[dispatchId])).rows[0]!.payload;
 expect(reserved.intent.audience).toBe('individual');expect(reserved.amount).toMatchObject({familyId:f.quote.familyId,remainingMinor:45000});
 expect(reserved.amount.lines).toHaveLength(1);expect(reserved.amount.lines[0]).toMatchObject({childId:f.quote.lines[1]!.childId,remainingMinor:45000});
 const paid=await native().recordCashDate(owner,{version:BILLING_DTO_V2,operationId:randomUUID(),quoteId,expectedVersion:partial.quote.revision,
  currency:'USD',amountMinor:45000,allocations:[{lineId:f.quote.lines[1]!.id,amountMinor:45000}],receivedPrecision:'date',receivedDate:'2035-01-06',timeZone:'America/New_York'});
 expect(paid.result.balance).toMatchObject({paidMinor:130000,remainingMinor:0,state:'paid'});
 expect(paid.result.balance.reminders.find(i=>i.id===target.id)!.state).toBe('unknown');
 expect(paid.result.balance.reminders.filter(i=>i.id!==target.id).every(i=>i.state==='suppressed')).toBe(true);
 for(const i of queued)expect((await native().reserveReminder(owner,i.id,randomUUID())).reserved).toBe(false);
 expect((await db.query('SELECT dispatch_id FROM synthetic_cards.existing_outbox WHERE intent_id=$1',[target.id])).rows).toHaveLength(1);
 expect(await cards().processEvent(eventId)).toEqual(processed);await cards().processEvent(await event(payment(f)));
 const reloaded=await native().readBalanceV2(owner,quoteId);expect(reloaded.balance).toMatchObject({state:'paid',paidMinor:130000,remainingMinor:0});expect(reloaded.balance.receipts).toHaveLength(3);
 expect((await native().readOperationReceiptV2(owner,paid.operationId))!.result).toEqual(paid.result);
 expect((await native().readLedgerHistoryV2(owner,{quoteId,cursor:null,limit:100})).items).toHaveLength(3);
 // Injected synthetic outcomes prove state handling, never real delivery.
 expect((await native().recordReminderOutcome(owner,{id:target.id,dispatchId,state:'provider_accepted',providerId:'SYNTHETIC-ONLY'})).state).toBe('provider_accepted');
 expect((await native().recordReminderOutcome(owner,{id:target.id,dispatchId,state:'delivered',providerId:'SYNTHETIC-ONLY'})).state).toBe('delivered');
});
