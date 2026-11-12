import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AppError} from './errors.ts';
import {seal,unseal,type Keyring} from '../features/identity/crypto.ts';
import {one} from '../features/identity/store.ts';
import type {AccountFacts,WorkspaceId} from '../features/identity/types.ts';
import {billingId,reminderIntentSchema,balanceLineSchema,sourceReferenceSchema} from '../features/fishing-billing/contracts.ts';
import type {BillingLedgerContext,BillingOutboxReservation} from '../features/fishing-billing/native.ts';
import {reminderServiceBindingSchema,reminderOutcomeLookupSchema,verifiedReminderOutcomeSchema,
 type ReminderServiceBinding,type ReminderOutboxPayload,type VerifiedReminderOutcome} from '../features/fishing-billing/reminder-service.ts';

export const BILLING_REMINDER_OUTBOX_PURPOSE='academy_monthly_payment_reminder_v1';
const version='JLFA-MONTHLY-REMINDER-MAIL-v1';
const mailSchema=z.object({
 reference:billingId,quoteId:billingId,familyId:billingId,guardianId:billingId,locale:z.enum(['en','he']),
 from:z.email().max(254),to:z.email().max(254),template:sourceReferenceSchema,
 subject:z.string().min(1).max(300).refine(s=>!/[\r\n]/.test(s)),text:z.string().min(1).max(32000),html:z.string().min(1).max(64000),
}).strict();
export type BillingReminderApprovedMail=z.infer<typeof mailSchema>;
type Principal={kind:'owner';actor:AccountFacts}|{kind:'service';binding:ReminderServiceBinding};
export interface BillingReminderOutboxAuthority{
 /** Resolve the actual existing inquiry/native-family/guardian relationship,
  * current payment/consent/window/service authority and exact approved template
  * in context.tx. No input email, display name, old founder allocation or
  * owner session impersonation establishes this mapping. Missing mapping denies. */
 reservation(context:BillingLedgerContext,principal:Principal,payload:ReminderOutboxPayload):Promise<BillingReminderApprovedMail>;
 /** Current target/service/schema admission before reading any outbox row. */
 service(context:BillingLedgerContext,binding:ReminderServiceBinding):Promise<void>;
 /** Reauthorize the actual stored family/guardian/binding, permitting genuine
  * late facts after payment/pause/revocation without authorizing another send. */
 outcome(context:BillingLedgerContext,binding:ReminderServiceBinding,mail:BillingReminderApprovedMail):Promise<void>;
}
const payloadSchema=z.object({intent:reminderIntentSchema,amount:z.object({
 currency:z.literal('USD'),quoteId:billingId,familyId:billingId,revision:z.number().int().positive(),remainingMinor:z.number().int().positive(),lines:z.array(balanceLineSchema).min(1).max(10),
}).strict()}).strict();
const storedSchema=z.object({version:z.literal(version),workspaceId:billingId,outboxBindingId:z.string().min(1).max(160),createdAt:z.iso.datetime(),
 dispatchId:billingId,intentId:billingId,payload:payloadSchema,mail:mailSchema,
}).strict();
/** Shape for the separately admitted worker's actual send receipt. Schema/data
 * alone is not send authority. It must be sealed only from the original actual
 * transport result, never a caller-supplied provider ID or a queued projection. */
export const monthlyReminderProviderReceiptSchema=z.object({version:z.literal('JLFA-MONTHLY-REMINDER-SEND-v1'),
 workspaceId:billingId,outboxBindingId:z.string().min(1).max(160),intentId:billingId,dispatchId:billingId,
 payloadSha256:z.string().regex(/^[a-f0-9]{64}$/),providerId:z.string().regex(/^[A-Za-z0-9_-]{1,256}$/),
 reservedAt:z.iso.datetime(),acceptedAt:z.iso.datetime(),
}).strict();
type Row={id:string;reference:string;ciphertext:string;state:'queued'|'unknown'|'sent'|'canceled';createdAt:Date;reservedAt:Date|null;completedAt:Date|null;providerId:string|null;messageKey:string;founderId:string|null;providerReceiptCiphertext:string|null};
const select='SELECT id,application_id AS reference,payload_ciphertext AS ciphertext,state,created_at AS "createdAt",reserved_at AS "reservedAt",completed_at AS "completedAt",provider_id AS "providerId",message_key AS "messageKey",founder_id AS "founderId",monthly_receipt_ciphertext AS "providerReceiptCiphertext" FROM ls_service_interest.inquiry_email_outbox';
const aad=(workspace:string,id:string)=>'ls_service_interest/monthly_payment_reminder/v1/'+workspace+'/'+id;
const unavailable=()=>new AppError('UNAVAILABLE');
const canonical=(v:unknown):string=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(canonical).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical((v as Record<string,unknown>)[k])).join(',')+'}';

/** One adapter for the EXISTING inquiry_email_outbox. No default authority,
 * database/transaction, runtime, sender, recipient, template or transport.
 * Native reservation and this insertion share the supplied transaction. The
 * additive purpose/schema must be independently admitted before composition.
 * New rows start queued; an admitted worker must reserve UNKNOWN durably before
 * transport and recheck current eligibility immediately before actual send.
 * This module never scans/dispatches/requeues historical or new messages. */
export function createFishingBillingReminderOutbox(deps:{workspaceId:WorkspaceId;outboxBindingId:string;keyring:Keyring;authority:BillingReminderOutboxAuthority}):Required<BillingOutboxReservation>{
 const workspace=billingId.parse(deps.workspaceId),bindingId=z.string().min(1).max(160).parse(deps.outboxBindingId),ring=deps.keyring;
 const authority={reservation:deps.authority.reservation.bind(deps.authority),service:deps.authority.service.bind(deps.authority),outcome:deps.authority.outcome.bind(deps.authority)};
 function context(c:BillingLedgerContext){if(c.workspaceId!==workspace||!(c.now instanceof Date)||!Number.isFinite(c.now.valueOf()))throw unavailable();}
 function binding(raw:ReminderServiceBinding){const b=reminderServiceBindingSchema.parse(raw);if(b.outboxBindingId!==bindingId)throw unavailable();return b;}
 function decode(row:Row){
  try{
   const value=storedSchema.parse(JSON.parse(unseal(row.ciphertext,aad(workspace,row.id),ring)));
   if(value.workspaceId!==workspace||value.dispatchId!==row.id||value.intentId!==value.payload.intent.id||value.payload.intent.dispatchId!==row.id||value.mail.reference!==row.reference||value.outboxBindingId!==bindingId||row.founderId!==null||row.messageKey!=='monthly:'+row.id||!row.createdAt||!Number.isFinite(row.createdAt.valueOf())||row.createdAt.toISOString()!==value.createdAt)throw unavailable();
   return value;
  }catch{throw unavailable();}
 }
 async function reserve(c:BillingLedgerContext,principal:Principal,raw:ReminderOutboxPayload){
  try{
   context(c);const payload=payloadSchema.parse(raw),i=payload.intent,a=payload.amount;
   if(i.channel!=='email'||i.state!=='unknown'||!i.dispatchId||i.providerId!==null||i.quoteId!==a.quoteId||i.familyId!==a.familyId||a.lines.some(l=>l.remainingMinor<=0||l.dueAt===null||Date.parse(l.dueAt)!==Date.parse(i.dueAt))||new Set(a.lines.map(l=>l.lineId)).size!==a.lines.length||a.lines.reduce((n,l)=>n+l.remainingMinor,0)!==a.remainingMinor)throw unavailable();
   const mail=mailSchema.parse(await authority.reservation(c,principal,payload));
   if(mail.quoteId!==i.quoteId||mail.familyId!==i.familyId||mail.guardianId!==i.guardianId||mail.locale!==i.locale)throw unavailable();
   const value=storedSchema.parse({version,workspaceId:workspace,outboxBindingId:bindingId,createdAt:c.now.toISOString(),dispatchId:i.dispatchId,intentId:i.id,payload,mail});
   const inserted=await c.tx.query('INSERT INTO ls_service_interest.inquiry_email_outbox(workspace_id,id,application_id,purpose,payload_ciphertext,state,created_at,message_key) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(workspace_id,id) DO NOTHING RETURNING id',
    [workspace,i.dispatchId,mail.reference,BILLING_REMINDER_OUTBOX_PURPOSE,seal(JSON.stringify(value),aad(workspace,i.dispatchId),ring),'queued',c.now,'monthly:'+i.dispatchId]);
   if(inserted.length===1)return;
   const old=await one<Row>(c.tx,select+' WHERE workspace_id=$1 AND id=$2 AND purpose=$3 FOR UPDATE',[workspace,i.dispatchId,BILLING_REMINDER_OUTBOX_PURPOSE]);
   if(!old)throw unavailable();const original=decode(old);
   if(old.createdAt>c.now||canonical(original)!==canonical({...value,createdAt:original.createdAt}))throw unavailable();
   // Matching reservation is a read-only replay, including UNKNOWN/SENT rows.
   // Never reset state, reserved time, provider receipt or original ciphertext.
  }catch{throw unavailable();}
 }
 return {
  reserve:async(c,payload)=>{
   if(c.actor.workspaceId!==workspace||c.actor.state!=='active'||c.actor.role!=='practitioner')throw unavailable();
   await reserve(c,{kind:'owner',actor:c.actor},payload);
  },
  reserveService:async(c,rawBinding,payload)=>{
   const b=binding(rawBinding);context(c);await authority.service(c,b);await reserve(c,{kind:'service',binding:b},payload);
  },
  readServiceOutcome:async(c,rawBinding,rawLookup):Promise<VerifiedReminderOutcome|null>=>{
   try{
    const b=binding(rawBinding),lookup=reminderOutcomeLookupSchema.parse(rawLookup);context(c);await authority.service(c,b);
    const row=await one<Row>(c.tx,select+' WHERE workspace_id=$1 AND id=$2 AND purpose=$3 FOR SHARE',[workspace,lookup.dispatchId,BILLING_REMINDER_OUTBOX_PURPOSE]);
    if(!row)return null;const value=decode(row);
    if(value.intentId!==lookup.intentId||value.dispatchId!==lookup.dispatchId)throw unavailable();
    await authority.outcome(c,b,value.mail);
    // Existing sent means provider acceptance, NOT inbox receipt/delivery.
    // Canceled/unknown/queued does not establish an actual failed send either.
    if(row.state!=='sent')return null;
    if(!row.reservedAt||!row.completedAt||!row.providerId||!Number.isFinite(row.reservedAt.valueOf())||!Number.isFinite(row.completedAt.valueOf())||row.reservedAt<row.createdAt||row.completedAt<row.reservedAt||row.completedAt>c.now)throw unavailable();
    if(!row.providerReceiptCiphertext)throw unavailable();
    const receipt=monthlyReminderProviderReceiptSchema.parse(JSON.parse(unseal(row.providerReceiptCiphertext,aad(workspace,row.id)+'/provider',ring)));
    if(receipt.workspaceId!==workspace||receipt.outboxBindingId!==bindingId||receipt.intentId!==lookup.intentId||receipt.dispatchId!==row.id||receipt.providerId!==row.providerId||receipt.reservedAt!==row.reservedAt.toISOString()||receipt.acceptedAt!==row.completedAt.toISOString()||receipt.payloadSha256!==createHash('sha256').update(row.ciphertext).digest('hex'))throw unavailable();
    return verifiedReminderOutcomeSchema.parse({intentId:value.intentId,dispatchId:value.dispatchId,guardianId:value.mail.guardianId,channel:'email',outboxBindingId:bindingId,sourceReceiptId:row.id,state:'provider_accepted',providerId:row.providerId});
   }catch{throw unavailable();}
  },
 };
}
