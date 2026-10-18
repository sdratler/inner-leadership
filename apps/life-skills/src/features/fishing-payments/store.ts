import { randomUUID } from 'node:crypto';
import { AppError } from '../../lib/errors.ts';
import { freshActor,lockWorkspace } from '../identity/data.ts';
import { one } from '../identity/store.ts';
import type { Actor,ApprovedOffer,FishingPaymentReadPort,PaymentState } from '../fishing/contract.ts';
import { approvedOffer,digest,familyPayment,id,initialPayment,invariant,type FamilyPaymentView } from './domain.ts';
import type { NativeContext,PaymentDependencies,ProviderOperation,PurchaseRecord } from './ports.ts';

export class FishingPaymentStore implements FishingPaymentReadPort {
 constructor(readonly deps:PaymentDependencies){}
 async read<T>(actor:Actor,work:(c:NativeContext)=>Promise<T>):Promise<T>{return this.deps.database.transaction(async tx=>{const now=this.deps.clock.now();const current=await freshActor(tx,actor,now);return work({tx,actor:current,now});});}
 async command<T>(actor:Actor,commandId:string,action:string,body:unknown,authorize:(c:NativeContext)=>Promise<void>,work:(c:NativeContext)=>Promise<T>):Promise<T>{
  id.parse(commandId);id.parse(action);const hash=digest(body);
  return this.deps.database.transaction(async tx=>{await lockWorkspace(tx,actor.workspaceId);const now=this.deps.clock.now(),current=await freshActor(tx,actor,now),c:NativeContext={tx,actor:current,now};await authorize(c);
   const old=await one<{digest:string;result:T}>(c.tx,'SELECT digest,result_json AS result FROM ls_fishing_payments.commands WHERE workspace_id=$1 AND actor_id=$2 AND action=$3 AND command_id=$4',[c.actor.workspaceId,c.actor.id,action,commandId]);
   if(old){invariant(old.digest===hash,'COMMAND_CONFLICT');return old.result;}
   const result=await work(c);await c.tx.query('INSERT INTO ls_fishing_payments.commands(workspace_id,actor_id,action,command_id,digest,result_json,created_at) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7)',[c.actor.workspaceId,c.actor.id,action,commandId,hash,JSON.stringify(result),c.now]);return result;
  });
 }
 async access(c:NativeContext,o:ApprovedOffer,action:'read'|'issue'|'hosted'|'refund'|'reminder',operatorOnly=false){
  invariant(c.actor.workspaceId===o.workspaceId,'NOT_FOUND');
  const operator=c.actor.role==='practitioner'&&c.actor.id===o.operatorAccountId,parent=c.actor.role==='parent'&&c.actor.id===o.payerAccountId;
  invariant(operator||!operatorOnly&&parent,'NOT_FOUND');
  invariant(await this.deps.authority.authorize(c.tx,c.actor,o,action),'NOT_FOUND');
 }
 /** Temporary denial only; call after fresh actor/workspace/offer access.
  * Neither legacy campaign policy nor a caller flag grants founder activation. */
 async assertHostedActivationAllowed(c:NativeContext,offer:ApprovedOffer,campaignId?:string|null):Promise<void>{
  invariant(c.actor.workspaceId===offer.workspaceId,'NOT_FOUND');
  const existing=await one<{campaignId:string|null}>(c.tx,'SELECT campaign_id AS "campaignId" FROM ls_fishing_payments.offers WHERE workspace_id=$1 AND id=$2',[c.actor.workspaceId,offer.id]);
  invariant(!offer.lines.some(line=>line.discountBasis.startsWith('founder_'))&&(existing?.campaignId??null)===null,'FOUNDER_ACTIVATION_BLOCKED');
  if(campaignId!==undefined&&campaignId!==null){
   id.parse(campaignId);const campaign=await one(c.tx,'SELECT id FROM ls_fishing_payments.campaigns WHERE workspace_id=$1 AND id=$2',[c.actor.workspaceId,campaignId]);invariant(campaign,'NOT_FOUND');
   invariant(false,'FOUNDER_ACTIVATION_BLOCKED');
  }
 }
 async loadOffer(c:NativeContext,offerId:string):Promise<{offer:ApprovedOffer;state:string}>{
  id.parse(offerId);const row=await one<{offer:unknown;digest:string;state:string}>(c.tx,'SELECT offer_json AS offer,digest,state FROM ls_fishing_payments.offers WHERE workspace_id=$1 AND id=$2',[c.actor.workspaceId,offerId]);
  invariant(row,'NOT_FOUND');const offer=approvedOffer(row.offer);invariant(digest(offer)===row.digest,'OFFER_CORRUPT');return {offer,state:row.state};
 }
 async purchase(c:NativeContext,purchaseId:string):Promise<PurchaseRecord>{
  id.parse(purchaseId);const row=await one<{state:PaymentState;lineId:string;revision:number}>(c.tx,'SELECT state_json AS state,line_id AS "lineId",revision FROM ls_fishing_payments.purchases WHERE workspace_id=$1 AND id=$2',[c.actor.workspaceId,purchaseId]);
  invariant(row,'NOT_FOUND');const {offer}=await this.loadOffer(c,row.state.offerId),line=offer.lines.find(l=>l.id===row.lineId);
  invariant(line&&row.state.purchaseId===purchaseId&&row.state.workspaceId===c.actor.workspaceId&&row.revision===row.state.revision&&row.state.originalTotalCents===line.totalCents&&row.state.currency==='USD','PURCHASE_CORRUPT');
  invariant(row.state.dues.length===line.dues.length&&row.state.dues.every((d,i)=>d.id===line.dues[i]?.id&&d.index===line.dues[i]?.index&&d.amountCents===line.dues[i]?.amountCents),'DUE_CORRUPT');
  return {offer,line,state:row.state};
 }
 async save(c:NativeContext,old:PaymentState,next:PaymentState){
  invariant(next.revision===old.revision+1,'REVISION');
  const rows=await c.tx.query('UPDATE ls_fishing_payments.purchases SET revision=$4,state_json=$5::jsonb WHERE workspace_id=$1 AND id=$2 AND revision=$3 RETURNING id',[c.actor.workspaceId,old.purchaseId,old.revision,next.revision,JSON.stringify(next)]);invariant(rows.length===1,'CONFLICT');
  await this.event(c,'payment.reconciled',next.purchaseId,next.revision);
 }
 async event(c:NativeContext,topic:string,aggregateId:string,revision:number){await c.tx.query('INSERT INTO ls_fishing_payments.outbox(id,workspace_id,topic,aggregate_id,revision,recorded_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[randomUUID(),c.actor.workspaceId,topic,aggregateId,revision,c.now]);}
 async registerApprovedOffer(actor:Actor,commandId:string,offerId:string,revision:number,campaignId:string|null=null):Promise<{purchaseIds:string[]}>{
  let o:ApprovedOffer;
  const authorize=async(c:NativeContext)=>{const canonical=await this.deps.authority.loadApprovedOffer(c.tx,c.actor,offerId);invariant(canonical,'NOT_FOUND');o=approvedOffer(canonical);invariant(o.revision===revision,'CONFLICT');await this.access(c,o,'issue',true);await this.assertHostedActivationAllowed(c,o,campaignId);};
  return this.command(actor,commandId,'offer.issue',{offerId,revision,campaignId},authorize,async c=>{
   const merchant=this.deps.merchant;invariant(merchant?.verifiedBindingId,'MERCHANT_BINDING_REQUIRED');invariant(Date.parse(o.expiresAt)>c.now.getTime(),'OFFER_EXPIRED');
   const old=await one<{digest:string}>(c.tx,'SELECT digest FROM ls_fishing_payments.offers WHERE workspace_id=$1 AND id=$2',[c.actor.workspaceId,o.id]);
   if(old){invariant(old.digest===digest(o),'IMMUTABLE_OFFER');const rows=await c.tx.query<{id:string}>('SELECT id FROM ls_fishing_payments.purchases WHERE workspace_id=$1 AND offer_id=$2 ORDER BY id',[c.actor.workspaceId,o.id]);return {purchaseIds:rows.map(x=>x.id)};}
   await c.tx.query('INSERT INTO ls_fishing_payments.offers(workspace_id,id,revision,digest,offer_json,campaign_id,state) VALUES($1,$2,$3,$4,$5::jsonb,$6,\'approved\')',[c.actor.workspaceId,o.id,o.revision,digest(o),JSON.stringify(o),campaignId]);
   const purchaseIds=[];for(const l of o.lines){const purchaseId=randomUUID(),state=initialPayment(o,l,purchaseId,merchant);purchaseIds.push(purchaseId);await c.tx.query('INSERT INTO ls_fishing_payments.purchases(workspace_id,id,offer_id,line_id,revision,state_json) VALUES($1,$2,$3,$4,1,$5::jsonb)',[o.workspaceId,purchaseId,o.id,l.id,JSON.stringify(state)]);await this.event(c,'offer.issued',purchaseId,1);}return {purchaseIds};
  });
 }
 async operation(c:NativeContext,operationId:string):Promise<ProviderOperation>{const row=await one<{operation:ProviderOperation}>(c.tx,'SELECT operation_json AS operation FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND id=$2',[c.actor.workspaceId,operationId]);invariant(row,'NOT_FOUND');return row.operation;}
 async hasUnknown(c:NativeContext,purchaseId:string):Promise<boolean>{const rows=await c.tx.query<{operation:ProviderOperation}>('SELECT operation_json AS operation FROM ls_fishing_payments.operations WHERE workspace_id=$1 AND purchase_id=$2',[c.actor.workspaceId,purchaseId]);return rows.some(r=>r.operation.state==='unknown');}
 private async concealed<T>(work:()=>Promise<T>):Promise<T|null>{try{return await work();}catch(e){if(e instanceof Error&&e.message==='NOT_FOUND'||e instanceof AppError&&e.code==='UNAUTHENTICATED')return null;throw e;}}
 async resolveApprovedOffer(actor:Actor,offerId:string):Promise<ApprovedOffer|null>{return this.concealed(()=>this.read(actor,async c=>{const {offer,state}=await this.loadOffer(c,offerId);await this.access(c,offer,'read');if(state!=='approved'||Date.parse(offer.expiresAt)<=c.now.getTime())return null;return offer;}));}
 async readPayment(actor:Actor,purchaseId:string):Promise<PaymentState|null>{return this.concealed(()=>this.read(actor,async c=>{const p=await this.purchase(c,purchaseId);await this.access(c,p.offer,'read',true);return await this.hasUnknown(c,purchaseId)?{...p.state,state:'reconciliation_required'}:p.state;}));}
 async familyView(actor:Actor,purchaseId:string):Promise<FamilyPaymentView>{return this.read(actor,async c=>{const p=await this.purchase(c,purchaseId);await this.access(c,p.offer,'read');return familyPayment(await this.hasUnknown(c,purchaseId)?{...p.state,state:'reconciliation_required'}:p.state);});}
}
