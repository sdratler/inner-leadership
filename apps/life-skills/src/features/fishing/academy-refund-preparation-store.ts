import 'server-only';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {digest,type MerchantBinding} from '../fishing-payments/domain.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import {seal,unseal} from '../identity/crypto.ts';
import type {IdentityConfig} from '../identity/config.ts';
import {systemClock,type Actor,type IdentityClock} from '../identity/types.ts';
import {NativeFishingProgram} from './native-program.ts';
import {FishingProgramError} from './native-program-contract.ts';
import {refundPreparationCommandSchema,refundPreparationFactsSchema,refundPreparationResultSchema,refundPreparationView,type RefundPreparationCommand,type RefundPreparationFacts,type RefundPreparationSelection} from './academy-refund-preparation-contract.ts';

const payloadSchema=z.strictObject({command:refundPreparationCommandSchema,facts:refundPreparationFactsSchema,actorId:z.uuid(),recordedAt:z.iso.datetime()});
const receiptSchema=z.strictObject({command:refundPreparationCommandSchema,result:refundPreparationResultSchema});
type Header={id:string;kind:string;householdId:string;payerAccountId:string;cancellationId:string|null;reservationId:string|null;state:string;reviewHash:string;requestHash:string;total:number;actorId:string;commandId:string;recordedAt:Date;ciphertext:string};
/** Immutable owner review preparation only. No provider, operation, outbox,
 * application runtime admission, financial execution or final legal approval. */
export class AcademyRefundPreparationStore{
 constructor(private readonly db:IdentityStore,private readonly config:IdentityConfig,private readonly merchant:MerchantBinding|null=null,private readonly clock:IdentityClock=systemClock){}
 private guard(actor:Actor){if(actor.workspaceId!==this.config.workspaceId||actor.role!=='practitioner')throw new AppError('FORBIDDEN');if(!this.merchant)throw new AppError('UNAVAILABLE');}
 private program(tx:SqlSession){return new NativeFishingProgram({transaction:work=>work(tx)},this.config.keyring,{childAccountsEnabled:false,merchant:this.merchant},this.clock);}
 private aad(workspace:string,kind:string,id:string){return `academy-refund-preparation:v1:${workspace}:${kind}:${id}`;}
 private encode(workspace:string,kind:string,id:string,value:unknown){const text=JSON.stringify(value);if(Buffer.byteLength(text)>90000)throw new AppError('INVALID_REQUEST');return seal(text,this.aad(workspace,kind,id),this.config.keyring);}
 private decode(workspace:string,kind:string,id:string,ciphertext:string){return JSON.parse(unseal(ciphertext,this.aad(workspace,kind,id),this.config.keyring));}
 private result(id:string,reviewSha256:string){return refundPreparationResultSchema.parse({id,revision:1,state:'prepared_only',reviewSha256,effect:'none',providerApproval:'not_admitted',execution:'denied'});}
 private async quote(tx:SqlSession,actor:Actor,selection:RefundPreparationSelection){return this.program(tx).owner03RefundPreparationInTransaction(tx,actor,selection);}
 async preview(actor:Actor,selection:RefundPreparationSelection){this.guard(actor);return this.db.transaction(async tx=>{const q=await this.quote(tx,actor,selection);return refundPreparationView(q.facts,q.reviewSha256);});}
 private async header(tx:SqlSession,actor:Actor,id:string){return one<Header>(tx,`SELECT id,kind,household_id AS "householdId",payer_account_id AS "payerAccountId",cancellation_id AS "cancellationId",reservation_id AS "reservationId",state,review_sha256 AS "reviewHash",request_sha256 AS "requestHash",total_refund_cents AS total,actor_id AS "actorId",command_id AS "commandId",recorded_at AS "recordedAt",payload_ciphertext AS ciphertext FROM ls_fishing_stage.refund_preparations WHERE workspace_id=$1 AND id=$2 FOR SHARE`,[actor.workspaceId,z.uuid().parse(id)]);}
 private async verify(tx:SqlSession,actor:Actor,row:Header,current?:{facts:RefundPreparationFacts;reviewSha256:string}){
  const saved=payloadSchema.parse(this.decode(actor.workspaceId,'header',row.id,row.ciphertext)),command=saved.command;
  // Reauthorize from native source/payment/guardian/attendance before publishing
  // any saved result. The supplied current quote is already from this same tx.
  const q=current??await this.quote(tx,actor,command.selection),expected=this.result(row.id,q.reviewSha256);
  if(row.actorId!==actor.id||saved.actorId!==row.actorId||command.id!==row.id||command.operationId!==row.commandId||row.kind!==command.selection.kind||row.state!=='prepared_only'||row.requestHash!==digest(command)||row.reviewHash!==digest(saved.facts)||row.reviewHash!==command.expectedReviewSha256||q.reviewSha256!==row.reviewHash||digest(q.facts)!==digest(saved.facts)||row.householdId!==saved.facts.householdId||row.payerAccountId!==saved.facts.payerAccountId||row.cancellationId!==(saved.facts.family?.cancellationId??null)||row.reservationId!==(saved.facts.family?.reservationId??null)||!(row.recordedAt instanceof Date)||saved.recordedAt!==row.recordedAt.toISOString()||row.recordedAt>this.clock.now()||row.total!==saved.facts.members.reduce((n,m)=>n+m.refundCents,0))throw new AppError('CONFLICT');
  const members=await tx.query<{purchaseId:string;childId:string;providerAccountId:string;livemode:boolean;paymentId:string;refundCents:number}>(`SELECT purchase_id AS "purchaseId",child_id AS "childId",provider_account_id AS "providerAccountId",livemode,original_payment_id AS "paymentId",refund_cents AS "refundCents" FROM ls_fishing_stage.refund_preparation_members WHERE workspace_id=$1 AND preparation_id=$2 ORDER BY purchase_id FOR SHARE`,[actor.workspaceId,row.id]);
  const wanted=saved.facts.members.map(m=>({purchaseId:m.input.purchase.purchaseId,childId:m.input.purchase.childId,providerAccountId:m.originalPayment.providerAccountId,livemode:m.originalPayment.livemode,paymentId:m.originalPayment.paymentId,refundCents:m.refundCents}));if(digest(members)!==digest(wanted))throw new AppError('UNAVAILABLE');
  const receipt=await one<{action:string;hash:string;ciphertext:string}>(tx,`SELECT action,request_sha256 AS hash,result_ciphertext AS ciphertext FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND actor_id=$2 AND command_id=$3 FOR SHARE`,[actor.workspaceId,row.actorId,row.commandId]);
  if(!receipt||receipt.action!=='refund.approval.prepare'||receipt.hash!==row.requestHash)throw new AppError('UNAVAILABLE');const read=receiptSchema.parse(this.decode(actor.workspaceId,'receipt',row.commandId,receipt.ciphertext));if(digest(read.command)!==row.requestHash||digest(read.result)!==digest(expected))throw new AppError('UNAVAILABLE');return {command,result:expected};
 }
 async read(actor:Actor,id:string){this.guard(actor);return this.db.transaction(async tx=>{await this.program(tx).assertRefundPreparationOwnerInTransaction(tx,actor);const row=await this.header(tx,actor,id);if(!row||row.actorId!==actor.id)throw new AppError('NOT_FOUND');return (await this.verify(tx,actor,row)).result;});}
 async prepare(actor:Actor,raw:unknown){const command=refundPreparationCommandSchema.safeParse(raw);if(!command.success)throw new AppError('INVALID_REQUEST');this.guard(actor);const input:RefundPreparationCommand=command.data;
  try{return await this.db.transaction(async tx=>{
   const q=await this.quote(tx,actor,input.selection);if(q.reviewSha256!==input.expectedReviewSha256)throw new AppError('CONFLICT');
   const old=await one<{action:string;hash:string}>(tx,`SELECT action,request_sha256 AS hash FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND actor_id=$2 AND command_id=$3 FOR SHARE`,[actor.workspaceId,actor.id,input.operationId]);
   if(old){if(old.action!=='refund.approval.prepare'||old.hash!==digest(input))throw new AppError('CONFLICT');const row=await this.header(tx,actor,input.id);if(!row)throw new AppError('UNAVAILABLE');const saved=await this.verify(tx,actor,row,q);if(digest(saved.command)!==digest(input))throw new AppError('CONFLICT');return {...saved.result,replayed:true};}
   const ids=q.facts.members.map(m=>m.input.purchase.purchaseId),existing=await one(tx,`SELECT preparation_id FROM ls_fishing_stage.refund_preparation_members WHERE workspace_id=$1 AND purchase_id=ANY($2::uuid[]) LIMIT 1 FOR SHARE`,[actor.workspaceId,ids]);if(existing||await this.header(tx,actor,input.id))throw new AppError('CONFLICT');
   const recordedAt=this.clock.now().toISOString(),result=this.result(input.id,q.reviewSha256),requestHash=digest(input),family=q.facts.family;
   await tx.query(`INSERT INTO ls_fishing_stage.refund_preparations(workspace_id,id,kind,household_id,payer_account_id,cancellation_id,reservation_id,state,review_sha256,request_sha256,total_refund_cents,actor_id,command_id,recorded_at,payload_ciphertext) VALUES($1,$2,$3,$4,$5,$6,$7,'prepared_only',$8,$9,$10,$11,$12,$13,$14)`,[actor.workspaceId,input.id,input.selection.kind,q.facts.householdId,q.facts.payerAccountId,family?.cancellationId??null,family?.reservationId??null,q.reviewSha256,requestHash,q.facts.members.reduce((n,m)=>n+m.refundCents,0),actor.id,input.operationId,recordedAt,this.encode(actor.workspaceId,'header',input.id,{command:input,facts:q.facts,actorId:actor.id,recordedAt})]);
   for(const member of q.facts.members)await tx.query(`INSERT INTO ls_fishing_stage.refund_preparation_members(workspace_id,preparation_id,purchase_id,child_id,provider_account_id,livemode,original_payment_id,refund_cents) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[actor.workspaceId,input.id,member.input.purchase.purchaseId,member.input.purchase.childId,member.originalPayment.providerAccountId,member.originalPayment.livemode,member.originalPayment.paymentId,member.refundCents]);
   await tx.query(`INSERT INTO ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id,action,request_sha256,result_ciphertext,recorded_at) VALUES($1,$2,$3,'refund.approval.prepare',$4,$5,$6)`,[actor.workspaceId,actor.id,input.operationId,requestHash,this.encode(actor.workspaceId,'receipt',input.operationId,{command:input,result}),recordedAt]);
   const again=await this.quote(tx,actor,input.selection);if(again.reviewSha256!==q.reviewSha256)throw new AppError('CONFLICT');const row=await this.header(tx,actor,input.id);if(!row)throw new AppError('UNAVAILABLE');await this.verify(tx,actor,row,again);return {...result,replayed:false};
  });}catch(error){if(error instanceof AppError||error instanceof FishingProgramError)throw error;if(error&&typeof error==='object'&&'code'in error&&['23505','40001','40P01'].includes(String(error.code)))throw new AppError('CONFLICT');throw new AppError('UNAVAILABLE');}
 }
}
