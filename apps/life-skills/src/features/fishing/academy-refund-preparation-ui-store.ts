import 'server-only';
import {z} from 'zod';
import {AppError} from '../../lib/errors.ts';
import {digest,type MerchantBinding} from '../fishing-payments/domain.ts';
import {one,type IdentityStore,type SqlSession} from '../identity/store.ts';
import {seal,unseal} from '../identity/crypto.ts';
import type {IdentityConfig} from '../identity/config.ts';
import {systemClock,type Actor,type IdentityClock} from '../identity/types.ts';
import type {AcademyFamilyStore} from './academy-family-store.ts';
import {AcademyRefundStore} from './academy-refund-store.ts';
import {AcademyRefundPreparationStore} from './academy-refund-preparation-store.ts';
import {FishingProgramError} from './native-program-contract.ts';
import {refundPreparationResultSchema,type RefundPreparationSelection} from './academy-refund-preparation-contract.ts';
import {refundPreparationUiCommandSchema,type RefundPreparationUiContext,type RefundPreparationUiOption,type RefundPreparationUiCommand} from './academy-refund-preparation-ui-contract.ts';
import type {AcademyRefundUiContext} from './academy-refund-ui-contract.ts';
const receiptSchema=z.strictObject({command:refundPreparationUiCommandSchema,result:refundPreparationResultSchema});
type Ready=Extract<AcademyRefundUiContext,{state:'ready'}>;
/** Current ordinary family binding plus the separate reviewed native preparation.
 * No provider transport, dispatch operation, legal approval or admission switch. */
export class AcademyRefundPreparationUiStore{
 constructor(private readonly db:IdentityStore,private readonly config:IdentityConfig,private readonly family:AcademyFamilyStore,private readonly merchant:MerchantBinding|null=null,private readonly clock:IdentityClock=systemClock){}
 private guard(actor:Actor){if(actor.workspaceId!==this.config.workspaceId||actor.role!=='practitioner')throw new AppError('FORBIDDEN');}
 private native(tx:SqlSession){return new AcademyRefundPreparationStore({transaction:work=>work(tx)},this.config,this.merchant,this.clock);}
 private source(actor:Actor,applicationId:string){this.guard(actor);return new AcademyRefundStore(this.db,this.config,this.family,this.merchant,this.clock).context(actor,applicationId);}
 private selections(source:Ready){return [...source.purchases.map(p=>({kind:'purchase' as const,purchaseId:p.id})),...source.groups.map(g=>({kind:'family' as const,cancellationId:g.id}))];}
 private ids(source:Ready,selection:RefundPreparationSelection){if(selection.kind==='purchase'){if(!source.purchases.some(p=>p.id===selection.purchaseId))throw new AppError('NOT_FOUND');return [selection.purchaseId];}const group=source.groups.find(g=>g.id===selection.cancellationId);if(!group)throw new AppError('NOT_FOUND');return group.members.map(m=>m.purchaseId);}
 private async authorize(tx:SqlSession,actor:Actor,source:Ready,selection?:RefundPreparationSelection){const saved=await this.family.readForEnrollmentInTransaction(tx,actor,source.binding);if(selection){const ids=this.ids(source,selection);if(ids.some(id=>!source.purchases.some(p=>p.id===id&&saved.children.some(c=>c.learnerId===p.childId))))throw new AppError('NOT_FOUND');}return saved;}
 private aad(actor:Actor,id:string,hash:string){return `academy-refund-preparation-ui:v1:${actor.workspaceId}:${actor.id}:${id}:${hash}`;}
 async context(actor:Actor,applicationId:string):Promise<RefundPreparationUiContext>{
  const source=await this.source(actor,applicationId);if(source.state!=='ready')return source;
  return this.db.transaction(async tx=>{await this.authorize(tx,actor,source);const native=this.native(tx),options:RefundPreparationUiOption[]=[];
   for(const selection of this.selections(source)){await this.authorize(tx,actor,source,selection);const ids=this.ids(source,selection),members=ids.map(id=>{const p=source.purchases.find(p=>p.id===id)!;return {purchaseId:p.id,childId:p.childId,displayName:p.displayName};});let review:RefundPreparationUiOption['review']=null,saved:RefundPreparationUiOption['saved']=null,blocked:RefundPreparationUiOption['blocked']=null;
    try{review=await native.preview(actor,selection);if(digest(review.members.map(m=>m.purchaseId).sort())!==digest([...ids].sort()))throw new AppError('UNAVAILABLE');const rows=await tx.query<{id:string;kind:string;cancellationId:string|null}>(`SELECT DISTINCT h.id,h.kind,h.cancellation_id AS "cancellationId" FROM ls_fishing_stage.refund_preparations h JOIN ls_fishing_stage.refund_preparation_members m ON m.workspace_id=h.workspace_id AND m.preparation_id=h.id WHERE h.workspace_id=$1 AND m.purchase_id=ANY($2::uuid[])`,[actor.workspaceId,ids]);if(rows.length){const row=rows[0]!;if(rows.length!==1||row.kind!==selection.kind||selection.kind==='family'&&row.cancellationId!==selection.cancellationId){blocked='stale_preparation';review=null;}else saved=await native.read(actor,row.id);}}
    catch(error){if(error instanceof FishingProgramError&&['POLICY_REQUIRED','APPROVAL_REQUIRED'].includes(error.code)){review=null;blocked='policy_required';}else if(error instanceof AppError&&error.code==='CONFLICT'){review=null;blocked='stale_preparation';}else throw error;}
    options.push({selection,members,review,saved,blocked});
   }await this.authorize(tx,actor,source);return {state:'ready',binding:source.binding,options,effect:'none',execution:'denied'};
  });
 }
 async execute(actor:Actor,raw:unknown){const parsed=refundPreparationUiCommandSchema.safeParse(raw);if(!parsed.success)throw new AppError('INVALID_REQUEST');this.guard(actor);if(!this.merchant)throw new AppError('UNAVAILABLE');const command:RefundPreparationUiCommand=parsed.data,source=await this.source(actor,command.binding.applicationId);if(source.state!=='ready'||digest(source.binding)!==digest(command.binding))throw new AppError('CONFLICT');
  try{return await this.db.transaction(async tx=>{await this.authorize(tx,actor,source,command.command.selection);const native=this.native(tx),review=await native.preview(actor,command.command.selection);if(review.reviewSha256!==command.command.expectedReviewSha256)throw new AppError('CONFLICT');const hash=digest(command),action='refund.preparation.ui',old=await one<{action:string;hash:string;ciphertext:string}>(tx,`SELECT action,request_sha256 AS hash,result_ciphertext AS ciphertext FROM ls_fishing_stage.command_receipts WHERE workspace_id=$1 AND actor_id=$2 AND command_id=$3 FOR SHARE`,[actor.workspaceId,actor.id,command.operationId]);let previous:z.infer<typeof refundPreparationResultSchema>|null=null;
   if(old){if(old.action!==action||old.hash!==hash)throw new AppError('CONFLICT');const receipt=receiptSchema.parse(JSON.parse(unseal(old.ciphertext,this.aad(actor,command.operationId,hash),this.config.keyring)));if(digest(receipt.command)!==hash)throw new AppError('UNAVAILABLE');previous=receipt.result;}
   const {replayed,...nativeResult}=await native.prepare(actor,command.command),result=refundPreparationResultSchema.parse(nativeResult);await this.authorize(tx,actor,source,command.command.selection);if(previous){if(digest(previous)!==digest(result))throw new AppError('UNAVAILABLE');return {...result,replayed:true};}
   if(replayed)throw new AppError('CONFLICT');const ciphertext=seal(JSON.stringify({command,result}),this.aad(actor,command.operationId,hash),this.config.keyring);await tx.query(`INSERT INTO ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id,action,request_sha256,result_ciphertext,recorded_at) VALUES($1,$2,$3,$4,$5,$6,$7)`,[actor.workspaceId,actor.id,command.operationId,action,hash,ciphertext,this.clock.now()]);return {...result,replayed:false};
  });}catch(error){if(error instanceof AppError||error instanceof FishingProgramError)throw error;if(error&&typeof error==='object'&&'code'in error&&['23505','40001','40P01'].includes(String(error.code)))throw new AppError('CONFLICT');throw new AppError('UNAVAILABLE');}
 }
}
