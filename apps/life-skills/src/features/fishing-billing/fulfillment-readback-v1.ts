import 'server-only';
import {AppError} from '../../lib/errors.ts';
import {billingId} from './contracts.ts';
import {FULFILLMENT_V1,fulfillmentRecordV1Schema,type FulfillmentCommandV1,type FulfillmentRecordV1} from './fulfillment-contract-v1.ts';
import type {BillingLedgerContext} from './native.ts';
import {unseal,type Keyring} from '../identity/crypto.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import type {WorkspaceId} from '../identity/types.ts';

export type FulfillmentKindV1=FulfillmentRecordV1['kind'];
export type FulfillmentStoredV1={record:FulfillmentRecordV1;digest:string};
export type FulfillmentRowV1={kind:FulfillmentKindV1;id:string;revision:number;headDigest:string;workspaceId:string;recordKind:FulfillmentKindV1;recordId:string;recordRevision:number;
 groupId:string|null;quoteId:string|null;operationId:string;actorId:string;recordedAt:Date;requestDigest:string;digest:string;previousDigest:string|null;ciphertext:string};
const columns=`v.workspace_id AS "workspaceId",v.kind AS "recordKind",v.entity_id AS "recordId",v.revision AS "recordRevision",v.group_id AS "groupId",v.quote_id AS "quoteId",
 v.operation_id AS "operationId",v.recorded_by AS "actorId",v.recorded_at AS "recordedAt",v.request_digest AS "requestDigest",v.record_digest AS digest,
 v.previous_digest AS "previousDigest",v.payload_ciphertext AS ciphertext`;
export const fulfillmentCurrentSelectV1=`SELECT h.kind,h.entity_id AS id,h.revision,h.record_digest AS "headDigest",${columns}
 FROM ls_fishing_billing.fulfillment_heads h LEFT JOIN ls_fishing_billing.fulfillment_versions v
 ON v.workspace_id=h.workspace_id AND v.kind=h.kind AND v.entity_id=h.entity_id AND v.revision=h.revision`;
export const fulfillmentExactSelectV1=`SELECT v.kind,v.entity_id AS id,v.revision,v.record_digest AS "headDigest",${columns} FROM ls_fishing_billing.fulfillment_versions v`;
type Context=Readonly<Pick<BillingLedgerContext,'workspaceId'|'tx'>>;
function stored(condition:unknown):asserts condition{if(!condition)throw new AppError('UNAVAILABLE');}
export function fulfillmentAadV1(workspaceId:WorkspaceId,kind:FulfillmentKindV1,id:string,revision:number){return `ls_fishing_billing/fulfillment/v1/${workspaceId}/${kind}/${id}/${revision}`;}
export function fulfillmentRequestDigestV1(workspaceId:WorkspaceId,actorId:string,command:FulfillmentCommandV1,key:string){return privateDigest({domain:FULFILLMENT_V1,workspaceId,actorId,command},key);}
/** Shared DATA integrity only. These are recorded planning facts, not verified
 * venue, transport, skills, global capacity, payment or operating authority. */
export function decodeFulfillmentRowV1(row:FulfillmentRowV1,workspaceId:WorkspaceId,ring:Keyring,key:string):FulfillmentStoredV1{
 try{
  stored(billingId.safeParse(workspaceId).success&&key.length>=32);
  const record=fulfillmentRecordV1Schema.parse(JSON.parse(unseal(row.ciphertext,fulfillmentAadV1(workspaceId,row.kind,row.id,row.revision),ring))),command=record.command;
  const id=command.action==='record_departure'?command.id:command.quoteId;
  stored(record.workspaceId===workspaceId&&row.workspaceId===workspaceId&&record.kind===row.kind&&row.recordKind===row.kind&&id===row.id&&row.recordId===row.id&&
   record.revision===row.revision&&row.recordRevision===row.revision&&record.recordedBy===row.actorId&&command.operationId===row.operationId&&record.recordedAt===row.recordedAt.toISOString()&&
   record.previousDigest===row.previousDigest&&row.requestDigest===fulfillmentRequestDigestV1(workspaceId,record.recordedBy,command,key)&&row.digest===row.headDigest&&row.digest===privateDigest({domain:'fulfillment-record/v1',record},key)&&
   (command.action==='record_departure'?(row.groupId===command.groupId&&row.quoteId===null):(row.groupId===null&&row.quoteId===command.quoteId)));
  return {record,digest:row.digest};
 }catch{throw new AppError('UNAVAILABLE');}
}
/** Caller owns genuine current owner or exact-purpose guest admission before
 * lookup, the workspace lock, current native family mapping and terminal
 * access checks in this SAME transaction. No session/actor or new DB is made.
 * One exact entity only; no all-family plans or workspace departure scan. */
export async function readFulfillmentInTransactionV1(c:Context,workspaceId:WorkspaceId,kind:FulfillmentKindV1,id:string,ring:Keyring,key:string):Promise<FulfillmentStoredV1|null>{
 stored(c.workspaceId===workspaceId&&billingId.safeParse(workspaceId).success&&billingId.safeParse(id).success&&key.length>=32&&['departure','plan'].includes(kind));
 const rows=await c.tx.query<FulfillmentRowV1>(fulfillmentCurrentSelectV1+' WHERE h.workspace_id=$1 AND h.kind=$2 AND h.entity_id=$3 LIMIT 2 FOR SHARE OF h',[workspaceId,kind,id]);
 stored(rows.length<=1);if(!rows[0])return null;const row=rows[0];stored(row.kind===kind&&row.id===id.toLowerCase());
 return decodeFulfillmentRowV1(row,workspaceId,ring,key);
}
/** Guest-facing server composition must bind the exact selected group as
 * well as departure. Caller still needs genuine admission, not an ID or hash. */
export async function readDepartureInTransactionV1(c:Context,workspaceId:WorkspaceId,groupId:string,id:string,ring:Keyring,key:string){
 stored(billingId.safeParse(groupId).success);
 const saved=await readFulfillmentInTransactionV1(c,workspaceId,'departure',id,ring,key);
 if(saved)stored(saved.record.kind==='departure'&&saved.record.command.groupId===groupId.toLowerCase());return saved;
}
