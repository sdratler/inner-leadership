import 'server-only';
import {createHmac,randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {canonical} from '../contact-ops/core/validation.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {lockWorkspace} from '../identity/data.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import type {WorkspaceId,IdentityClock} from '../identity/types.ts';
import type {BillingLedgerContext} from './native.ts';
import {billingId,reminderIntentSchema,type ReminderIntent} from './contracts.ts';
import {BILLING_SERVICE_V4} from './guest-service-contract-v4.ts';
import {readServiceAcceptanceDataV4} from './guest-service-acceptance-data-v4.ts';
import {readServiceCurrentFamilyDataV4,readServiceFinancialSnapshotV4} from './guest-service-financial-data-v4.ts';
import {serviceOwnerSnapshotV4Schema,type ServiceOwnerSnapshotV4} from './guest-service-owner-financial-contract-v4.ts';
import {FishingBillingInquiryFamilyProposals} from '../../lib/fishing-billing-inquiry-family-proposal.ts';
import {planPaymentReminders,checkReminderDispatch,reminderSuppression} from './reminders.ts';
import {reminderServiceBindingSchema,reminderBatchCommandSchema,reminderOutcomeLookupSchema,verifiedReminderOutcomeSchema,serviceDispatchPermissionSchema,
 type ReminderServiceBinding,type ReminderServiceAudience,type BillingReminderServiceOutbox} from './reminder-service.ts';
import {serviceCashReminderPlanningV4Schema,serviceCashReminderPlanV4Schema,serviceCashReminderKeyV4,validateServiceCashReminderV4,
 type ServiceCashReminderAuthorityV4,type ServiceCashReminderPolicyV4,type ServiceCashReminderReservationV4,type ServiceCashReminderScopeV4} from './guest-service-cash-reminder-contract-v4.ts';

type Context=Readonly<BillingLedgerContext>;
type Row={id:string;quoteId:string;state:string;intentKey:string;audienceKey:string;scheduledAt:Date;exactTime:boolean;ciphertext:string;policyCiphertext:string};
type Entry={row:Row;intent:ReminderIntent;policy:ServiceCashReminderPolicyV4};
const columns='id,quote_id AS "quoteId",state,intent_key AS "intentKey",audience_key AS "audienceKey",scheduled_at AS "scheduledAt",scheduled_at=date_trunc(\'milliseconds\',scheduled_at) AS "exactTime",payload_ciphertext AS ciphertext,policy_ciphertext AS "policyCiphertext"';
const aad=(kind:'reminder'|'reminder_policy',workspace:string,id:string)=>'ls_fishing_billing/v1/'+kind+'/'+workspace+'/'+id;
function requireFact(v:unknown,code:'UNAVAILABLE'|'CONFLICT'|'NOT_FOUND'='UNAVAILABLE'):asserts v{if(!v)throw new AppError(code);}
function freeze<T>(v:T):T{if(v&&typeof v==='object'){for(const x of Object.values(v))freeze(x);Object.freeze(v);}return v;}
const financialKey=(s:ServiceOwnerSnapshotV4)=>canonical({...s,balance:{...s.balance,reminders:[]}});
/** V4 CASH-DUE bridge only, in the SAME existing reminders/outbox. No Actor,
 * V3 quote/account cast, second ledger/outbox, timer, transport or provider.
 * Failed-charge timestamp evidence and hold/pre-renewal lifecycle stay separate.
 * Every new reservation needs ONE actual joint terminal permission decision.
 * Reserve means durable UNKNOWN + same-TX queued outbox, never a sent message. */
export class FishingServiceCashRemindersV4{
 private readonly commandKey:Buffer;private readonly ledgerKey:Buffer;private readonly now:()=>Date;
 private readonly binding:Readonly<ReminderServiceBinding>;private readonly authority:ServiceCashReminderAuthorityV4;private readonly outbox:BillingReminderServiceOutbox;
 constructor(private readonly db:IdentityStore,private readonly workspaceId:WorkspaceId,private readonly families:FishingBillingInquiryFamilyProposals,
  private readonly ring:Keyring,private readonly sourceKey:string,commandKey:Buffer,ledgerKey:Buffer,clock:IdentityClock,binding:ReminderServiceBinding,authority:ServiceCashReminderAuthorityV4,outbox:BillingReminderServiceOutbox){
  requireFact(billingId.safeParse(workspaceId).success&&sourceKey.length>=32&&commandKey.length>=32&&ledgerKey.length>=32&&typeof authority?.terminalReservationPermissions==='function'&&typeof outbox?.reserveService==='function'&&typeof outbox?.readServiceOutcome==='function');
  this.commandKey=Buffer.from(commandKey);this.ledgerKey=Buffer.from(ledgerKey);this.now=clock.now.bind(clock);this.binding=Object.freeze(reminderServiceBindingSchema.parse(binding));
  this.authority=Object.freeze({authorize:authority.authorize.bind(authority),plan:authority.plan.bind(authority),permission:authority.permission.bind(authority),terminalReservationPermissions:authority.terminalReservationPermissions.bind(authority)});
  this.outbox=Object.freeze({reserveService:outbox.reserveService.bind(outbox),readServiceOutcome:outbox.readServiceOutcome.bind(outbox)});
 }
 private currentNow(){const n=this.now();requireFact(n instanceof Date&&Number.isFinite(n.valueOf()));return new Date(n);}
 private hmac(v:unknown){return createHmac('sha256',this.ledgerKey).update(canonical(v)).digest('hex');}
 private async port<T>(c:Context,work:(view:Context)=>Promise<T>){const now=this.currentNow(),at=now.valueOf(),view=Object.freeze({...c,now});const result=await work(view);requireFact(now.valueOf()===at);return result;}
 private scope(s:ServiceOwnerSnapshotV4):ServiceCashReminderScopeV4{const q=s.quote;return Object.freeze({programKey:'fishing_monthly_club',quoteId:q.id,familyId:q.familyId,childIds:Object.freeze(q.lines.map(l=>l.childId)),offerSha256:q.offer.sha256});}
 private authorize(c:Context,op:'scan'|'plan'|'reserve'|'outcome',s:ServiceOwnerSnapshotV4|null=null,a:ReminderServiceAudience|null=null){return this.port(c,v=>this.authority.authorize(v,this.binding,op,s?this.scope(s):null,a?Object.freeze({...a}):null));}
 private async ledger(c:Context,id:string){
  const view=Object.freeze({...c,now:this.currentNow()}),data=await readServiceAcceptanceDataV4(view,this.workspaceId,id,this.ring,this.sourceKey,this.commandKey);
  await readServiceCurrentFamilyDataV4(view,this.workspaceId,data.quote,this.ring,this.sourceKey,this.families);
  return readServiceFinancialSnapshotV4(view,this.workspaceId,data.quote,this.ring,this.ledgerKey);
 }
 private async stable(c:Context,s:ServiceOwnerSnapshotV4,op:'plan'|'reserve'|'outcome',a:ReminderServiceAudience|null=null){
  await this.authorize(c,op,s,a);const live=await this.ledger(c,s.quote.id);await this.authorize(c,op,live,a);requireFact(financialKey(live)===financialKey(s),'CONFLICT');return live;
 }
 private permission(c:Context,s:ServiceOwnerSnapshotV4,p:ServiceCashReminderPolicyV4,a:ReminderServiceAudience){return this.port(c,async v=>serviceDispatchPermissionSchema.parse(await this.authority.permission(v,this.binding,serviceOwnerSnapshotV4Schema.parse(s),structuredClone(p),Object.freeze({...a}))));}
 private async entries(c:Context,qid:string){
  const rows=await c.tx.query<Row>('SELECT '+columns+' FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND quote_id=$2 ORDER BY id LIMIT 1001 FOR UPDATE',[this.workspaceId,qid]);requireFact(rows.length<=1000);
  return rows.map(row=>{
   const e=validateServiceCashReminderV4(JSON.parse(unseal(row.ciphertext,aad('reminder',this.workspaceId,row.id),this.ring)),JSON.parse(unseal(row.policyCiphertext,aad('reminder_policy',this.workspaceId,row.id),this.ring))),i=e.intent;
   requireFact(row.exactTime===true&&i.id===row.id&&i.quoteId===qid&&row.quoteId===qid&&i.state===row.state&&this.hmac({key:i.key})===row.intentKey&&this.hmac({quoteId:qid,guardianId:i.guardianId})===row.audienceKey&&Date.parse(i.scheduledAt)===row.scheduledAt.valueOf());return {row,...e};
  });
 }
 private async save(c:Context,e:Entry,next:ReminderIntent){
  const i=e.intent,r=e.row;requireFact(next.id===i.id&&next.key===i.key&&next.quoteId===i.quoteId&&next.guardianId===i.guardianId);
  const changed=await one(c.tx,'UPDATE ls_fishing_billing.reminders SET state=$3,payload_ciphertext=$4 WHERE workspace_id=$1 AND id=$2 AND quote_id=$5 AND state=$6 AND payload_ciphertext=$7 AND policy_ciphertext=$8 AND intent_key=$9 AND audience_key=$10 AND scheduled_at=$11 RETURNING id',
   [this.workspaceId,i.id,next.state,seal(JSON.stringify(next),aad('reminder',this.workspaceId,i.id),this.ring),i.quoteId,r.state,r.ciphertext,r.policyCiphertext,r.intentKey,r.audienceKey,r.scheduledAt]);requireFact(changed,'CONFLICT');
 }
 private async transaction<T>(op:'scan'|'plan'|'outcome',work:(c:Context,reservations:ServiceCashReminderReservationV4[],checks:(()=>Promise<unknown>)[])=>Promise<T>){
  try{return await this.db.transaction(async physical=>{
   const original=physical.query,query=original.bind(physical),time=this.currentNow(),at=time.valueOf();let open=true;
   const guard=()=>requireFact(open&&physical.query===original&&c.tx===tx&&c.workspaceId===this.workspaceId&&c.now===time&&time.valueOf()===at);
   const tx:SqlSession=Object.freeze({query:async<R extends object>(sql:string,v:readonly unknown[]=[])=>{guard();const rows=await query<R>(sql,v);guard();return rows;}}),c=Object.freeze({workspaceId:this.workspaceId,now:time,tx});
   try{
    guard();await this.authorize(c,op);await lockWorkspace(tx,this.workspaceId);const reservations:ServiceCashReminderReservationV4[]=[];
    const checks:(()=>Promise<unknown>)[]=[];const result=await work(c,reservations,checks);await this.authorize(c,op);for(const check of checks)await check();
    const actual:ServiceCashReminderReservationV4[]=[];
    for(const r of reservations){
     const a=r.intent,live=await this.stable(c,r.snapshot,'reserve',a),permission=await this.permission(c,live,r.policy,a),entries=await this.entries(c,a.quoteId),stored=entries.find(e=>e.intent.id===a.id);
     requireFact(stored&&canonical(stored.intent)===canonical({...a,state:'unknown',dispatchId:r.dispatchId,reason:'dispatch_reserved'})&&!entries.some(e=>e.intent.id!==a.id&&e.intent.state==='unknown'),'CONFLICT');
     requireFact(live.balance.pendingAttemptIds.length===0&&checkReminderDispatch(a,live.balance,permission,this.currentNow().toISOString()).eligible,'CONFLICT');actual.push(freeze(structuredClone({...r,snapshot:live})));
    }
    if(actual.length){
     requireFact(actual.length<=50);const permissions=await this.port(c,v=>this.authority.terminalReservationPermissions(v,this.binding,Object.freeze(actual)));
     // Synchronous validation/return ONLY after the ONE joint actual decision.
     guard();const parsed=z.array(serviceDispatchPermissionSchema).min(1).max(50).parse(permissions);requireFact(parsed.length===actual.length);
     for(let n=0;n<actual.length;n++){const r=actual[n]!;requireFact(r.snapshot.quote.state==='accepted'&&r.snapshot.quote.acceptance&&r.snapshot.balance.pendingAttemptIds.length===0&&checkReminderDispatch(r.intent,r.snapshot.balance,parsed[n]!,this.currentNow().toISOString()).eligible,'CONFLICT');}
    }
    guard();return result;
   }finally{open=false;}
  });}catch{throw new AppError('UNAVAILABLE');}
 }
 async plan(raw:unknown){
  const {quoteId}=serviceCashReminderPlanningV4Schema.parse(raw);
  return this.transaction('plan',async(c,_reservations,checks)=>{
   const s=await this.ledger(c,quoteId);await this.authorize(c,'plan',s);checks.push(()=>this.stable(c,s,'plan'));const previous=await this.entries(c,quoteId),base={version:BILLING_SERVICE_V4,quoteId};
   if(!s.quote.acceptance)return {...base,state:'suppressed' as const,reason:'no_obligation',intents:previous.map(e=>e.intent)};
   const selected=await this.port(c,v=>this.authority.plan(v,this.binding,serviceOwnerSnapshotV4Schema.parse(s)));requireFact(selected);const plan=serviceCashReminderPlanV4Schema.parse(selected);await this.stable(c,s,'plan');
   const planned:ReminderIntent[]=[];
   for(const channel of plan.channels){
    const audience={quoteId,familyId:s.quote.familyId,guardianId:plan.guardianId,channel};await this.authorize(c,'plan',s,audience);
    const allowed=await this.permission(c,s,plan.policy,audience);requireFact(allowed.audience.guardianId===audience.guardianId&&allowed.audience.channel===channel&&allowed.policyCurrent);await this.stable(c,s,'plan',audience);
    if(previous.some(e=>e.intent.state==='unknown')||s.balance.pendingAttemptIds.length)return {...base,state:'blocked_unknown' as const,reason:'unresolved_payment_or_dispatch',intents:previous.map(e=>e.intent)};
    const reason=reminderSuppression(s.balance,allowed);if(reason)return {...base,state:reason==='send_window_closed'?'deferred' as const:'suppressed' as const,reason,intents:previous.map(e=>e.intent)};
    for(const i of planPaymentReminders({balance:s.balance,policy:plan.policy.policy,audience:allowed.audience,newId:randomUUID}))planned.push({...i,key:serviceCashReminderKeyV4(i)});
    const after=await this.permission(c,s,plan.policy,audience);requireFact(canonical(after)===canonical(allowed),'CONFLICT');
   }
   // A changed policy must not reset the bounded chase. Old/suppressed/failed
   // intents still consume their original slot; no silent extra customer chase.
   for(const i of planned){const matches=(v:ReminderIntent)=>v.channel===i.channel&&Date.parse(v.dueAt)===Date.parse(i.dueAt),keys=new Set([...previous.filter(e=>matches(e.intent)).map(e=>e.intent.key),...planned.filter(matches).map(v=>v.key)]);if(keys.size>2)return {...base,state:'owner_attention' as const,reason:'reminder_budget_exhausted',intents:previous.map(e=>e.intent)};}
   requireFact(new Set([...previous.map(e=>e.intent.key),...planned.map(i=>i.key)]).size<=1000);
   for(const i of planned)await c.tx.query('INSERT INTO ls_fishing_billing.reminders(workspace_id,id,quote_id,intent_key,state,payload_ciphertext,policy_ciphertext,scheduled_at,audience_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(workspace_id,intent_key) DO NOTHING',
    [this.workspaceId,i.id,quoteId,this.hmac({key:i.key}),'queued',seal(JSON.stringify(i),aad('reminder',this.workspaceId,i.id),this.ring),seal(JSON.stringify(plan.policy),aad('reminder_policy',this.workspaceId,i.id),this.ring),i.scheduledAt,this.hmac({quoteId,guardianId:i.guardianId})]);
   const after=await this.port(c,v=>this.authority.plan(v,this.binding,serviceOwnerSnapshotV4Schema.parse(s)));requireFact(after&&canonical(serviceCashReminderPlanV4Schema.parse(after))===canonical(plan),'CONFLICT');await this.stable(c,s,'plan');
   return {...base,state:'queued' as const,reason:null,intents:(await this.entries(c,quoteId)).map(e=>e.intent)};
  });
 }
 async reserveBatch(raw:unknown){
  const {limit}=reminderBatchCommandSchema.parse(raw);
  return this.transaction('scan',async(c,reservations,checks)=>{
   const rows=await c.tx.query<{id:string;quoteId:string}>('SELECT due.id,due.quote_id AS "quoteId" FROM ls_fishing_billing.reminders due JOIN ls_fishing_billing.quotes q ON q.workspace_id=due.workspace_id AND q.id=due.quote_id WHERE due.workspace_id=$1 AND q.material_version=$2 AND due.state=\'queued\' AND due.scheduled_at<=$3 AND NOT EXISTS(SELECT 1 FROM ls_fishing_billing.reminders u WHERE u.workspace_id=due.workspace_id AND u.quote_id=due.quote_id AND u.state=\'unknown\') ORDER BY due.scheduled_at,due.id LIMIT $4 FOR UPDATE OF due SKIP LOCKED',[this.workspaceId,BILLING_SERVICE_V4,this.currentNow(),limit+1]);
   const results:({intentId:string;state:'reserved';dispatchId:string;remainingMinor:number}|{intentId:string;state:'blocked_unknown'|'deferred'|'suppressed';reason:string})[]=[];
   for(const row of rows.slice(0,limit)){
    const s=await this.ledger(c,row.quoteId),entries=await this.entries(c,row.quoteId),e=entries.find(e=>e.intent.id===row.id);requireFact(e);const i=e.intent;await this.authorize(c,'reserve',s,i);checks.push(()=>this.stable(c,s,'reserve',i));
    requireFact(i.familyId===s.quote.familyId);if(s.balance.pendingAttemptIds.length||entries.some(e=>e.intent.state==='unknown')){results.push({intentId:i.id,state:'blocked_unknown',reason:'unresolved_payment_or_dispatch'});continue;}
    const permission=await this.permission(c,s,e.policy,i);await this.stable(c,s,'reserve',i);const eligible=checkReminderDispatch(i,s.balance,permission,this.currentNow().toISOString());
    if(!eligible.eligible){const deferred=['not_due','already_reserved','send_window_closed'].includes(eligible.reason);if(!deferred&&i.state==='queued')await this.save(c,e,reminderIntentSchema.parse({...i,state:'suppressed',reason:eligible.reason}));results.push({intentId:i.id,state:deferred?'deferred':'suppressed',reason:eligible.reason});continue;}
    const dispatchId=randomUUID(),reserved=reminderIntentSchema.parse({...i,state:'unknown',dispatchId,reason:'dispatch_reserved'});await this.save(c,e,reserved);
    const amount={currency:'USD' as const,quoteId:i.quoteId,familyId:i.familyId,revision:s.balance.revision,remainingMinor:eligible.remainingMinor,lines:eligible.lines};
    await this.port(c,v=>this.outbox.reserveService(v,this.binding,{intent:reserved,amount}));
    reservations.push({snapshot:s,intent:i,policy:e.policy,dispatchId});results.push({intentId:i.id,state:'reserved',dispatchId,remainingMinor:eligible.remainingMinor});
   }
   return {version:BILLING_SERVICE_V4,scanned:results.length,moreDue:rows.length>limit,results};
  });
 }
 async recoverOutcome(raw:unknown){
  const lookup=reminderOutcomeLookupSchema.parse(raw);
  return this.transaction('outcome',async(c,_reservations,checks)=>{
   const row=await one<{quoteId:string}>(c.tx,'SELECT quote_id AS "quoteId" FROM ls_fishing_billing.reminders WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[this.workspaceId,lookup.intentId]);requireFact(row,'NOT_FOUND');
   const s=await this.ledger(c,row.quoteId),entry=(await this.entries(c,row.quoteId)).find(e=>e.intent.id===lookup.intentId);requireFact(entry);const i=entry.intent;requireFact(i.familyId===s.quote.familyId&&i.dispatchId===lookup.dispatchId,'CONFLICT');await this.authorize(c,'outcome',s,i);checks.push(()=>this.stable(c,s,'outcome',i));
   const raw=await this.port(c,v=>this.outbox.readServiceOutcome(v,this.binding,lookup));await this.stable(c,s,'outcome',i);
   if(raw===null)return {version:BILLING_SERVICE_V4,state:'unresolved' as const,intentId:i.id};const outcome=verifiedReminderOutcomeSchema.parse(raw);
   requireFact(outcome.intentId===i.id&&outcome.dispatchId===i.dispatchId&&outcome.guardianId===i.guardianId&&outcome.channel===i.channel&&outcome.outboxBindingId===this.binding.outboxBindingId);
   requireFact(['unknown','provider_accepted','delivered','failed'].includes(i.state)&&!(i.state==='provider_accepted'&&outcome.state==='failed')&&(!i.providerId||i.providerId===outcome.providerId)&&(i.state!=='delivered'||outcome.state==='delivered'&&i.providerId===outcome.providerId),'CONFLICT');
   const next=reminderIntentSchema.parse({...i,state:outcome.state,providerId:outcome.providerId,reason:null});if(canonical(next)!==canonical(i))await this.save(c,entry,next);
   await this.stable(c,s,'outcome',i);const saved=(await this.entries(c,row.quoteId)).find(e=>e.intent.id===i.id);requireFact(saved&&canonical(saved.intent)===canonical(next),'CONFLICT');
   return {version:BILLING_SERVICE_V4,state:'recorded' as const,intent:next,sourceReceiptId:outcome.sourceReceiptId};
  });
 }
}
