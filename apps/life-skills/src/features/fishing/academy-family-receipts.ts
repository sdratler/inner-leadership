import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {unseal,type Keyring} from '../identity/crypto.ts';
import type {SqlSession} from '../identity/store.ts';
import {academyFamilyCommandSchema,academyFamilySavedSchema} from './academy-family-contract.ts';

const payloadSchema=z.strictObject({saved:academyFamilySavedSchema,command:academyFamilyCommandSchema});
type Row={actorId:string;operationId:string;hash:string;ciphertext:string};
const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Internal receipt decoder, not an authorization boundary or a public read.
 * Callers must authorize the actual actor/selected child in this transaction.
 * Retain the original representation/AAD so historical receipts stay readable.
 */
export async function readAcademyFamilyReceipts(tx:SqlSession,workspaceId:string,ring:Keyring){
 const rows=await tx.query<Row>('SELECT actor_id AS "actorId",command_id AS "operationId",request_sha256 AS hash,result_ciphertext AS ciphertext FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND action=$2 ORDER BY recorded_at,actor_id,command_id LIMIT 1001',[workspaceId,'academy.family.setup']);
 if(rows.length>1000)throw new AppError('UNAVAILABLE');
 return rows.map(row=>{
  try{
   const payload=payloadSchema.parse(JSON.parse(unseal(row.ciphertext,`academy-family:v1:${workspaceId}:${row.actorId}:${row.operationId}:${row.hash}`,ring)));
   if(payload.command.operationId!==row.operationId||digest(payload.command)!==row.hash||payload.saved.applicationId!==payload.command.applicationId||payload.saved.personId!==payload.command.personId)throw new Error();
   return {...row,...payload};
  }catch{throw new AppError('UNAVAILABLE');}
 });
}
