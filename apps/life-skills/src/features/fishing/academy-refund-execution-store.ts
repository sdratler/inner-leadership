import 'server-only';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {digest} from '../fishing-payments/domain.ts';
import {one,type SqlSession} from '../identity/store.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';

/** Root journal namespaces share the existing PAY schema without changing its
 * legacy operation shape. Callers must hold the actual workspace transaction
 * lock and have reloaded current identity/authority; this class grants neither.
 * Private snapshot/claim/observation bodies are encrypted, never raw JSON. */
export class AcademyRefundExecutionJournal{
 constructor(private readonly ring:Keyring){}
 private aad(workspace:string,action:string,key:string,actorId:string){return `academy-refund-execution:v1:${workspace}:${action}:${key}:${actorId}`;}
 private scope(action:string,key:string){if(!/^owner03\.refund\.[a-z_]+$/.test(action)||!z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/).safeParse(key).success)throw new AppError('INVALID_REQUEST');}
 async read<T>(tx:SqlSession,workspace:string,action:string,key:string,schema:z.ZodType<T>):Promise<T|null>{
  this.scope(action,key);const rows=await tx.query<{actorId:string;ciphertext:unknown;hash:string;at:Date;timeValid:boolean}>(`SELECT actor_id AS "actorId",CASE WHEN octet_length(result_json::text)<=131072 THEN result_json ELSE NULL END AS ciphertext,digest AS hash,created_at AS at,created_at<=clock_timestamp() AS "timeValid" FROM ls_fishing_payments.commands WHERE workspace_id=$1 AND action=$2 AND command_id=$3 ORDER BY actor_id LIMIT 2 FOR SHARE`,[workspace,action,key]);if(rows.length>1)throw new AppError('CONFLICT');if(!rows.length)return null;const row=rows[0]!,envelope=z.strictObject({ciphertext:z.string().min(1).max(131072)}).parse(row.ciphertext);if(!(row.at instanceof Date)||!Number.isFinite(row.at.valueOf())||!row.timeValid||digest(envelope)!==row.hash)throw new AppError('UNAVAILABLE');return schema.parse(JSON.parse(unseal(envelope.ciphertext,this.aad(workspace,action,key,z.uuid().parse(row.actorId)),this.ring)));
 }
 async append<T>(tx:SqlSession,actor:{id:string;workspaceId:string},now:Date,action:string,key:string,raw:unknown,schema:z.ZodType<T>):Promise<T>{
  this.scope(action,key);const value=schema.parse(raw),text=JSON.stringify(value);if(Buffer.byteLength(text)>90000||!Number.isFinite(now.valueOf()))throw new AppError('INVALID_REQUEST');const old=await this.read(tx,actor.workspaceId,action,key,schema);if(old!==null){if(digest(old)!==digest(value))throw new AppError('CONFLICT');return old;}
  const envelope={ciphertext:seal(text,this.aad(actor.workspaceId,action,key,actor.id),this.ring)};if(Buffer.byteLength(JSON.stringify(envelope))>131072)throw new AppError('INVALID_REQUEST');await tx.query(`INSERT INTO ls_fishing_payments.commands(workspace_id,actor_id,action,command_id,digest,result_json,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)`,[actor.workspaceId,actor.id,action,key,digest(envelope),JSON.stringify(envelope),now]);return value;
 }
 /** This existing global fence is independent of actor and command replay.
  * It may only be inserted atomically with the encrypted consumed claim. */
 async consumeDispatch(tx:SqlSession,workspace:string,operationId:string,now:Date):Promise<boolean>{
  z.uuid().parse(operationId);const rows=await tx.query(`INSERT INTO ls_fishing_payments.outbox(id,workspace_id,topic,aggregate_id,revision,recorded_at) VALUES($1,$2,'operation.dispatch',$3,1,$4) ON CONFLICT DO NOTHING RETURNING id`,[randomUUID(),workspace,operationId,now]);return rows.length===1;
 }
 async dispatched(tx:SqlSession,workspace:string,operationId:string){return !!await one(tx,`SELECT id FROM ls_fishing_payments.outbox WHERE workspace_id=$1 AND topic='operation.dispatch' AND aggregate_id=$2 AND revision=1 FOR SHARE`,[workspace,z.uuid().parse(operationId)]);}
}
