import 'server-only';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import type {WorkspaceId} from '../../lib/ids.ts';
import type {SqlSession} from '../identity/store.ts';
import {lockWorkspace} from '../identity/data.ts';
import {seal,unseal,type Keyring} from '../identity/crypto.ts';
import {privateDigest} from '../contact-ops/server/digests.ts';
import {isKeysInterest} from '../keys-trip/contract.ts';
import type {GroupApplicationRecord} from './contract.ts';
import {fishingFollowupCommandSchema,fishingFollowupStateSchema,type FishingFollowupCommand,type FishingFollowupState} from './fishing-followup-contract.ts';

export type FishingFollowupRow={operationId:string;applicationId:string;actorAccountId:string;version:number;requestDigest:string;payloadCiphertext:string;recordedAt:Date};
export type FishingFollowupRecordConfig={workspaceId:WorkspaceId;ownerAccountId:string;ring:Keyring;digestKey:string};
export const fishingFollowupRowSql=`SELECT operation_id AS "operationId",application_id AS "applicationId",actor_account_id AS "actorAccountId",version,request_digest AS "requestDigest",payload_ciphertext AS "payloadCiphertext",recorded_at AS "recordedAt" FROM ls_service_interest.fishing_inquiry_followups`;
const aad=(workspace:string,operation:string)=>`ls_service_interest/fishing-followup/v1/${workspace}/${operation}`;
const savedSchema=z.object({expectedVersion:z.number().int().nonnegative(),state:fishingFollowupStateSchema}).strict();
function digest(config:FishingFollowupRecordConfig,input:{operationId:string;applicationId:string;actorAccountId:string;expectedVersion:number;state:FishingFollowupState}){return privateDigest({domain:'fishing-inquiry-followup/v1',workspace:config.workspaceId,...input},config.digestKey);}
/** Integrity decoder only; the caller must authorize its read before loading rows. */
export function decodeFishingFollowupRecord(config:FishingFollowupRecordConfig,row:FishingFollowupRow){
 try{const saved=savedSchema.parse(JSON.parse(unseal(row.payloadCiphertext,aad(config.workspaceId,row.operationId),config.ring)));
  if(row.actorAccountId!==config.ownerAccountId||row.version!==saved.expectedVersion+1||row.requestDigest!==digest(config,{operationId:row.operationId,applicationId:row.applicationId,actorAccountId:row.actorAccountId,...saved}))throw new Error();
  return {operationId:row.operationId,applicationId:row.applicationId,actorAccountId:row.actorAccountId,version:row.version,recordedAt:row.recordedAt.toISOString(),...saved.state};
 }catch{throw new AppError('UNAVAILABLE');}
}
/** One shared transactional writer for a genuine session or explicitly scoped
 * connection. Authorization must freshly check that credential and exact owner,
 * and return the target inquiry in this same physical transaction. */
export async function appendFishingFollowupInTransaction(tx:SqlSession,config:FishingFollowupRecordConfig,input:FishingFollowupCommand,now:Date,authorize:(tx:SqlSession,applicationId:string)=>Promise<GroupApplicationRecord>){
 const parsed=fishingFollowupCommandSchema.safeParse(input);if(!parsed.success)throw new AppError('INVALID_REQUEST');const command=parsed.data;
 const state=fishingFollowupStateSchema.parse({status:command.status,note:command.note,nextAction:command.nextAction,dueDate:command.dueDate,waitingCondition:command.waitingCondition,...(command.sourceCorrection?{sourceCorrection:command.sourceCorrection}:{}),...(command.keysContactCorrection?{keysContactCorrection:command.keysContactCorrection}:{})});
 await lockWorkspace(tx,config.workspaceId);const application=await authorize(tx,command.applicationId);
 if(application.id!==command.applicationId||application.source!=='public_group_application')throw new AppError('NOT_FOUND');
 if(command.keysContactCorrection&&!isKeysInterest(application.fields))throw new AppError('INVALID_REQUEST');
 const requestDigest=digest(config,{operationId:command.operationId,applicationId:command.applicationId,actorAccountId:config.ownerAccountId,expectedVersion:command.expectedVersion,state});
 const prior=await tx.query<FishingFollowupRow>(fishingFollowupRowSql+' WHERE workspace_id=$1 AND operation_id=$2',[config.workspaceId,command.operationId]);
 if(prior.length){if(prior.length!==1||prior[0]!.requestDigest!==requestDigest||prior[0]!.actorAccountId!==config.ownerAccountId)throw new AppError('CONFLICT');return {...decodeFishingFollowupRecord(config,prior[0]!),replayed:true};}
 const rows=await tx.query<FishingFollowupRow>(fishingFollowupRowSql+' WHERE workspace_id=$1 AND application_id=$2 ORDER BY version DESC LIMIT 1',[config.workspaceId,command.applicationId]);
 const latest=rows[0]?decodeFishingFollowupRecord(config,rows[0]):null,version=(latest?.version??0)+1;
 if(latest?.keysContactCorrection&&!command.keysContactCorrection)throw new AppError('INVALID_REQUEST');
 if(command.expectedVersion!==version-1)throw new AppError('CONFLICT');
 await tx.query('INSERT INTO ls_service_interest.fishing_inquiry_followups(workspace_id,operation_id,application_id,actor_account_id,version,request_digest,payload_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[config.workspaceId,command.operationId,command.applicationId,config.ownerAccountId,version,requestDigest,seal(JSON.stringify({expectedVersion:command.expectedVersion,state}),aad(config.workspaceId,command.operationId),config.ring),now]);
 return {operationId:command.operationId,applicationId:command.applicationId,actorAccountId:config.ownerAccountId,version,recordedAt:now.toISOString(),...state,replayed:false};
}
