import {randomUUID,createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {PGlite} from '@electric-sql/pglite';
import {beforeAll,afterAll,it,expect,vi} from 'vitest';
import {asId} from '../../src/lib/ids.ts';
import {AppError} from '../../src/lib/errors.ts';
import type {Actor} from '../../src/features/identity/types.ts';
import type {IdentityStore,SqlSession} from '../../src/features/identity/store.ts';
import {FishingBillingStore,type BillingAuthority,type BillingOutboxReservation} from '../../src/features/fishing-billing/native.ts';
import {syntheticDefinition} from '../../src/features/fishing-billing/fixtures.ts';
import type {CreateFamilyOffer,FamilyOffer,ReminderPolicy} from '../../src/features/fishing-billing/contracts.ts';
import {BILLING_DTO_V2} from '../../src/features/fishing-billing/contracts-v2.ts';
import {FishingBillingStripeInbox,verifyBillingStripeTestEvent,type VerifiedBillingStripeEvent} from '../../src/features/fishing-billing/stripe-test.ts';
vi.mock('server-only',()=>({}));

// Explicit in-memory DB only. No URL, credentials, .env, port, migration runner,
// provider transport or existing native-data import. PGlite serializes its
// transactions; this proves fencing/constraints, not multi-connection Postgres.
const db=new PGlite(),workspace=asId(randomUUID(),'workspace'),otherWorkspace=asId(randomUUID(),'workspace');
const now=new Date('2035-01-06T15:00:00Z');let owner:Actor,parent:Actor,outsider:Actor;
let sendWindowOpen=true,consented=true,outboxFails=false,authorityRevoked=false;const ownerEnabled=true;
const ring={activeKeyId:'synthetic',keys:{synthetic:Buffer.alloc(32,7)}};
const binder:IdentityStore={transaction:work=>db.transaction(tx=>work({
 query:async<T extends object>(sql:string,values:readonly unknown[]=[])=> (await tx.query<T>(sql,[...values])).rows,
} as SqlSession))};
const authority:BillingAuthority={
 authorize:async(c,action,s)=>{
  if(s.programKey!=='fishing_monthly_club'||authorityRevoked)throw new AppError('FORBIDDEN');
  if(s.familyId===null){if(c.actor.id!==owner.id||action!=='publish')throw new AppError('FORBIDDEN');return;}
  const rows=await c.tx.query<{guardianId:string}>('SELECT guardian_id AS "guardianId" FROM synthetic_billing.program_families WHERE workspace_id=$1 AND family_id=$2 AND revoked=false',[c.workspaceId,s.familyId]);
  if(rows.length!==1||c.actor.id!==owner.id&&c.actor.id!==rows[0]!.guardianId)throw new AppError('FORBIDDEN');
  const members=await c.tx.query<{id:string}>("SELECT person_id AS id FROM ls_cases.family_members WHERE workspace_id=$1 AND family_id=$2 AND role='child'",[c.workspaceId,s.familyId]);
  if(!s.childIds.every(id=>members.some(m=>m.id===id)))throw new AppError('FORBIDDEN');
 },
 reminderPermission:async(c,q,p,guardianId,channel)=>{
  const rows=await c.tx.query<{guardianId:string}>('SELECT guardian_id AS "guardianId" FROM synthetic_billing.program_families WHERE workspace_id=$1 AND family_id=$2 AND revoked=false',[c.workspaceId,q.familyId]);
  if(rows.length!==1||rows[0]!.guardianId!==guardianId)throw new AppError('FORBIDDEN');
  return {audience:{guardianId,channel,audience:'individual',locale:'he',verified:true,consented,active:true},sendWindowOpen,ownerEnabled,policyCurrent:p.id==='SYNTHETIC-APPROVED-REMINDER'&&p.source.sha256==='a'.repeat(64)};
 },
};
const outbox:BillingOutboxReservation={reserve:async(c,{intent,amount})=>{
 if(outboxFails)throw new Error('SYNTHETIC_EXISTING_OUTBOX_FAILURE');
 await c.tx.query('INSERT INTO synthetic_billing.existing_outbox(dispatch_id,intent_id,remaining_minor,lines_json) VALUES($1,$2,$3,$4::jsonb)',[intent.dispatchId,intent.id,amount.remainingMinor,JSON.stringify(amount.lines)]);
}};
const store=(dbinder:IdentityStore=binder)=>new FishingBillingStore(dbinder,workspace,ring,Buffer.alloc(32,9),authority,{now:()=>now},outbox);
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
 await db.exec('CREATE SCHEMA synthetic_billing;CREATE TABLE synthetic_billing.program_families(workspace_id uuid,family_id uuid,guardian_id uuid,revoked boolean DEFAULT false,PRIMARY KEY(workspace_id,family_id));CREATE TABLE synthetic_billing.existing_outbox(dispatch_id uuid PRIMARY KEY,intent_id uuid UNIQUE,remaining_minor integer,lines_json jsonb NOT NULL);');
 for(const w of [workspace,otherWorkspace])await db.query('INSERT INTO ls_identity.workspaces(id,created_at) VALUES($1,$2)',[w,now]);
 owner=await actor('practitioner');parent=await actor('parent');outsider=await actor('practitioner',otherWorkspace);
},20000);
afterAll(async()=>{await db.close();});
async function scenario(accept=true,distinctDue=false){
 const familyId=randomUUID(),children=[randomUUID(),randomUUID()],definition={...syntheticDefinition(),id:randomUUID()};
 await db.query('INSERT INTO ls_cases.families(id,workspace_id,label_ciphertext,created_at) VALUES($1,$2,$3,$4)',[familyId,workspace,'SYNTHETIC',now]);
 await db.query('INSERT INTO synthetic_billing.program_families(workspace_id,family_id,guardian_id) VALUES($1,$2,$3)',[workspace,familyId,parent.id]);
 for(const id of children){
  await db.query("INSERT INTO ls_identity.people(id,workspace_id,kind,profile_ciphertext,created_at) VALUES($1,$2,'minor','SYNTHETIC',$3)",[id,workspace,now]);
  await db.query("INSERT INTO ls_cases.family_members(workspace_id,family_id,person_id,role) VALUES($1,$2,$3,'child')",[workspace,familyId,id]);
 }
 const offer={version:definition.version,id:definition.id,programKey:definition.programKey,environment:definition.environment,
  currency:definition.currency,unitAmountMinor:definition.unitAmountMinor,effectiveAt:definition.effectiveAt,source:definition.source,terms:definition.terms,policies:definition.policies};
 await store().publishOffer(owner,{operationId:randomUUID(),offer});
 const cmd:CreateFamilyOffer={operationId:randomUUID(),id:randomUUID(),familyId,definitionId:definition.id,override:null,children:children.map((childId,index)=>({
  lineId:randomUUID(),childId,groupId:null,period:{id:randomUUID(),startsAt:'2035-01-01T05:00:00Z',endsAt:'2035-02-01T05:00:00Z',timeZone:'America/New_York'},dueAt:distinctDue&&index===1?'2035-02-05T22:00:00Z':'2035-01-05T22:00:00Z',
 }))};
 const created=await store().createOffer(owner,cmd),issued=await store().issueOffer(owner,{operationId:randomUUID(),expectedVersion:1,quoteId:cmd.id});
 const accepted=accept?await store().acceptOffer(parent,{operationId:randomUUID(),expectedVersion:2,quoteId:cmd.id,terms:issued.result.quote.definition.terms,acknowledged:true}):null;
 return {familyId,children,cmd,created,issued,quote:accepted?.result.quote??issued.result.quote};
}
function cash(q:FamilyOffer,amount=20000,lineIndex=0){return {operationId:randomUUID(),expectedVersion:q.revision,quoteId:q.id,amountMinor:amount,currency:'USD' as const,receivedAt:now.toISOString(),allocations:[{lineId:q.lines[lineIndex]!.id,amountMinor:amount}]};}
const policy:ReminderPolicy={id:'SYNTHETIC-APPROVED-REMINDER',revision:1,source:{id:'SYNTHETIC',sha256:'a'.repeat(64)},timeZone:'America/New_York',offsetsMinutes:[0,1440]};
async function queue(q:FamilyOffer){return store().queueReminders(owner,{quoteId:q.id,policy,guardianId:parent.id,channel:'email'});}

it('persists separate quote/acceptance and two-child obligations; unanswered creates no debt',async()=>{
 const f=await scenario(false);expect((await store().readBalance(owner,f.quote.id)).balance).toMatchObject({state:'no_debt',dueMinor:0});
 expect((await db.query('SELECT * FROM ls_fishing_billing.obligations WHERE quote_id=$1',[f.quote.id])).rows).toHaveLength(0);
 const accepted=await store().acceptOffer(parent,{operationId:randomUUID(),expectedVersion:2,quoteId:f.quote.id,terms:f.quote.definition.terms,acknowledged:true});
 expect(accepted.result.balance).toMatchObject({dueMinor:130000,remainingMinor:130000,state:'unpaid',revision:3});
 expect((await db.query('SELECT * FROM ls_fishing_billing.obligations WHERE quote_id=$1',[f.quote.id])).rows).toHaveLength(2);
});
it('replays identical create/cash once, conflicts changed payload, and reads original unknown operation receipt',async()=>{
 const f=await scenario(),cmd=cash(f.quote);
 expect((await store().createOffer(owner,f.cmd)).replayed).toBe(true);
 const first=await store().recordCash(owner,cmd),again=await store().recordCash(owner,cmd);
 expect(again).toEqual({...first,replayed:true});expect(first.result.balance).toMatchObject({paidMinor:20000,remainingMinor:110000,revision:4});
 await expect(store().recordCash(owner,{...cmd,amountMinor:20001})).rejects.toThrow('CONFLICT');
 expect(await store().readOperationReceipt(owner,cmd.operationId)).toEqual({...first,replayed:true});
 expect(await store().readOperationReceipt(owner,randomUUID())).toBeNull();
 expect((await db.query('SELECT id FROM ls_fishing_billing.receipts WHERE quote_id=$1',[f.quote.id])).rows).toHaveLength(1);
});
it('stale concurrent cash dialogs have one valid balance mutation and no lost funds',async()=>{
 const f=await scenario(),results=await Promise.allSettled([store().recordCash(owner,cash(f.quote)),store().recordCash(owner,cash(f.quote))]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.filter(r=>r.status==='rejected')).toHaveLength(1);
 expect((await store().readBalance(owner,f.quote.id)).balance).toMatchObject({paidMinor:20000,revision:4});
});
it('partial/full cash and correction keep original recorder/history and authoritative revision',async()=>{
 const f=await scenario(),first=await store().recordCash(owner,cash(f.quote)),r=first.result.balance.receipts[0]!;
 expect(r.actorId).toBe(owner.id);expect(r.provider).toBeNull();
 const correction={operationId:randomUUID(),expectedVersion:4,quoteId:f.quote.id,originalReceiptId:r.id,amountMinor:10000,allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:10000}],reason:'Synthetic amount correction'};
 const reversed=await store().reverseCash(owner,correction);expect(reversed.result.balance).toMatchObject({paidMinor:10000,remainingMinor:120000,revision:5});
 expect(reversed.result.balance.receipts.find(x=>x.id===r.id)).toEqual(r);
 expect((await store().reverseCash(owner,correction)).replayed).toBe(true);
 await expect(store().reverseCash(owner,{...correction,operationId:randomUUID(),expectedVersion:5,amountMinor:11000,allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:11000}]})).rejects.toThrow();
});
it('full two-child cash suppresses queued chasers; no invented Stripe receipt',async()=>{
 const f=await scenario();await queue(f.quote);
 const paid=await store().recordCash(owner,{...cash(f.quote,130000),allocations:f.quote.lines.map(l=>({lineId:l.id,amountMinor:65000}))});
 expect(paid.result.balance).toMatchObject({state:'paid',remainingMinor:0,revision:4});
 expect(paid.result.balance.reminders.every(i=>i.state==='suppressed')).toBe(true);
 expect(paid.result.balance.receipts[0]).toMatchObject({kind:'cash',provider:null});
});
it('rechecks actual native identity, family scope and revocation even on exact replay',async()=>{
 const f=await scenario(),cmd=cash(f.quote);await store().recordCash(owner,cmd);
 await expect(store().recordCash(parent,cmd)).rejects.toThrow('FORBIDDEN');
 await expect(store().readBalance(outsider,f.quote.id)).rejects.toThrow('FORBIDDEN');
 await db.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[owner.sessionDigest,now]);
 try{await expect(store().recordCash(owner,cmd)).rejects.toThrow('UNAUTHENTICATED');}finally{await db.query('UPDATE ls_identity.sessions SET revoked_at=NULL WHERE token_digest=$1',[owner.sessionDigest]);}
 await db.query('UPDATE synthetic_billing.program_families SET revoked=true WHERE family_id=$1',[f.familyId]);
 await expect(store().recordCash(owner,cmd)).rejects.toThrow('FORBIDDEN');
});
it('rejects a forged practitioner role and cross-family child IDs',async()=>{
 const f=await scenario(false);
 await expect(store().recordCash({...parent,role:'practitioner'},cash(f.quote))).rejects.toThrow('FORBIDDEN');
 const g=await scenario(false),cmd={...g.cmd,operationId:randomUUID(),id:randomUUID(),children:[{...g.cmd.children[0]!,childId:f.children[0]!}]};
 await expect(store().createOffer(owner,cmd)).rejects.toThrow('FORBIDDEN');
});
it('rolls back cash/aggregate/journal atomically if a durable command receipt fails',async()=>{
 const f=await scenario(),cmd=cash(f.quote);
 const broken:IdentityStore={transaction:work=>binder.transaction(tx=>work({query:(sql,v)=>{if(sql.startsWith('INSERT INTO ls_fishing_billing.commands'))throw new Error('SYNTHETIC_JOURNAL_FAILURE');return tx.query(sql,v);}}))};
 await expect(store(broken).recordCash(owner,cmd)).rejects.toThrow('SYNTHETIC_JOURNAL_FAILURE');
 expect((await store().readBalance(owner,f.quote.id)).balance).toMatchObject({paidMinor:0,revision:3});
 expect(await store().readOperationReceipt(owner,cmd.operationId)).toBeNull();
});
it('rejects valid-FK command metadata relinking instead of exposing an encrypted wrong-family receipt',async()=>{
 const f=await scenario(),g=await scenario(),cmd=cash(f.quote),receipt=await store().recordCash(owner,cmd);
 await db.query('UPDATE ls_fishing_billing.commands SET quote_id=$2 WHERE operation_id=$1',[cmd.operationId,g.quote.id]);
 await expect(store().readOperationReceipt(owner,cmd.operationId)).rejects.toThrow('UNAVAILABLE');
 await expect(store().recordCash(owner,cmd)).rejects.toThrow('UNAVAILABLE');
 await db.query('UPDATE ls_fishing_billing.commands SET quote_id=$2 WHERE operation_id=$1',[cmd.operationId,f.quote.id]);
 expect((await store().readOperationReceipt(owner,cmd.operationId))!.result.quote.id).toBe(receipt.result.quote.id);
 await db.query('UPDATE ls_fishing_billing.commands SET actor_id=$2 WHERE operation_id=$1',[cmd.operationId,parent.id]);
 await expect(store().readOperationReceipt(parent,cmd.operationId)).rejects.toThrow('UNAVAILABLE');
});
it('rejects a null quote relink and recovers a confirmed publication under the same operation',async()=>{
 const f=await scenario(),cmd=cash(f.quote);await store().recordCash(owner,cmd);
 await db.query('UPDATE ls_fishing_billing.commands SET quote_id=NULL WHERE operation_id=$1',[cmd.operationId]);
 await expect(store().readOperationReceipt(owner,cmd.operationId)).rejects.toThrow('UNAVAILABLE');
 const operationId=randomUUID(),d=syntheticDefinition(),offer={version:d.version,id:randomUUID(),programKey:d.programKey,environment:d.environment,currency:d.currency,unitAmountMinor:d.unitAmountMinor,effectiveAt:d.effectiveAt,source:d.source,terms:d.terms,policies:d.policies};
 const published=await store().publishOffer(owner,{operationId,offer});
 expect(await store().readPublicationReceipt(owner,operationId)).toEqual({operationId,definition:published.definition,replayed:true});
 await expect(store().readPublicationReceipt(parent,operationId)).rejects.toThrow('FORBIDDEN');
 expect(await store().readPublicationReceipt(owner,randomUUID())).toBeNull();
});
it('reads immutable original/correction history through bounded stable owner-only pages',async()=>{
 const f=await scenario(),first=await store().recordCash(owner,cash(f.quote));
 const second=await store().recordCash(owner,cash(first.result.quote,15000,1));
 await store().reverseCash(owner,{operationId:randomUUID(),expectedVersion:second.entityVersion,quoteId:f.quote.id,originalReceiptId:first.result.receiptId!,amountMinor:10000,allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:10000}],reason:'SYNTHETIC correction'});
 const items=[];let cursor:string|null=null;
 do{const page=await store().readLedgerHistory(owner,{quoteId:f.quote.id,cursor,limit:1});expect(page.asOfVersion).toBe(6);items.push(...page.items);cursor=page.nextCursor;}while(cursor);
 expect(items).toHaveLength(3);expect(new Set(items.map(i=>i.id)).size).toBe(3);
 expect(items.find(i=>i.kind==='cash_reversal')!.originalReceiptId).toBe(first.result.receiptId);
 expect(items.find(i=>i.id===first.result.receiptId)).toEqual(first.result.balance.receipts[0]);
 await expect(store().readLedgerHistory(parent,{quoteId:f.quote.id,cursor:null,limit:10})).rejects.toThrow('FORBIDDEN');
});
it('rejects altered, cross-quote and stale history cursors after refreshing session/authority',async()=>{
 const f=await scenario(),p=await store().recordCash(owner,cash(f.quote));await store().recordCash(owner,cash(p.result.quote,10000,1));
 const page=await store().readLedgerHistory(owner,{quoteId:f.quote.id,cursor:null,limit:1});expect(page.nextCursor).not.toBeNull();
 await expect(store().readLedgerHistory(owner,{quoteId:f.quote.id,cursor:page.nextCursor!.slice(0,-5)+'abcde',limit:1})).rejects.toThrow('INVALID_REQUEST');
 const other=await scenario();await expect(store().readLedgerHistory(owner,{quoteId:other.quote.id,cursor:page.nextCursor,limit:1})).rejects.toThrow('INVALID_REQUEST');
 const current=await store().readBalance(owner,f.quote.id);await store().setState(owner,{operationId:randomUUID(),expectedVersion:current.quote.revision,quoteId:f.quote.id,paused:true});
 await expect(store().readLedgerHistory(owner,{quoteId:f.quote.id,cursor:page.nextCursor,limit:1})).rejects.toThrow('CONFLICT');
});
it('records a real date-only cash amount once, preserves exact old receipts and returns authoritative V2 history/status',async()=>{
 const f=await scenario(),old=await store().recordCash(owner,cash(f.quote,10000,1)),cmd={version:BILLING_DTO_V2,operationId:randomUUID(),expectedVersion:4,quoteId:f.quote.id,amountMinor:20000,currency:'USD',allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:20000}],receivedPrecision:'date',receivedDate:'2035-01-05',timeZone:'America/New_York'};
 const result=await store().recordCashDate(owner,cmd);expect(result).toMatchObject({entityVersion:5,result:{balance:{paidMinor:30000,remainingMinor:100000}}});
 expect((await store().recordCashDate(owner,cmd)).replayed).toBe(true);expect((await store().readOperationReceiptV2(owner,cmd.operationId))!.result.receiptId).toBe(result.result.receiptId);
 const current=await store().readBalanceV2(owner,f.quote.id),date=current.balance.receipts.find(r=>r.id===result.result.receiptId)!;
 expect(date).toMatchObject({receivedPrecision:'date',receivedDate:'2035-01-05',timeZone:'America/New_York',recordedAt:now.toISOString(),actorId:owner.id});expect(date).not.toHaveProperty('receivedAt');
 expect(current.balance.receipts.find(r=>r.id===old.result.receiptId)).toEqual(old.result.balance.receipts[0]);
 const legacyReceipt=await store().readOperationReceiptV2(owner,old.operationId);expect(legacyReceipt!.sourceVersion).toBe('JLFA-FISHING-BILLING-DTO-v1');
 await expect(store().readBalance(owner,f.quote.id)).rejects.toThrow('UNAVAILABLE');
 await expect(store().recordCashDate(owner,{...cmd,amountMinor:20001})).rejects.toThrow('CONFLICT');
 const reversed=await store().reverseCashV2(owner,{version:BILLING_DTO_V2,operationId:randomUUID(),expectedVersion:5,quoteId:f.quote.id,originalReceiptId:date.id,amountMinor:5000,allocations:[{lineId:f.quote.lines[0]!.id,amountMinor:5000}],reason:'Synthetic date cash correction'});
 expect(reversed.result.balance).toMatchObject({paidMinor:25000,remainingMinor:105000,revision:6});
 const history=await store().readLedgerHistoryV2(owner,{quoteId:f.quote.id,cursor:null,limit:100});expect(history.items).toHaveLength(3);expect(history.items.find(r=>r.id===date.id)).not.toHaveProperty('receivedAt');
 await expect(store().readBalanceV2(parent,f.quote.id)).rejects.toThrow('FORBIDDEN');
});
it('full date-only cash suppresses payment chasers while a future NY date or revoked actor cannot write',async()=>{
 const f=await scenario();await queue(f.quote);
 const cmd={version:BILLING_DTO_V2,operationId:randomUUID(),expectedVersion:3,quoteId:f.quote.id,amountMinor:130000,currency:'USD',allocations:f.quote.lines.map(l=>({lineId:l.id,amountMinor:65000})),receivedPrecision:'date',receivedDate:'2035-01-06',timeZone:'America/New_York'};
 await expect(store().recordCashDate(owner,{...cmd,receivedDate:'2035-01-07'})).rejects.toThrow();
 const result=await store().recordCashDate(owner,cmd);expect(result.result.balance).toMatchObject({state:'paid',remainingMinor:0});expect(result.result.balance.reminders.every(i=>i.state==='suppressed')).toBe(true);
 await db.query('UPDATE ls_identity.sessions SET revoked_at=$2 WHERE token_digest=$1',[owner.sessionDigest,now]);
 try{await expect(store().recordCashDate(owner,cmd)).rejects.toThrow('UNAUTHENTICATED');}finally{await db.query('UPDATE ls_identity.sessions SET revoked_at=NULL WHERE token_digest=$1',[owner.sessionDigest]);}
});
it('encrypts quote, money, command and intent payloads with record-bound AAD',async()=>{
 const f=await scenario();await store().recordCash(owner,cash(f.quote));await queue(f.quote);
 const quote=(await db.query<{payload_ciphertext:string}>('SELECT payload_ciphertext FROM ls_fishing_billing.quotes WHERE id=$1',[f.quote.id])).rows[0]!.payload_ciphertext;
 expect(quote).not.toContain(f.familyId);expect(quote).not.toContain('65000');
 await db.query('UPDATE ls_fishing_billing.quotes SET payload_ciphertext=$2 WHERE id=$1',[f.quote.id,quote.replace('"v":1','"v":2')]);
 await expect(store().readBalance(owner,f.quote.id)).rejects.toThrow('UNAVAILABLE');
});
it('unique accepted obligations prevent duplicate family-child periods from a second quote',async()=>{
 const f=await scenario(),cmd={...f.cmd,operationId:randomUUID(),id:randomUUID(),children:f.cmd.children.map(l=>({...l,lineId:randomUUID()}))};
 await store().createOffer(owner,cmd);await store().issueOffer(owner,{operationId:randomUUID(),expectedVersion:1,quoteId:cmd.id});
 await expect(store().acceptOffer(parent,{operationId:randomUUID(),expectedVersion:2,quoteId:cmd.id,terms:f.quote.definition.terms,acknowledged:true})).rejects.toThrow();
 expect((await store().readBalance(owner,cmd.id)).balance.state).toBe('no_debt');
});
it('rescan deduplicates family/sibling intents by stable identity; competing reservations create one existing-outbox record',async()=>{
 const f=await scenario(),first=await queue(f.quote),second=await queue(f.quote);expect(second).toEqual(first);expect(first).toHaveLength(2);
 const target=first.find(i=>i.sequence===0)!;
 const results=await Promise.all([store().reserveReminder(owner,target.id,randomUUID()),store().reserveReminder(owner,target.id,randomUUID())]);
 expect(results.filter(r=>r.reserved)).toHaveLength(1);
 expect((await db.query('SELECT * FROM synthetic_billing.existing_outbox WHERE intent_id=$1',[target.id])).rows).toHaveLength(1);
});
it('payment immediately before reservation suppresses the chaser; partial dispatch reads new balance',async()=>{
 const f=await scenario(),plans=await queue(f.quote),i=plans.find(x=>x.sequence===0)!;
 await store().recordCash(owner,cash(f.quote));
 expect(await store().reserveReminder(owner,i.id,randomUUID())).toMatchObject({reserved:true,remainingMinor:110000});
 const g=await scenario(),j=(await queue(g.quote)).find(x=>x.sequence===0)!;
 await store().recordCash(owner,{...cash(g.quote,130000),allocations:g.quote.lines.map(l=>({lineId:l.id,amountMinor:65000}))});
 expect(await store().reserveReminder(owner,j.id,randomUUID())).toMatchObject({reserved:false});
 expect((await db.query('SELECT * FROM synthetic_billing.existing_outbox WHERE intent_id=$1',[j.id])).rows).toHaveLength(0);
});
it('binds only eligible sibling due-group lines and amount in the durable outbox reservation',async()=>{
 const f=await scenario(true,true),plans=await queue(f.quote),i=plans.find(x=>x.sequence===0&&x.dueAt==='2035-01-05T22:00:00.000Z')!;
 const result=await store().reserveReminder(owner,i.id,randomUUID());expect(result).toMatchObject({reserved:true,remainingMinor:65000});
 const row=(await db.query<{remaining_minor:number;lines_json:{lineId:string;remainingMinor:number}[]}>('SELECT remaining_minor,lines_json FROM synthetic_billing.existing_outbox WHERE intent_id=$1',[i.id])).rows[0]!;
 expect(row.remaining_minor).toBe(65000);expect(row.lines_json).toHaveLength(1);expect(row.lines_json[0]!.lineId).toBe(f.quote.lines[0]!.id);
 expect((await store().readBalance(owner,f.quote.id)).balance.remainingMinor).toBe(130000);
});
it('cancel/pause/consent and fail-closed windows suppress or defer without effects',async()=>{
 for(const condition of ['cancel','pause','consent','window']){
  const f=await scenario(),i=(await queue(f.quote)).find(x=>x.sequence===0)!;
  if(condition==='cancel'||condition==='pause')await store().setState(owner,{operationId:randomUUID(),expectedVersion:3,quoteId:f.quote.id,...(condition==='cancel'?{cancel:true}:{paused:true})});
  if(condition==='consent')consented=false;if(condition==='window')sendWindowOpen=false;
  try{expect(await store().reserveReminder(owner,i.id,randomUUID())).toMatchObject({reserved:false});}finally{consented=true;sendWindowOpen=true;}
  expect((await db.query('SELECT * FROM synthetic_billing.existing_outbox WHERE intent_id=$1',[i.id])).rows).toHaveLength(0);
 }
});
it('UNKNOWN survives worker restart, payment and channel fallback; late genuine receipt remains distinct',async()=>{
 const f=await scenario(),i=(await queue(f.quote)).find(x=>x.sequence===0)!,dispatchId=randomUUID();
 await store().reserveReminder(owner,i.id,dispatchId);
 expect(await store().reserveReminder(owner,i.id,randomUUID())).toEqual({reserved:false,reason:'already_reserved'});
 const crossChannel=await store().queueReminders(owner,{quoteId:f.quote.id,policy,guardianId:parent.id,channel:'whatsapp'});
 expect(crossChannel.some(x=>x.channel==='whatsapp')).toBe(false);
 await store().recordCash(owner,{...cash(f.quote,130000),allocations:f.quote.lines.map(l=>({lineId:l.id,amountMinor:65000}))});
 expect((await store().readBalance(owner,f.quote.id)).balance.reminders.find(x=>x.id===i.id)!.state).toBe('unknown');
 expect(await store().recordReminderOutcome(owner,{id:i.id,dispatchId,state:'provider_accepted',providerId:'SYNTHETIC_PROVIDER'})).toMatchObject({state:'provider_accepted'});
 expect(await store().recordReminderOutcome(owner,{id:i.id,dispatchId,state:'delivered',providerId:'SYNTHETIC_PROVIDER'})).toMatchObject({state:'delivered'});
 await expect(store().recordReminderOutcome(owner,{id:i.id,dispatchId,state:'failed',providerId:'SYNTHETIC_PROVIDER'})).rejects.toThrow('CONFLICT');
});
it('does not bypass an UNKNOWN send through an already queued later reminder sequence',async()=>{
 const f=await scenario(),plans=await queue(f.quote),first=plans.find(i=>i.sequence===0)!,later=plans.find(i=>i.sequence===1)!;
 await store().reserveReminder(owner,first.id,randomUUID());
 const resumed=new FishingBillingStore(binder,workspace,ring,Buffer.alloc(32,9),authority,{now:()=>new Date('2035-01-08T15:00:00Z')},outbox);
 expect(await resumed.reserveReminder(owner,later.id,randomUUID())).toEqual({reserved:false,reason:'unresolved_dispatch'});
 expect((await db.query('SELECT * FROM synthetic_billing.existing_outbox WHERE intent_id=$1',[later.id])).rows).toHaveLength(0);
});
it('outbox reservation failure rolls back UNKNOWN and leaves retryable unattempted intent',async()=>{
 const f=await scenario(),i=(await queue(f.quote)).find(x=>x.sequence===0)!;outboxFails=true;
 try{await expect(store().reserveReminder(owner,i.id,randomUUID())).rejects.toThrow('SYNTHETIC_EXISTING_OUTBOX_FAILURE');}finally{outboxFails=false;}
 expect((await store().readBalance(owner,f.quote.id)).balance.reminders.find(x=>x.id===i.id)!.state).toBe('queued');
 expect(await store().reserveReminder(owner,i.id,randomUUID())).toMatchObject({reserved:true});
});
it('missing policy/provider integration fails honestly without accepting or dispatching',async()=>{
 const f=await scenario(false);authorityRevoked=true;
 try{await expect(store().acceptOffer(parent,{operationId:randomUUID(),expectedVersion:2,quoteId:f.quote.id,terms:f.quote.definition.terms,acknowledged:true})).rejects.toThrow('FORBIDDEN');}finally{authorityRevoked=false;}
 const g=await scenario(),i=(await queue(g.quote)).find(x=>x.sequence===0)!;
 const noOutbox=new FishingBillingStore(binder,workspace,ring,Buffer.alloc(32,9),authority,{now:()=>now});
 await expect(noOutbox.reserveReminder(owner,i.id,randomUUID())).rejects.toThrow('UNAVAILABLE');
 expect((await store().readBalance(owner,g.quote.id)).balance.reminders.find(x=>x.id===i.id)!.state).toBe('queued');
});
// Adapter/inbox tests only. Actual SDK cryptographic proof is separately
// retained privately against the recovered PR189 verifier; no mock is labeled
// a Stripe sandbox event, financial settlement or production provider proof.
function signedTestEvent(eventId:string,body='SYNTHETIC_SIGNED_ADAPTER_BYTES'){
 const raw=Buffer.from(body),binding={accountId:'acct_SYNTHETIC',livemode:false as const,apiVersion:'2026-09-30.endive' as const,verifiedBindingId:'SYNTHETIC_POLICY'};
 return verifyBillingStripeTestEvent({rawBody:raw,signatureHeader:'SYNTHETIC',binding,now,sdk:{verify:()=>({kind:'stripe_test_signature_only',receipt:{eventId,eventType:'checkout.session.completed',objectId:'cs_SYNTHETIC',providerAccountId:binding.accountId,livemode:false,apiVersion:binding.apiVersion,digest:createHash('sha256').update(raw).digest('hex'),createdAt:now.toISOString()}})}});
}
const inbox=(dbinder=binder)=>new FishingBillingStripeInbox(dbinder,workspace,ring,{now:()=>now},{authorize:async(_tx,w,b)=>{if(w!==workspace||b.verifiedBindingId!=='SYNTHETIC_POLICY'||authorityRevoked)throw new AppError('FORBIDDEN');}});
it('durably ingests a minimal event once before acknowledging and retains unprocessed status',async()=>{
 const eventId='evt_'+randomUUID().replaceAll('-',''),cap=signedTestEvent(eventId);
 expect(await inbox().ingest(cap)).toEqual({received:true,replayed:false,processed:false,eventId});
 expect(await inbox().ingest(cap)).toEqual({received:true,replayed:true,processed:false,eventId});
 const rows=(await db.query<{state:string;receipt_ciphertext:string}>('SELECT state,receipt_ciphertext FROM ls_fishing_billing.stripe_events WHERE event_id=$1',[eventId])).rows;
 expect(rows).toHaveLength(1);expect(rows[0]!.state).toBe('pending');expect(rows[0]!.receipt_ciphertext).not.toContain(eventId);
 await expect(inbox().ingest(signedTestEvent(eventId,'DIFFERENT_AUTHENTICATED_ADAPTER_BYTES'))).rejects.toThrow('CONFLICT');
});
it('rejects a serialized/forged signature capability and rechecks current worker admission on replay',async()=>{
 await expect(inbox().ingest({} as VerifiedBillingStripeEvent)).rejects.toThrow('FORBIDDEN');
 const cap=signedTestEvent('evt_'+randomUUID().replaceAll('-',''));await inbox().ingest(cap);authorityRevoked=true;
 try{await expect(inbox().ingest(cap)).rejects.toThrow('FORBIDDEN');}finally{authorityRevoked=false;}
});
it('does not acknowledge Stripe intake when durable storage failed',async()=>{
 const eventId='evt_'+randomUUID().replaceAll('-',''),cap=signedTestEvent(eventId);
 const broken:IdentityStore={transaction:work=>binder.transaction(tx=>work({query:(sql,v)=>{if(sql.startsWith('INSERT INTO ls_fishing_billing.stripe_events'))throw new Error('SYNTHETIC_INBOX_FAILURE');return tx.query(sql,v);}}))};
 await expect(inbox(broken).ingest(cap)).rejects.toThrow('SYNTHETIC_INBOX_FAILURE');
 expect((await db.query('SELECT event_id FROM ls_fishing_billing.stripe_events WHERE event_id=$1',[eventId])).rows).toHaveLength(0);
});
it('rejects a plaintext digest rewrite that disagrees with the encrypted stored Stripe receipt',async()=>{
 const eventId='evt_'+randomUUID().replaceAll('-','');await inbox().ingest(signedTestEvent(eventId,'ORIGINAL_AUTHENTICATED_BYTES'));
 const changedBody='CHANGED_AUTHENTICATED_BYTES',changedDigest=createHash('sha256').update(changedBody).digest('hex');
 await db.query('UPDATE ls_fishing_billing.stripe_events SET body_digest=$2 WHERE event_id=$1',[eventId,changedDigest]);
 await expect(inbox().ingest(signedTestEvent(eventId,changedBody))).rejects.toThrow('CONFLICT');
});
