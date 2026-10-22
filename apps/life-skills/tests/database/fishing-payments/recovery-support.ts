/** Explicit synthetic adapters for the new native tests; no DDL or provider I/O. */
import { createHash,createHmac,randomBytes,randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {nativeCiChildEnvelope} from '../native-ci-admission.ts';
import { fileURLToPath } from 'node:url';
import type { Actor } from '../../../src/features/fishing/contract.ts';
import type { ProviderOperation } from '../../../src/features/fishing-payments/ports.ts';
import type { SettlementFact } from '../../../src/features/fishing-payments/domain.ts';
import type { NativeFixture } from './fixture.ts';
import { nativeUrl } from './fixture.ts';
import { merchant } from '../../unit/fishing-payments/fixture.ts';
import type { RecoveryInput,RecoveryOutput } from './restart-recovery.child.ts';

export async function renewNativeSession(n:NativeFixture,previous:Actor,at:Date):Promise<Actor>{
 const sessionDigest=createHash('sha256').update(randomBytes(32)).digest('hex'),expiresAt=at.getTime()+3600000;
 await n.pool.query('UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2 AND token_digest=$3',[previous.workspaceId,previous.id,previous.sessionDigest]);
 await n.pool.query('INSERT INTO ls_identity.sessions(token_digest,workspace_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4,$5)',[sessionDigest,previous.workspaceId,previous.id,new Date(Date.now()-1000),new Date(expiresAt)]);
 return {...previous,sessionDigest,expiresAt};
}

export async function ingestSyntheticSettlement(n:NativeFixture,owner:Actor,op:ProviderOperation,lineId:string,kind:'payment'|'refund'='payment'){
 if(op.state!=='confirmed'||!op.result)throw Error('CONFIRMED_NATIVE_OPERATION_REQUIRED');
 const now=n.deps.clock.now(),eventId=`evt_${randomUUID()}`,objectId=op.result.providerObjectId,seconds=Math.floor(now.getTime()/1000),secret='whsec_synthetic_native_process_test';
 const raw=Buffer.from(JSON.stringify({id:eventId,object:'event',type:kind==='refund'?'refund.updated':'invoice.paid',account:merchant.accountId,livemode:false,api_version:merchant.apiVersion,created:seconds,data:{object:{id:objectId}}}));
 const signature=`t=${seconds},v1=${createHmac('sha256',secret).update(`${seconds}.`).update(raw).digest('hex')}`;
 const fact:SettlementFact={canonicalTransactionId:kind==='refund'?objectId:`pi_${op.id}`,providerReceiptId:eventId,relatedProviderObjectId:objectId,operationId:op.id,purchaseId:op.purchaseId,purchaseLineId:lineId,dueId:op.dueId!,providerAccountId:merchant.accountId,livemode:false,currency:'USD',kind,cents:op.amountCents,feeCents:null,originalPaymentId:kind==='refund'?op.refundPaymentId:null,occurredAt:now.toISOString()};
 n.provider.readback={receiptId:eventId,resolvedObjectId:objectId,providerAccountId:merchant.accountId,livemode:false,readAt:now.toISOString(),facts:[fact],dues:[]};
 const intake=await n.inbox.acceptSynthetic(raw,signature,secret);
 await n.inbox.processSynthetic(owner,randomUUID(),intake.eventId);
}

/** Parent sends all connection/session inputs through stdin, never argv/env/logs. */
export async function runRecoveryChild(input:Omit<RecoveryInput,'databaseUrl'|'nativeCi'>):Promise<RecoveryOutput>{
 if('nativeCi' in input)throw Error('RECOVERY_CALLER_ADMISSION_REJECTED');
 const databaseUrl=nativeUrl(),nativeCi=nativeCiChildEnvelope();
 const env:NodeJS.ProcessEnv={NODE_ENV:'test'};
 for(const key of ['SystemRoot','WINDIR','TEMP','TMP'])if(process.env[key]!==undefined)env[key]=process.env[key];
 const childPath=fileURLToPath(new URL('./restart-recovery.child.ts',import.meta.url));
 const appRoot=fileURLToPath(new URL('../../../',import.meta.url));
 return new Promise((resolve,reject)=>{
  const child=spawn(process.execPath,['--conditions=react-server','--import','tsx',childPath],{cwd:appRoot,env,windowsHide:true,shell:false,stdio:['pipe','pipe','pipe']});
  let output='',bytes=0,timedOut=false,tooLarge=false;
  const timeout=setTimeout(()=>{timedOut=true;child.kill();},12000);
  child.stdout.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>8192){tooLarge=true;child.kill();}else output+=chunk.toString('utf8');});
  // Never echo child stderr: driver errors can include connection information.
  child.stderr.on('data',(chunk:Buffer)=>{bytes+=chunk.length;if(bytes>8192){tooLarge=true;child.kill();}});
  child.stdin.on('error',()=>{});
  child.once('error',()=>{clearTimeout(timeout);reject(Error('RECOVERY_CHILD_SPAWN_FAILED'));});
  child.once('close',code=>{
   clearTimeout(timeout);
   if(timedOut||tooLarge){reject(Error(timedOut?'RECOVERY_CHILD_TIMEOUT':'RECOVERY_CHILD_OUTPUT_LIMIT'));return;}
   let result:RecoveryOutput;try{result=JSON.parse(output) as RecoveryOutput;}catch{reject(Error('RECOVERY_CHILD_INVALID_OUTPUT'));return;}
   if(code!==0||!result.ok){reject(Error(result.code&&/^[A-Z_0-9]{1,80}$/.test(result.code)?result.code:'RECOVERY_CHILD_FAILED'));return;}
   resolve(result);
  });
  child.stdin.end(JSON.stringify({...input,databaseUrl,...(nativeCi?{nativeCi}:{})}));
 });
}
