import 'server-only';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {canonical} from '../contact-ops/core/validation.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {unseal,type Keyring} from '../identity/crypto.ts';
import {one,type SqlSession} from '../identity/store.ts';
import type {WorkspaceId} from '../identity/types.ts';
import {BILLING_SERVICE_V4,serviceDraftBindingV4Schema} from './guest-service-contract-v4.ts';
import {serviceOwnerIssueCommandV4Schema,serviceOwnerIssueReceiptV4Schema} from './guest-service-owner-contract-v4.ts';
import {issueServiceFinancialOfferV4,verifyServiceFamilyOfferV4} from './guest-service-domain-v4.ts';
import {verifyServiceFinancialDraftV4} from './guest-service-material-v4.ts';
import {serviceGuestAadV4} from './guest-service-aad-v4.ts';

type Context=Readonly<{workspaceId:WorkspaceId;tx:SqlSession}>;
export type ServiceIssueJournalRowV4={operationId:string;actorId:string;action:string;quoteId:string;requestDigest:string;recordedAt:Date;ciphertext:string};
const columns='operation_id AS "operationId",actor_id AS "actorId",action,quote_id AS "quoteId",request_digest AS "requestDigest",created_at AS "recordedAt",result_ciphertext AS ciphertext';
export const serviceOwnerIssueJournalV4Schema=z.object({version:z.literal(BILLING_SERVICE_V4),kind:z.literal('owner_service_issue'),workspaceId:z.string().uuid(),actorId:z.string().uuid(),
 command:serviceOwnerIssueCommandV4Schema,commandDigest:z.string().regex(/^[a-f0-9]{64}$/),draft:serviceDraftBindingV4Schema,receipt:serviceOwnerIssueReceiptV4Schema,
}).strict();
function stored(condition:unknown):asserts condition{if(!condition)throw new AppError('UNAVAILABLE');}
export function serviceOwnerCommandDigestV4(workspaceId:WorkspaceId,key:string,actorId:string,command:z.infer<typeof serviceOwnerIssueCommandV4Schema>){
 return privateDigest({domain:'owner-service-issue/v4',workspaceId,actorId,command},key);
}
/** Integrity, not access/payment authority. Caller must admit the actual owner
 * or exact-purpose guest before lookup, and recheck current access afterward.
 * No V3 decoder fallback or current financial-acceptance proof is supplied. */
export function decodeServiceIssueJournalV4(row:ServiceIssueJournalRowV4,workspaceId:WorkspaceId,ring:Keyring,key:string){
 stored(row.action==='guest_service_issue_v4');
 const j=serviceOwnerIssueJournalV4Schema.parse(JSON.parse(unseal(row.ciphertext,serviceGuestAadV4('owner_issue',workspaceId,row.operationId),ring))),r=j.receipt,c=j.command;
 const draft=verifyServiceFinancialDraftV4(j.draft),expected=issueServiceFinancialOfferV4(draft,c.expectedQuoteRevision,r.issuedAt,c.locale),e=r.evidence;
 stored(j.workspaceId===workspaceId&&j.actorId===row.actorId&&c.operationId===row.operationId&&c.quoteId===row.quoteId&&
  j.commandDigest===row.requestDigest&&j.commandDigest===serviceOwnerCommandDigestV4(workspaceId,key,row.actorId,c)&&draft.sha256===c.expectedDraftSha256&&
  r.operationId===row.operationId&&r.workspaceId===workspaceId&&r.actorId===row.actorId&&!r.replayed&&canonical(r.quote)===canonical(expected)&&r.issuedAt===row.recordedAt.toISOString());
 stored(e.workspaceId===workspaceId&&e.actorId===row.actorId&&e.quoteId===r.quote.id&&e.familyId===r.quote.familyId&&e.locale===c.locale&&e.materialSha256===r.quote.offer.sha256);
 return j;
}
export async function serviceIssueJournalRowV4(c:Context,workspaceId:WorkspaceId,operationId:string){
 stored(c.workspaceId===workspaceId);return one<ServiceIssueJournalRowV4>(c.tx,'SELECT '+columns+' FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND operation_id=$2',[workspaceId,operationId]);
}
export async function readIssuedServiceQuoteWithRowV4(c:Context,workspaceId:WorkspaceId,id:string,ring:Keyring,key:string){
 stored(c.workspaceId===workspaceId);
 const row=await one<{id:string;familyId:string;definitionId:string;revision:number;createdAt:Date;materialVersion:string|null;ciphertext:string}>(c.tx,
  'SELECT id,family_id AS "familyId",definition_id AS "definitionId",revision,created_at AS "createdAt",material_version AS "materialVersion",payload_ciphertext AS ciphertext FROM ls_fishing_billing.quotes WHERE workspace_id=$1 AND id=$2 FOR UPDATE',[workspaceId,id]);
 stored(row&&row.materialVersion===BILLING_SERVICE_V4);
 const quote=verifyServiceFamilyOfferV4(JSON.parse(unseal(row.ciphertext,serviceGuestAadV4('quote',workspaceId,id),ring)));
 stored(quote.workspaceId===workspaceId&&quote.id===row.id&&quote.familyId===row.familyId&&quote.definition.id===row.definitionId&&quote.revision===row.revision&&Date.parse(quote.createdAt)===row.createdAt.valueOf());
 const origins=await c.tx.query<ServiceIssueJournalRowV4>('SELECT '+columns+" FROM ls_fishing_billing.commands WHERE workspace_id=$1 AND quote_id=$2 AND action='guest_service_issue_v4' LIMIT 2 FOR SHARE",[workspaceId,id]);
 stored(origins.length===1);const original=decodeServiceIssueJournalV4(origins[0]!,workspaceId,ring,key).receipt.quote;
 stored(quote.revision>=original.revision&&canonical(quote.offer)===canonical(original.offer)&&quote.messageLocaleAtIssue===original.messageLocaleAtIssue);
 if(quote.revision===original.revision)stored(canonical(quote)===canonical(original));
 return {row,quote};
}
/** Preserve the existing material-only return for native owner readers. */
export async function readIssuedServiceQuoteV4(c:Context,workspaceId:WorkspaceId,id:string,ring:Keyring,key:string){
 return (await readIssuedServiceQuoteWithRowV4(c,workspaceId,id,ring,key)).quote;
}
