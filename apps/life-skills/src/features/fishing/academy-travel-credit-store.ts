import 'server-only';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {one,type SqlSession} from '../identity/store.ts';
import {travelDigest} from './academy-travel-credit-source.ts';
import {travelStoredChangeSchema,travelAnyChangeCommandSchema,travelDeclarationCommandSchema,travelDeclarationRecordSchema,travelCommandReceiptSchema,type TravelChangeRecord,type TravelDeclarationRecord,type TravelCommandReceipt} from './academy-travel-credit-contract.ts';
export const travelRecordAad=(kind:'change'|'declaration'|'command',workspace:string,id:string)=>`academy-travel:${kind}:v1:${workspace}:${id}`;
const commandRecord=z.strictObject({requestSha256:z.string().regex(/^[a-f0-9]{64}$/),command:z.union([travelAnyChangeCommandSchema,travelDeclarationCommandSchema]),receipt:travelCommandReceiptSchema});
type Row={id:string;workspaceId:string;enrollmentId:string;learnerId:string;occurrenceId:string;sha256:string;ciphertext:string};
const columns='id,workspace_id AS "workspaceId",enrollment_id AS "enrollmentId",learner_id AS "learnerId",original_occurrence_id AS "occurrenceId",sha256,payload_ciphertext AS ciphertext';
export class AcademyTravelCreditStore{
 constructor(private tx:SqlSession,private ring:Keyring){}
 private encode(kind:'change'|'declaration'|'command',workspace:string,id:string,value:unknown){const bytes=JSON.stringify(value);if(Buffer.byteLength(bytes)>45000)throw new AppError('UNAVAILABLE');return seal(bytes,travelRecordAad(kind,workspace,id),this.ring);}
 private decode<T>(schema:z.ZodType<T>,kind:'change'|'declaration'|'command',workspace:string,id:string,ciphertext:string):T{
  try{if(Buffer.byteLength(ciphertext)>65536)throw Error();return schema.parse(JSON.parse(unseal(ciphertext,travelRecordAad(kind,workspace,id),this.ring)));}catch{throw new AppError('UNAVAILABLE');}
 }
 private change(row:Row){const value=this.decode(travelStoredChangeSchema,'change',row.workspaceId,row.id,row.ciphertext),{sha256,...body}=value;
  if(value.id!==row.id||value.workspaceId!==row.workspaceId||value.enrollmentId!==row.enrollmentId||value.learnerId!==row.learnerId||value.originalOccurrenceId!==row.occurrenceId||sha256!==row.sha256||travelDigest(body)!==sha256)throw new AppError('UNAVAILABLE');return value;}
 async changes(workspace:string,enrollment:string,occurrence:string){const rows=await this.tx.query<Row>(`SELECT ${columns} FROM ls_fishing_stage.academy_travel_changes WHERE workspace_id=$1 AND enrollment_id=$2 AND original_occurrence_id=$3 ORDER BY sequence DESC LIMIT 101 FOR SHARE`,[workspace,enrollment,occurrence]);if(rows.length>100)throw new AppError('UNAVAILABLE');return rows.map(row=>this.change(row));}
 async readChange(workspace:string,id:string){const row=await one<Row>(this.tx,`SELECT ${columns} FROM ls_fishing_stage.academy_travel_changes WHERE workspace_id=$1 AND id=$2 FOR SHARE`,[workspace,id]);return row?this.change(row):null;}
 async insertChange(value:TravelChangeRecord){const v=travelStoredChangeSchema.parse(value);await this.tx.query(`INSERT INTO ls_fishing_stage.academy_travel_changes(workspace_id,id,enrollment_id,learner_id,stage_id,original_occurrence_id,changed_stage_revision,operator_id,operation_id,sha256,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,[v.workspaceId,v.id,v.enrollmentId,v.learnerId,v.stageId,v.originalOccurrenceId,v.changed.stageRevision,v.operatorId,v.command.operationId,v.sha256,this.encode('change',v.workspaceId,v.id,v),new Date(v.recordedAt)]);}
 async declarations(workspace:string,changeId:string){const rows=await this.tx.query<{id:string;sha256:string;parentId:string;ciphertext:string}>(`SELECT id,sha256,parent_account_id AS "parentId",payload_ciphertext AS ciphertext FROM ls_fishing_stage.academy_travel_declarations WHERE workspace_id=$1 AND change_id=$2 ORDER BY sequence DESC LIMIT 101 FOR SHARE`,[workspace,changeId]);if(rows.length>100)throw new AppError('UNAVAILABLE');return rows.map(row=>{
  const v=this.decode(travelDeclarationRecordSchema,'declaration',workspace,row.id,row.ciphertext);if(v.workspaceId!==workspace||v.id!==row.id||v.changeId!==changeId||v.parentAccountId!==row.parentId||travelDigest(v)!==row.sha256)throw new AppError('UNAVAILABLE');return v;});}
 async insertDeclaration(value:TravelDeclarationRecord){const v=travelDeclarationRecordSchema.parse(value);await this.tx.query(`INSERT INTO ls_fishing_stage.academy_travel_declarations(workspace_id,id,enrollment_id,learner_id,change_id,parent_account_id,operation_id,sha256,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[v.workspaceId,v.id,v.enrollmentId,v.learnerId,v.changeId,v.parentAccountId,v.command.operationId,travelDigest(v),this.encode('declaration',v.workspaceId,v.id,v),new Date(v.recordedAt)]);}
 async replay(workspace:string,actorId:string,operationId:string,command:unknown){
  const row=await one<{sha256:string;ciphertext:string}>(this.tx,`SELECT request_sha256 AS sha256,payload_ciphertext AS ciphertext FROM ls_fishing_stage.academy_travel_commands WHERE workspace_id=$1 AND actor_account_id=$2 AND operation_id=$3 FOR SHARE`,[workspace,actorId,operationId]);if(!row)return null;
  const value=this.decode(commandRecord,'command',workspace,actorId+'/'+operationId,row.ciphertext),sha256=travelDigest(command);
  if(value.requestSha256!==row.sha256||value.requestSha256!==travelDigest(value.command)||value.receipt.operationId!==operationId)throw new AppError('UNAVAILABLE');if(sha256!==row.sha256)throw new AppError('CONFLICT');return value.receipt;
 }
 async record(workspace:string,actorId:string,command:unknown,receipt:TravelCommandReceipt,now:Date){const body=commandRecord.parse({requestSha256:travelDigest(command),command,receipt});await this.tx.query(`INSERT INTO ls_fishing_stage.academy_travel_commands(workspace_id,actor_account_id,operation_id,request_sha256,change_id,declaration_id,credit_id,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,[workspace,actorId,receipt.operationId,body.requestSha256,receipt.changeId,receipt.declarationId,receipt.creditId,this.encode('command',workspace,actorId+'/'+receipt.operationId,body),now]);}
}
