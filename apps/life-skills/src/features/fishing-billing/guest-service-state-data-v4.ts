import 'server-only';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {canonical} from '../contact-ops/core/validation.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {unseal,type Keyring} from '../identity/crypto.ts';
import {billingId} from './contracts.ts';
import type {BillingLedgerContext} from './native.ts';
import {BILLING_SERVICE_V4,type ServiceFamilyOfferV4} from './guest-service-contract-v4.ts';
import {serviceStateCommandV4Schema,serviceStateReceiptV4Schema,type ServiceStateCommandV4,type ServiceStateReceiptV4} from './guest-service-owner-state-contract-v4.ts';
import {serviceGuestAadV4} from './guest-service-aad-v4.ts';
export const serviceStateJournalV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),kind:z.literal('owner_service_state'),workspaceId:billingId,actorId:billingId,command:serviceStateCommandV4Schema,
 commandDigest:z.string().regex(/^[a-f0-9]{64}$/),resultDigest:z.string().regex(/^[a-f0-9]{64}$/),receipt:serviceStateReceiptV4Schema}).strict();
export type ServiceStateRowV4={operationId:string;actorId:string;action:string;quoteId:string;digest:string;recordedAt:Date;exactTime:boolean;ciphertext:string};
export const serviceStateColumnsV4='operation_id AS "operationId",actor_id AS "actorId",action,quote_id AS "quoteId",request_digest AS digest,created_at AS "recordedAt",created_at=date_trunc(\'milliseconds\',created_at) AS "exactTime",result_ciphertext AS ciphertext';
function stored(condition:unknown):asserts condition{if(!condition)throw new AppError('UNAVAILABLE');}
export function serviceStateCommandDigestV4(workspaceId:string,actorId:string,command:ServiceStateCommandV4,key:string){return privateDigest({domain:'owner-service-state-command/v4',workspaceId,actorId,command},key);}
export function serviceStateResultDigestV4(workspaceId:string,commandDigest:string,receipt:ServiceStateReceiptV4,key:string){return privateDigest({domain:'owner-service-state-result/v4',workspaceId,commandDigest,receipt},key);}
/** DATA integrity only. Caller separately supplies current owner/guest access,
 * guardian/legal/resources/expiry. A journal never grants current permission. */
export function decodeServiceStateJournalV4(row:ServiceStateRowV4,workspaceId:string,ring:Keyring,key:string){
 stored(row.action==='service_state_v4'&&row.exactTime===true);
 const j=serviceStateJournalV4Schema.parse(JSON.parse(unseal(row.ciphertext,serviceGuestAadV4('owner_state',workspaceId,row.operationId),ring))),r=j.receipt,c=j.command;
 stored(j.workspaceId===workspaceId&&j.actorId===row.actorId&&c.operationId===row.operationId&&c.quoteId===row.quoteId&&j.commandDigest===row.digest&&row.digest===serviceStateCommandDigestV4(workspaceId,row.actorId,c,key)&&j.resultDigest===serviceStateResultDigestV4(workspaceId,row.digest,r,key));
 stored(r.workspaceId===workspaceId&&r.actorId===row.actorId&&r.operationId===row.operationId&&r.quoteId===row.quoteId&&!r.replayed&&Date.parse(r.recordedAt)===row.recordedAt.valueOf()&&r.before.revision===c.expectedQuoteRevision&&r.after.paused===(c.paused??r.before.paused)&&r.after.state===(c.cancel?'cancelled':r.before.state));return j;
}
/** Authenticate EVERY bounded state row before selection. For a later current
 * revision to be accepted on the original immutable offer, every intervening
 * PRE-acceptance revision must be a real immutable owner state operation.
 * A missing/corrupt/duplicated transition or cancellation cannot be bypassed
 * by increasing a command revision, resealing a quote or editing a grant.
 * After acceptance, money revisions may intervene but cannot change state;
 * every owner state transition must continue the last authenticated state. */
export async function readServicePreAcceptanceStateV4(c:BillingLedgerContext,workspaceId:string,q:ServiceFamilyOfferV4,untilRevision:number,expected:{state:'issued'|'cancelled';paused:boolean},ring:Keyring,key:string){
 const tx=c.tx,physical=tx.query,time=c.now,at=time.valueOf(),query=physical.bind(tx);let open=true;
 const guard=()=>stored(open&&c.workspaceId===workspaceId&&q.workspaceId===workspaceId&&c.tx===tx&&tx.query===physical&&c.now===time&&time.valueOf()===at&&Number.isFinite(at));
 try{
  guard();const rows=await query<ServiceStateRowV4>('SELECT '+serviceStateColumnsV4+" FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND quote_id=$2 AND action='service_state_v4' ORDER BY operation_id LIMIT 1001 FOR SHARE",[workspaceId,q.id]);guard();stored(rows.length<=1000);
  const records=rows.map(row=>decodeServiceStateJournalV4(row,workspaceId,ring,key));
  for(const {receipt:r} of records)stored(r.familyId===q.familyId&&r.offerSha256===q.offer.sha256&&Date.parse(r.recordedAt)>=Date.parse(q.issuedAt!)&&Date.parse(r.recordedAt)<=at&&(r.acceptanceId===null||r.acceptanceId===q.acceptance?.id));
  const pre=records.filter(j=>j.receipt.acceptanceId===null).sort((a,b)=>a.receipt.before.revision-b.receipt.before.revision);
  let state={revision:q.offer.material.financial.issuedRevision,state:'issued' as 'issued'|'accepted'|'cancelled',paused:false},lastAt=Date.parse(q.issuedAt!);
  stored(Number.isInteger(untilRevision)&&untilRevision>=state.revision&&untilRevision-state.revision<=1000);
  for(const {receipt:r} of pre){
   stored(r.before.revision<untilRevision&&canonical(r.before)===canonical(state)&&Date.parse(r.recordedAt)>=lastAt);state=r.after;lastAt=Date.parse(r.recordedAt);
  }
  stored(canonical(state)===canonical({revision:untilRevision,...expected})&&lastAt<=(q.acceptance?Date.parse(q.acceptance.acceptedAt):at));guard();
  if(q.acceptance){
   let current={revision:untilRevision+1,state:'accepted' as 'issued'|'accepted'|'cancelled',paused:false},recordedAt=Date.parse(q.acceptance.acceptedAt);
   const post=records.filter(j=>j.receipt.acceptanceId!==null).sort((a,b)=>a.receipt.before.revision-b.receipt.before.revision);
   for(const {receipt:r} of post){
    stored(r.before.revision>=current.revision&&r.before.state===current.state&&r.before.paused===current.paused&&Date.parse(r.recordedAt)>=recordedAt);current=r.after;recordedAt=Date.parse(r.recordedAt);
   }
   stored(q.revision>=current.revision&&q.state===current.state&&q.paused===current.paused);guard();
  }
 }finally{open=false;}
}
