import 'server-only';
import {AppError} from '../../lib/errors.ts';
import {billingId} from './contracts.ts';
import {PROGRAM_SOURCE_V3,programSourceRecordV3Schema,type ProgramSourceCommandV3,type ProgramSourceRecordV3} from './program-source-contract-v3.ts';
import type {BillingLedgerContext} from './native.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {unseal,type Keyring} from '../identity/crypto.ts';
import type {WorkspaceId} from '../identity/types.ts';

export type ProgramSourceKindV3=ProgramSourceCommandV3['kind'];
export type ProgramSourceStoredV3={record:ProgramSourceRecordV3;digest:string};
export type ProgramSourceRowV3={groupId:string;kind:ProgramSourceKindV3;id:string;revision:number;headDigest:string;recordWorkspace:string;recordGroup:string;recordKind:ProgramSourceKindV3;recordId:string;
 recordRevision:number;operationId:string;recordedBy:string;recordedAt:Date;requestDigest:string;digest:string;previousDigest:string|null;ciphertext:string};
export const programSourceSelectV3=`SELECT h.group_id AS "groupId",h.kind,h.source_id AS id,h.revision,h.record_digest AS "headDigest",
 v.workspace_id AS "recordWorkspace",v.group_id AS "recordGroup",v.kind AS "recordKind",v.source_id AS "recordId",v.revision AS "recordRevision",
 v.operation_id AS "operationId",v.recorded_by AS "recordedBy",v.recorded_at AS "recordedAt",v.request_digest AS "requestDigest",
 v.record_digest AS digest,v.previous_digest AS "previousDigest",v.payload_ciphertext AS ciphertext
 FROM ls_fishing_billing.program_source_heads h LEFT JOIN ls_fishing_billing.program_source_versions v
 ON v.workspace_id=h.workspace_id AND v.group_id=h.group_id AND v.kind=h.kind AND v.source_id=h.source_id AND v.revision=h.revision`;
type Context=Readonly<Pick<BillingLedgerContext,'workspaceId'|'tx'>>;
function stored(condition:unknown):asserts condition{if(!condition)throw new AppError('UNAVAILABLE');}
export function programSourceAadV3(workspaceId:WorkspaceId,group:string,kind:ProgramSourceKindV3,id:string,revision:number){
 return `ls_fishing_billing/program-source/v3/${workspaceId}/${group}/${kind}/${id}/${revision}`;
}
export function programSourceRequestDigestV3(workspaceId:WorkspaceId,actorId:string,command:ProgramSourceCommandV3,key:string){
 return privateDigest({domain:PROGRAM_SOURCE_V3,workspaceId,actorId,command},key);
}
/** Keyed record/index integrity only, shared by genuine owner and future guest
 * callers. This neither authenticates a caller nor admits a family, guardian,
 * signature, seat, operating permission or financial effect. */
export function decodeProgramSourceRowV3(row:ProgramSourceRowV3,workspaceId:WorkspaceId,ring:Keyring,key:string):ProgramSourceStoredV3{
 try{
  stored(billingId.safeParse(workspaceId).success&&key.length>=32);
  const record=programSourceRecordV3Schema.parse(JSON.parse(unseal(row.ciphertext,programSourceAadV3(workspaceId,row.groupId,row.kind,row.id,row.revision),ring))),c=record.command;
  stored(record.workspaceId===workspaceId&&row.recordWorkspace===workspaceId&&c.groupId===row.groupId&&row.recordGroup===row.groupId&&
   c.kind===row.kind&&row.recordKind===row.kind&&c.id===row.id&&row.recordId===row.id&&record.revision===row.revision&&row.recordRevision===row.revision&&
   record.recordedBy===row.recordedBy&&c.operationId===row.operationId&&record.recordedAt===row.recordedAt.toISOString()&&record.previousDigest===row.previousDigest&&
   row.requestDigest===programSourceRequestDigestV3(workspaceId,record.recordedBy,c,key)&&row.digest===row.headDigest&&row.digest===privateDigest({domain:'program-source-record/v3',record},key));
  return {record,digest:row.digest};
 }catch{throw new AppError('UNAVAILABLE');}
}
function context(c:Context,workspaceId:WorkspaceId,groupId:string,key:string){
 stored(c.workspaceId===workspaceId&&billingId.safeParse(workspaceId).success&&billingId.safeParse(groupId).success&&key.length>=32);
}
/** Server-only DATA primitive in the caller's actual transaction. Caller must
 * establish genuine current owner or exact-purpose guest admission BEFORE
 * lookup, lock the workspace, validate current native family mapping and
 * recheck admission through commit. No owner actor/session is fabricated.
 * Exact progression lookup never enumerates other families' progressions. */
export async function readProgramSourceInTransactionV3(c:Context,workspaceId:WorkspaceId,groupId:string,kind:ProgramSourceKindV3,id:string,ring:Keyring,key:string):Promise<ProgramSourceStoredV3|null>{
 context(c,workspaceId,groupId,key);stored(billingId.safeParse(id).success&&['group','lesson','progression'].includes(kind));
 const rows=await c.tx.query<ProgramSourceRowV3>(programSourceSelectV3+' WHERE h.workspace_id=$1 AND h.group_id=$2 AND h.kind=$3 AND h.source_id=$4 LIMIT 2 FOR SHARE OF h',[workspaceId,groupId,kind,id]);
 stored(rows.length<=1);if(!rows[0])return null;
 const row=rows[0];stored(row.groupId===groupId.toLowerCase()&&row.kind===kind&&row.id===id.toLowerCase());
 return decodeProgramSourceRowV3(row,workspaceId,ring,key);
}
/** Authenticate the COMPLETE bounded group lesson set before any eligibility
 * filtering. A cancelled/corrupt row or truncation cannot become empty data. */
export async function readProgramLessonsInTransactionV3(c:Context,workspaceId:WorkspaceId,groupId:string,ring:Keyring,key:string){
 context(c,workspaceId,groupId,key);
 const rows=await c.tx.query<ProgramSourceRowV3>(programSourceSelectV3+" WHERE h.workspace_id=$1 AND h.group_id=$2 AND h.kind='lesson' ORDER BY h.source_id LIMIT 1001 FOR SHARE OF h",[workspaceId,groupId]);
 stored(rows.length<=1000);return rows.map(row=>{
  stored(row.groupId===groupId.toLowerCase()&&row.kind==='lesson');return decodeProgramSourceRowV3(row,workspaceId,ring,key);
 });
}
