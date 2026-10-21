import 'server-only';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {digest,type MerchantBinding} from '../fishing-payments/domain.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import {seal,unseal} from '../identity/crypto.ts';
import type {IdentityConfig} from '../identity/config.ts';
import {systemClock,type Actor,type IdentityClock} from '../identity/types.ts';
import {NativeFishingProgram} from './native-program.ts';
import {FishingProgramError} from './native-program-contract.ts';
import type {AcademyFamilyStore} from './academy-family-store.ts';
import type {AcademyFamilySaved} from './academy-family-contract.ts';
import type {AcademyOwnerEnrollmentBinding} from './academy-enrollment-contract.ts';
import {academyRefundUiCommandSchema,type AcademyRefundUiContext,type AcademyRefundPurchaseView,type AcademyRefundGroupView,type AcademyRefundProposalView} from './academy-refund-ui-contract.ts';
const resultSchema=z.strictObject({id:z.uuid(),revision:z.literal(1),state:z.enum(['cancellation_group','family_fee_reserved'])});
const receiptSchema=z.strictObject({command:academyRefundUiCommandSchema,result:resultSchema});
/** Ordinary owner projection and intent persistence only. The reviewed runtime
 * supplies a merchant or null; this store has no provider transport or importer. */
export class AcademyRefundStore{
 constructor(private readonly db:IdentityStore,private readonly config:IdentityConfig,private readonly family:AcademyFamilyStore,private readonly merchant:MerchantBinding|null=null,private readonly clock:IdentityClock=systemClock){}
 private program(tx:SqlSession){return new NativeFishingProgram({transaction:work=>work(tx)},this.config.keyring,{childAccountsEnabled:false,merchant:this.merchant},this.clock);}
 private async saved(tx:SqlSession,actor:Actor,binding:AcademyOwnerEnrollmentBinding){if(actor.workspaceId!==this.config.workspaceId||actor.role!=='practitioner')throw new AppError('FORBIDDEN');return this.family.readForEnrollmentInTransaction(tx,actor,binding);}
 private async purchases(tx:SqlSession,actor:Actor,saved:AcademyFamilySaved){
  const rows=await tx.query<{id:string;childId:string}>(`SELECT DISTINCT p.id,s.learner_id AS "childId" FROM ls_fishing_payments.purchases p JOIN ls_fishing_stage.seat_reservations s ON s.workspace_id=p.workspace_id AND s.offer_id=p.offer_id WHERE p.workspace_id=$1 AND s.learner_id=ANY($2::uuid[]) AND s.state<>'released' ORDER BY p.id,s.learner_id LIMIT 101`,[actor.workspaceId,saved.children.map(c=>c.learnerId)]);if(rows.length>100)throw new AppError('UNAVAILABLE');
  const program=this.program(tx),result:AcademyRefundPurchaseView[]=[];
  for(const row of rows){const child=saved.children.find(c=>c.learnerId===row.childId);if(!child)throw new AppError('UNAVAILABLE');const group=await program.academyBillingStageInTransaction(tx,actor,{learnerId:child.learnerId,householdId:saved.householdId,parentAccountId:saved.parentAccountId},row.id);if(!group)continue;
   let proposal:AcademyRefundProposalView;
   try{const p=await program.previewOwner03Refund(actor,{purchaseId:row.id,reason:'voluntary'});proposal=p.status==='PROPOSAL_ONLY'?{state:'proposal',paidCents:p.paidCents,attendedCount:p.attendedCount,retainedLessonCents:p.retainedLessonCents,administrationCents:p.administrationCents,refundCents:p.refundCents}:p.status==='RECONCILIATION_REQUIRED'?{state:'reconciliation_required',reason:p.reason}:{state:'policy_required',reason:p.reason};}
   catch(e){if(e instanceof FishingProgramError&&['POLICY_REQUIRED','APPROVAL_REQUIRED'].includes(e.code))proposal={state:'not_ready',reason:'paid_native_facts_required'};else throw e;}
   if(result.some(p=>p.id===row.id))throw new AppError('UNAVAILABLE');result.push({id:row.id,childId:child.learnerId,displayName:child.displayName,stageId:group.stageId,stageLabel:group.label,proposal});
  }return result;
 }
 private async groupRow(tx:SqlSession,actor:Actor,saved:AcademyFamilySaved,id:string){const row=await one<{id:string;purchaseIds:string[]}>(tx,`SELECT id,purchase_ids AS "purchaseIds" FROM ls_fishing_stage.refund_cancellations WHERE workspace_id=$1 AND id=$2 AND household_id=$3 AND payer_account_id=$4 FOR SHARE`,[actor.workspaceId,id,saved.householdId,saved.parentAccountId]);if(!row)throw new AppError('NOT_FOUND');return row;}
 private async assertPurchases(tx:SqlSession,actor:Actor,saved:AcademyFamilySaved,ids:readonly string[]){
  const program=this.program(tx);for(const id of ids){let match=false;for(const child of saved.children){const group=await program.academyBillingStageInTransaction(tx,actor,{learnerId:child.learnerId,householdId:saved.householdId,parentAccountId:saved.parentAccountId},id);if(group){match=true;break;}}if(!match)throw new AppError('NOT_FOUND');}
 }
 async context(actor:Actor,applicationId:string):Promise<AcademyRefundUiContext>{
  if(actor.workspaceId!==this.config.workspaceId||actor.role!=='practitioner')throw new AppError('FORBIDDEN');const source=await this.family.context(actor,applicationId);if(source.state!=='ready'||!source.saved)return {state:'not_ready'};
  const binding={applicationId,personId:source.personId,expectedEpoch:source.expectedEpoch,expectedAssociationVersion:source.expectedAssociationVersion,expectedFieldsDigest:source.fieldsDigest,expectedFamilyDigest:createHash('sha256').update(JSON.stringify(source.saved)).digest('hex')};
  return this.db.transaction(async tx=>{const saved=await this.saved(tx,actor,binding);if(!this.merchant)return {state:'not_admitted'};const purchases=await this.purchases(tx,actor,saved),program=this.program(tx),rows=await tx.query<{id:string}>(`SELECT id FROM ls_fishing_stage.refund_cancellations WHERE workspace_id=$1 AND household_id=$2 AND payer_account_id=$3 ORDER BY recorded_at,id LIMIT 101`,[actor.workspaceId,saved.householdId,saved.parentAccountId]);if(rows.length>100)throw new AppError('UNAVAILABLE');const groups:AcademyRefundGroupView[]=[];
   for(const row of rows){const group=await this.groupRow(tx,actor,saved,row.id);await this.assertPurchases(tx,actor,saved,group.purchaseIds);const read=await program.readOwner03FamilyCancellation(actor,row.id),members=group.purchaseIds.map(id=>{const p=purchases.find(p=>p.id===id);if(!p)throw new AppError('UNAVAILABLE');const child='children'in read?read.children.find(c=>c.references.purchaseId===id):undefined;return {purchaseId:id,childId:p.childId,displayName:p.displayName,...(child?{administrationCents:child.administrationCents,refundCents:child.refundCents}:{})};});
    groups.push({id:row.id,state:read.status==='ALLOCATION_REQUIRED'?'allocation_required':read.status==='RESERVED_PROPOSAL_ONLY'?'reserved':read.status==='RECONCILIATION_REQUIRED'?'reconciliation_required':'policy_required',...('reason'in read?{reason:read.reason}:{}),...('reviewSha256'in read?{reviewSha256:read.reviewSha256}:{}),...('totalRefundCents'in read?{totalRefundCents:read.totalRefundCents}:{}),familyFeeCents:20000,members});
   }await this.saved(tx,actor,binding);return {state:'ready',binding,purchases,groups,effect:'none',providerApproval:'not_admitted'};
  });
 }
 private aad(actor:Actor,id:string,hash:string){return `academy-refund-ui:v1:${actor.workspaceId}:${actor.id}:${id}:${hash}`;}
 async execute(actor:Actor,raw:unknown){const parsed=academyRefundUiCommandSchema.safeParse(raw);if(!parsed.success)throw new AppError('INVALID_REQUEST');const command=parsed.data;
  if(actor.workspaceId!==this.config.workspaceId||actor.role!=='practitioner')throw new AppError('FORBIDDEN');if(!this.merchant)throw new AppError('UNAVAILABLE');
  try{return await this.db.transaction(async tx=>{
   const authorize=async()=>{const saved=await this.saved(tx,actor,command.binding),ids=command.action==='create_family'?command.purchaseIds:(await this.groupRow(tx,actor,saved,command.cancellationId)).purchaseIds;await this.assertPurchases(tx,actor,saved,ids);return saved;},saved=await authorize(),hash=digest(command),action=`academy.refund.${command.action}`;
   const old=await one<{action:string;hash:string;ciphertext:string}>(tx,`SELECT action,request_sha256 AS hash,result_ciphertext AS ciphertext FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND actor_id=$2 AND command_id=$3 FOR SHARE`,[actor.workspaceId,actor.id,command.operationId]);let previous:z.infer<typeof resultSchema>|null=null;
   if(old){if(old.action!==action||old.hash!==hash)throw new AppError('CONFLICT');const receipt=receiptSchema.parse(JSON.parse(unseal(old.ciphertext,this.aad(actor,command.operationId,hash),this.config.keyring)));if(digest(receipt.command)!==hash)throw new AppError('UNAVAILABLE');previous=receipt.result;}
   else if(await one(tx,'SELECT command_id FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND actor_id=$2 AND command_id=$3',[actor.workspaceId,actor.id,command.nativeCommandId]))throw new AppError('CONFLICT');
   const program=this.program(tx),native=command.action==='create_family'?await program.createOwner03FamilyCancellation(actor,{commandId:command.nativeCommandId,id:command.cancellationId,householdId:saved.householdId,payerAccountId:saved.parentAccountId,purchaseIds:command.purchaseIds,requestReference:command.requestReference}):await program.reserveOwner03FamilyFee(actor,{commandId:command.nativeCommandId,id:command.reservationId,cancellationId:command.cancellationId,expectedRevision:1,expectedPreviewSha256:command.expectedPreviewSha256,feeAllocation:command.feeAllocation});
   const result=resultSchema.parse({id:native.id,revision:native.revision,state:native.state});await authorize();if(previous){if(digest(previous)!==digest(result))throw new AppError('UNAVAILABLE');return {...result,replayed:true};}
   const ciphertext=seal(JSON.stringify({command,result}),this.aad(actor,command.operationId,hash),this.config.keyring);if(Buffer.byteLength(ciphertext)>100000)throw new AppError('INVALID_REQUEST');await tx.query(`INSERT INTO ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id,action,request_sha256,result_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,[actor.workspaceId,actor.id,command.operationId,action,hash,ciphertext,this.clock.now()]);return {...result,replayed:false};
  });}catch(e){if(e instanceof AppError||e instanceof FishingProgramError)throw e;if(e&&typeof e==='object'&&'code'in e&&['23505','40001','40P01'].includes(String(e.code)))throw new AppError('CONFLICT');throw new AppError('UNAVAILABLE');}
 }
}
