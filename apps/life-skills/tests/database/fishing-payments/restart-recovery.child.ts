/** Actual separate Node process. Test-only synthetic authority/provider proofs.
 * Never imported at runtime by the parent; only its protocol types are imported.
 */
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import {restoreNativeCiChild,admitNativeCi,type NativeCiChildEnvelope} from '../native-ci-admission.ts';
import { z } from 'zod';
import { asId } from '../../../src/lib/ids.ts';
import type { Actor,ApprovedOffer } from '../../../src/features/fishing/contract.ts';
import type { FishingAuthority,HostedResult,RefundResult,WithdrawalFacts } from '../../../src/features/fishing-payments/ports.ts';
import { FishingPaymentStore } from '../../../src/features/fishing-payments/store.ts';
import { FishingPaymentService } from '../../../src/features/fishing-payments/service.ts';
import { invariant } from '../../../src/features/fishing-payments/domain.ts';
import { poolStore } from '../calendar/fixture.ts';
import { nativeUrl } from './fixture.ts';
import { merchant } from '../../unit/fishing-payments/fixture.ts';

export type RecoveryInput={databaseUrl:string;nativeCi?:NativeCiChildEnvelope;actor:Actor;operationId:string;originalStartKey:string;matchingResult:HostedResult|RefundResult;proof:{offerId:string;workspaceId:string;payerId:string;operatorId:string;learnerId:string;eligibilityEvidenceId:string};withdrawal:WithdrawalFacts|null};
export type RecoveryOutput={ok:boolean;code?:string;pid?:number;initialUnknown?:boolean;retriesUnknown?:boolean;createCalls?:number;readbackMismatchRejected?:boolean;resolved?:boolean;dispatchCount?:number;cashBefore?:{paidCents:number;refundedCents:number};cashAfter?:{paidCents:number;refundedCents:number}};
const identifier=z.string().regex(/^[a-zA-Z0-9_.:-]{1,160}$/);
const actorSchema=z.object({id:z.uuid(),workspaceId:z.uuid(),personId:z.uuid(),role:z.enum(['parent','practitioner']),state:z.literal('active'),locale:z.enum(['en','he']),sessionDigest:z.string().regex(/^[a-f0-9]{64}$/),expiresAt:z.number().int().positive()}).strict();
const common={providerObjectId:identifier,providerAccountId:identifier,livemode:z.literal(false),currency:z.literal('USD'),amountCents:z.number().int().positive(),purchaseId:z.uuid(),idempotencyKey:z.string().max(255)};
const protocol=z.object({databaseUrl:z.string().max(2048),nativeCi:z.strictObject({version:z.literal('JLFA-NATIVE-CI-20261022-01'),target:z.string().min(1).max(4096),nonce:z.string().regex(/^[a-f0-9]{64}$/),artifactRoot:z.string().min(1).max(2048)}).optional(),actor:actorSchema,operationId:z.uuid(),originalStartKey:identifier,
 matchingResult:z.discriminatedUnion('kind',[z.object({...common,kind:z.literal('hosted_invoice'),dueId:identifier,url:z.url()}).strict(),z.object({...common,kind:z.literal('refund'),status:z.enum(['pending','succeeded','failed'])}).strict()]),
 proof:z.object({offerId:identifier,workspaceId:z.uuid(),payerId:z.uuid(),operatorId:z.uuid(),learnerId:z.uuid(),eligibilityEvidenceId:identifier}).strict(),
 withdrawal:z.object({attended:z.number().int().min(0).max(12),revision:identifier,reason:z.enum(['voluntary','operator']),multiChildPrestart:z.boolean(),reviewedTermsId:identifier.nullable()}).strict().nullable()
}).strict();

async function input(){const chunks:Buffer[]=[];let size=0;for await(const part of process.stdin){const chunk=Buffer.isBuffer(part)?part:Buffer.from(part as string);size+=chunk.length;invariant(size<=65536,'RECOVERY_INPUT_LIMIT');chunks.push(chunk);}return protocol.parse(JSON.parse(Buffer.concat(chunks).toString('utf8')));}
async function main():Promise<RecoveryOutput>{
 const data=await input(),url=new URL(data.databaseUrl);
 invariant(['postgres:','postgresql:'].includes(url.protocol)&&url.hostname==='127.0.0.1'&&/^[0-9]+$/.test(url.port)&&!url.search&&!url.hash,'CHILD_TARGET_GUARD');
 process.env.TEST_DATABASE_URL=data.databaseUrl;if(data.nativeCi)restoreNativeCiChild(data.nativeCi);
 const ci=await admitNativeCi(['payment']),connectionString=nativeUrl();
 const actor:Actor={...data.actor,id:asId(data.actor.id,'account'),workspaceId:asId(data.actor.workspaceId,'workspace'),personId:asId(data.actor.personId,'person')};
 const pool=new pg.Pool({connectionString,ssl:false,max:2,connectionTimeoutMillis:2000,query_timeout:5000,statement_timeout:5000,idleTimeoutMillis:1000,application_name:'synthetic-rm-payment-recovery-child'});
 try{
  const target=(await pool.query('SELECT current_database() AS database,host(inet_server_addr()) AS host,inet_server_port() AS port')).rows[0];
  invariant(target?.database===url.pathname.slice(1)&&target.host===(ci?.serverAddress??'127.0.0.1')&&target.port===Number(url.port),'CHILD_ACTUAL_TARGET_MISMATCH');
  const proof=data.proof;
  const authority:FishingAuthority={
   async loadApprovedOffer(tx,current,offerId){invariant(current.workspaceId===proof.workspaceId&&offerId===proof.offerId,'SYNTHETIC_PROOF_MISMATCH');const rows=await tx.query<{offer:ApprovedOffer}>('SELECT offer_json AS offer FROM ls_fishing_payments.offers WHERE workspace_id=$1 AND id=$2',[current.workspaceId,offerId]);return rows[0]?.offer??null;},
   async authorize(_tx,current,offer){return offer.sourceVersion==='synthetic-source-v1'&&offer.id===proof.offerId&&offer.workspaceId===proof.workspaceId&&offer.payerAccountId===proof.payerId&&offer.operatorAccountId===proof.operatorId&&offer.lines.length===1&&offer.lines[0]?.learnerId===proof.learnerId&&offer.lines[0]?.eligibility.evidenceId===proof.eligibilityEvidenceId&&((current.role==='parent'&&current.id===proof.payerId)||(current.role==='practitioner'&&current.id===proof.operatorId));},
   async withdrawalFacts(){invariant(data.withdrawal,'SYNTHETIC_WITHDRAWAL_PROOF_REQUIRED');return data.withdrawal;},
   async reminderPolicy(){throw Error('NO_REMINDER_AUTHORITY_IN_RECOVERY_CHILD');}
  };
  let createCalls=0,readMode:'wrong'|'matching'='wrong';
  const store=new FishingPaymentStore({database:poolStore(pool),clock:{now:()=>new Date()},authority,merchant,provider:{execution:'synthetic',binding:merchant,
   async create(){createCalls++;throw Error('UNEXPECTED_SECOND_PROVIDER_CREATE');},
   async readOperation(){return readMode==='matching'?data.matchingResult:{...data.matchingResult,purchaseId:randomUUID()};},
   async reconcileReceipt(){throw Error('VERIFIED_RECEIPT_REQUIRED_IN_PARENT');}
  }}),service=new FishingPaymentService(store);
  const initial=await store.read(actor,c=>store.operation(c,data.operationId));invariant(initial.state==='unknown','NATIVE_UNKNOWN_REQUIRED');
  const before=await store.familyView(actor,initial.purchaseId),cashBefore={paidCents:before.paidCents,refundedCents:before.refundedCents};
  const retryOriginal=await service.executeSynthetic(actor,data.originalStartKey,data.operationId),retryNew=await service.executeSynthetic(actor,randomUUID(),data.operationId);
  invariant(retryOriginal.state==='unknown'&&retryNew.state==='unknown'&&createCalls===0,'RESTART_DUPLICATED_PROVIDER_CREATE');
  let rejected=false;try{await service.reconcileOperation(actor,randomUUID(),data.operationId);}catch(e){if(e instanceof Error&&e.message==='PROVIDER_RESULT_BINDING')rejected=true;else throw e;}
  invariant(rejected,'MISMATCHED_READBACK_NOT_REJECTED');
  const stillUnknown=await store.read(actor,c=>store.operation(c,data.operationId));invariant(stillUnknown.state==='unknown','WRONG_READBACK_CHANGED_OPERATION');
  readMode='matching';const resolved=await service.reconcileOperation(actor,randomUUID(),data.operationId);invariant(resolved.state==='confirmed','MATCHING_READBACK_NOT_RESOLVED');
  const after=await store.familyView(actor,initial.purchaseId),cashAfter={paidCents:after.paidCents,refundedCents:after.refundedCents};
  invariant(cashAfter.paidCents===cashBefore.paidCents&&cashAfter.refundedCents===cashBefore.refundedCents,'OPERATION_RESULT_RECORDED_CASH');
  const dispatchCount=await store.read(actor,async c=>(await c.tx.query<{count:number}>("SELECT count(*)::integer AS count FROM ls_fishing_payments.outbox WHERE workspace_id=$1 AND topic='operation.dispatch' AND aggregate_id=$2",[c.actor.workspaceId,data.operationId]))[0]!.count);
  invariant(dispatchCount===1,'DISPATCH_FENCE_NOT_UNIQUE');
  return {ok:true,pid:process.pid,initialUnknown:true,retriesUnknown:true,createCalls,readbackMismatchRejected:true,resolved:true,dispatchCount,cashBefore,cashAfter};
 }finally{await pool.end();}
}
// Hard process bound supplements query timeouts and the parent's bounded child.
const deadline=setTimeout(()=>process.exit(2),11000);deadline.unref();
main().then(result=>{clearTimeout(deadline);process.stdout.write(JSON.stringify(result));}).catch((error:unknown)=>{clearTimeout(deadline);const code=error instanceof Error&&/^[A-Z_0-9]{1,80}$/.test(error.message)?error.message:'RECOVERY_CHILD_FAILED';process.stdout.write(JSON.stringify({ok:false,code}));process.exitCode=1;});
