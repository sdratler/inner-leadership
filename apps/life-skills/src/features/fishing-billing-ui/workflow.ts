import type {BillingCommand,BillingData,BillingUiPorts,CommandKind,Scope,BillingOperationReceipt,LegacyBillingData} from './owner-model.ts';
import {commandFor,confirmedReceipt,dataScope,scopedData,isGuestPorts,isLegacyData,isGuestData,moneyVersion,verifyCurrentLineage} from './owner-model.ts';
import type {BillingUiPorts as LegacyPorts} from './model.ts';
import type {GuestOwnerSnapshotV3} from '../../lib/fishing-billing-guest-contract-v3.ts';
import {BILLING_DTO_V2} from '../fishing-billing/contracts-v2.ts';
import {cardCommand,cardProjection,cardUnresolved,canStartCard,canDispatchCard,currentCheckoutUrl,type CardClient,type CardContext,type CardProjection} from './card-model.ts';
import {guestCardCommand,guestCardContext,guestCardProjection,guestCardCurrent,guestCardLineage,guestCardUnresolved,isGuestCardPorts,canStartGuestCard,canDispatchGuestCard,guestCheckoutUrl,type GuestCardPorts,type GuestCardContext,type GuestCardProjection} from './owner-card-model-v3.ts';

type Operation={scope:Scope;kind:CommandKind;command:BillingCommand};
type FinancialWorkflowState=
 | {phase:'idle'}
 | (Operation&{phase:'submitting'|'unknown'|'checking'|'refreshing'|'refresh_required';receipt?:BillingOperationReceipt})
 | (Operation&{phase:'confirmed';data:BillingData;receipt:BillingOperationReceipt})
 | (Operation&{phase:'conflict';data:BillingData})
 | (Operation&{phase:'rejected';code:'INVALID_REQUEST'|'FORBIDDEN'|'UNAVAILABLE'});
export type BillingWorkflowState=FinancialWorkflowState&{card?:CardContext;guestCard?:GuestCardContext};
const idle:BillingWorkflowState=Object.freeze({phase:'idle'});
/** Keep this instance for the owner context across panel/dialog remounts. Root
 * must reconcile server operations on navigation; no browser-storage journal. */
export class BillingWorkflow{
 private state:BillingWorkflowState=idle;
 private listeners=new Set<()=>void>();
 private busy=false;
 private latest:BillingData|null=null;
 constructor(readonly ports:BillingUiPorts|null,readonly cardClient:CardClient|null=null,readonly guestCardClient:GuestCardPorts|null=null){}
 getSnapshot=()=>this.state;
 getServerSnapshot=()=>idle;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private set(state:FinancialWorkflowState){this.state={...state,...(this.state.card?{card:this.state.card}:{}),...(this.state.guestCard?{guestCard:this.state.guestCard}:{})};for(const f of this.listeners)f();}
 private setCard(card:CardContext){this.state={...this.state,card};for(const f of this.listeners)f();}
 private setGuestCard(guestCard:GuestCardContext){this.state={...this.state,guestCard};for(const f of this.listeners)f();}
 private finishCard(){this.busy=false;this.state={...this.state};for(const f of this.listeners)f();}
 unresolved(){return ['submitting','unknown','checking','refreshing','refresh_required'].includes(this.state.phase)||cardUnresolved(this.state.card)||guestCardUnresolved(this.state.guestCard);}
 currentFor(base:LegacyBillingData):LegacyBillingData;
 currentFor(base:GuestOwnerSnapshotV3):GuestOwnerSnapshotV3;
 currentFor(base:BillingData):BillingData;
 currentFor(base:BillingData){return this.latest&&this.latest.quote.version===base.quote.version&&this.latest.quote.id===base.quote.id&&this.latest.quote.familyId===base.quote.familyId&&this.latest.quote.workspaceId===base.quote.workspaceId&&this.latest.balance.revision>=base.balance.revision?this.latest:base;}
 clear(){if(this.busy||this.unresolved())return false;this.set(idle);return true;}
 async submit(kind:CommandKind,raw:unknown,data:BillingData){
  if(this.busy||this.unresolved()||!this.ports||(kind==='state'&&!this.ports.setState))return false;
  if(isGuestPorts(this.ports)===isLegacyData(data))return false;
  const command=commandFor(kind,raw),scope=dataScope(data),operation={scope,kind,command};
  if(command.version!==moneyVersion(data))return false;
  if(command.quoteId!==scope.quoteId)throw Error('BILLING_SCOPE_MISMATCH');
  if(command.expectedVersion!==data.balance.revision){this.set({...operation,phase:'conflict',data});return false;}
  if(this.state.card)this.setCard({...this.state.card,fresh:false});
  if(this.state.guestCard)this.setGuestCard({...this.state.guestCard,fresh:false});
  this.busy=true;this.set({...operation,phase:'submitting'});
  try{
   const result=isGuestPorts(this.ports)?await (kind==='cash'?this.ports.recordCashDate(command):kind==='reversal'?this.ports.reverseCash(command):this.ports.setState(command)):await this.legacyMutation(kind,command,this.ports);
   if(result.kind==='confirmed')await this.accept(operation,result.receipt,result.current);
   else if(result.kind==='conflict'){
    const current=scopedData(result.current,scope);
    if(current.balance.revision<this.currentFor(data).balance.revision)throw Error('STALE_BALANCE');
    this.latest=current;this.set({...operation,phase:'conflict',data:current});
   }
   else if(result.kind==='rejected')this.set(result.code==='UNAVAILABLE'?{...operation,phase:'unknown'}:{...operation,phase:'rejected',code:result.code});
   else this.set({...operation,phase:'unknown'});
  }catch{this.set({...operation,phase:'unknown'});}finally{this.busy=false;}
  return true;
 }
 private legacyMutation(kind:CommandKind,command:BillingCommand,ports:LegacyPorts){
  if(command.version!==BILLING_DTO_V2)throw Error('ACCOUNT_COMMAND_VERSION_MISMATCH');
  return kind==='cash'?ports.recordCashDate(command as Parameters<LegacyPorts['recordCashDate']>[0]):kind==='reversal'?ports.reverseCash(command as Parameters<LegacyPorts['reverseCash']>[0]):ports.setState!(command as Parameters<NonNullable<LegacyPorts['setState']>>[0]);
 }
 private async accept(operation:Operation,raw:unknown,current:BillingData){
  const receipt=confirmedReceipt(raw,operation.scope,operation.command,operation.kind);
  this.set({...operation,phase:'refreshing',receipt});
  await this.refreshConfirmed(operation,receipt,current);
 }
 private async refreshConfirmed(operation:Operation,receipt:BillingOperationReceipt,current?:BillingData){
  try{
   const data=scopedData(current??await this.ports!.readBalance(operation.scope.quoteId),operation.scope);
   verifyCurrentLineage(receipt,data);
   if(data.balance.revision<receipt.entityVersion||data.balance.revision<this.currentFor(data).balance.revision)throw Error('STALE_BALANCE');
   this.latest=data;
   this.set({...operation,phase:'confirmed',receipt,data});
  }catch{this.set({...operation,phase:'refresh_required',receipt});}
 }
 async recover(){
  const s=this.state;if(this.busy||s.phase!=='unknown'||!this.ports)return false;
  this.busy=true;this.set({...s,phase:'checking'});
  try{
   const receipt=await this.ports.readOperation(s.command.operationId);
   // null is unresolved, NOT an authoritative negative or permission to retry.
   if(receipt===null)this.set({...s,phase:'unknown'});else await this.accept(s,receipt.receipt,receipt.current);
  }catch{this.set({...s,phase:'unknown'});}finally{this.busy=false;}
  return true;
 }
 async refresh(){
  const s=this.state;if(this.busy||s.phase!=='refresh_required'||!s.receipt||!this.ports)return false;
  this.busy=true;this.set({...s,phase:'refreshing'});
  try{await this.refreshConfirmed(s,s.receipt);}finally{this.busy=false;}return true;
 }
 hasCardClient(data:BillingData){return isGuestData(data)?Boolean(this.ports&&isGuestPorts(this.ports)&&isGuestCardPorts(this.guestCardClient)):Boolean(this.cardClient);}
 cardFor(data:BillingData){return isGuestData(data)?this.state.guestCard:this.state.card;}
 canPrepareCard(data:BillingData){return isGuestData(data)?this.hasCardClient(data)&&!this.busy&&!this.unresolved()&&canStartGuestCard(this.state.guestCard,this.currentFor(data)):isLegacyData(data)&&Boolean(this.cardClient&&this.ports&&!isGuestPorts(this.ports)&&!this.busy&&!this.unresolved()&&canStartCard(this.state.card,this.currentFor(data)));}
 canCreateCheckout(data:BillingData){return isGuestData(data)?this.hasCardClient(data)&&!this.busy&&!this.unresolved()&&canDispatchGuestCard(this.state.guestCard,this.currentFor(data)):isLegacyData(data)&&Boolean(this.cardClient&&(!this.ports||!isGuestPorts(this.ports))&&!this.busy&&!this.unresolved()&&canDispatchCard(this.state.card,this.currentFor(data)));}
 checkoutUrl(data:BillingData){if(this.busy||this.unresolved())return null;return isGuestData(data)?this.hasCardClient(data)?guestCheckoutUrl(this.state.guestCard,this.currentFor(data)):null:!isLegacyData(data)||this.ports&&isGuestPorts(this.ports)?null:currentCheckoutUrl(this.state.card,this.currentFor(data));}
 private adoptGuestCard(context:GuestCardContext,raw:GuestCardProjection){
  const projection=guestCardProjection(raw,context),data=guestCardCurrent(projection.current);
  guestCardLineage(this.currentFor(context.basis),data);
  if(data.balance.revision<this.currentFor(data).balance.revision)throw Error('STALE_GUEST_CARD_CURRENT');
  this.latest=data;const a=projection.attempt;
  this.setGuestCard({...context,command:context.command??a.command,phase:'ready',lookup:'attempt',projection,fresh:true,checkoutInvoked:context.checkoutInvoked||a.dispatchId!==null||a.sessionId!==null||a.state!=='prepared'});
 }
 private adoptGuestConflict(context:GuestCardContext,raw:Parameters<typeof guestCardCurrent>[0]){
  const data=guestCardCurrent(raw);guestCardLineage(context.basis,data);
  guestCardLineage(this.currentFor(context.basis),data);
  if(data.balance.revision<this.currentFor(data).balance.revision)throw Error('STALE_GUEST_CARD_CONFLICT');
  this.latest=data;this.setGuestCard({...context,phase:'conflict',fresh:false});
 }
 private async prepareGuestCard(raw:unknown,input:GuestOwnerSnapshotV3){
  if(!this.canPrepareCard(input)||!isGuestCardPorts(this.guestCardClient))return false;
  const data=this.currentFor(input);let command;try{command=guestCardCommand(raw,data);}catch{return false;}
  const context=guestCardContext(data,command.operationId,command);this.busy=true;this.set(idle);this.setGuestCard(context);
  try{
   const result=await this.guestCardClient.prepare(command);
   if(result.kind==='prepared')this.adoptGuestCard(context,result.data);
   else if(result.kind==='conflict')this.adoptGuestConflict(context,result.current);
   else if(result.kind==='rejected')this.setGuestCard({...context,phase:'rejected',code:result.code});
   else this.setGuestCard({...context,phase:'unknown'});
  }catch{this.setGuestCard({...context,phase:'unknown'});}finally{this.finishCard();}return true;
 }
 private async createGuestCheckout(attemptId:string,input:GuestOwnerSnapshotV3){
  const context=this.state.guestCard;
  if(!context||context.attemptId!==attemptId||!this.canCreateCheckout(input)||!isGuestCardPorts(this.guestCardClient))return false;
  const reserved={...context,phase:'dispatching' as const,lookup:'attempt' as const,checkoutInvoked:true,fresh:false};this.busy=true;this.set(idle);this.setGuestCard(reserved);
  try{
   const result=await this.guestCardClient.createCheckout(attemptId);
   if(result.kind==='attempt')this.adoptGuestCard(reserved,result.data);
   else if(result.kind==='conflict')this.adoptGuestConflict(reserved,result.current);
   else if(result.kind==='rejected')this.setGuestCard({...reserved,phase:'rejected',code:result.code});
   else this.setGuestCard({...reserved,phase:'unknown'});
  }catch{this.setGuestCard({...reserved,phase:'unknown'});}finally{this.finishCard();}return true;
 }
 private adoptCard(context:CardContext,raw:CardProjection){
  const projection=cardProjection(raw,context),data=scopedData(projection.current,context.scope);
  if(data.balance.revision<this.currentFor(data).balance.revision)throw Error('STALE_CARD_CURRENT');
  this.latest=data;
  const a=projection.attempt;
  this.setCard({...context,command:context.command??a.command,phase:'ready',lookup:'attempt',projection,fresh:true,checkoutInvoked:context.checkoutInvoked||a.dispatchId!==null||a.sessionId!==null||a.state!=='prepared'});
 }
 async prepareCard(raw:unknown,input:BillingData){
  if(isGuestData(input))return this.prepareGuestCard(raw,input);
  if(!isLegacyData(input)||!this.canPrepareCard(input)||!this.cardClient)return false;
  const data=this.currentFor(input);let command;
  try{command=cardCommand(raw,data);}catch{return false;}
  const context:CardContext={scope:dataScope(data),operationId:command.operationId,attemptId:command.operationId,command,phase:'preparing',lookup:'operation',checkoutInvoked:false,fresh:false};
  this.busy=true;this.set(idle);this.setCard(context);
  try{
   const result=await this.cardClient.prepare(command);
   if(result.kind==='prepared'&&result.data.state==='prepared')this.adoptCard(context,result.data);
   else if(result.kind==='conflict'){
    const current=scopedData(result.current,context.scope);if(current.balance.revision<this.currentFor(data).balance.revision)throw Error('STALE_CARD_CONFLICT');
    this.latest=current;this.setCard({...context,phase:'conflict'});
   }else if(result.kind==='rejected')this.setCard({...context,phase:'rejected',code:result.code});
   else this.setCard({...context,phase:'unknown'});
  }catch{this.setCard({...context,phase:'unknown'});}finally{this.finishCard();}
  return true;
 }
 async createCardCheckout(attemptId:string,input:BillingData){
  if(isGuestData(input))return this.createGuestCheckout(attemptId,input);
  const context=this.state.card;
  if(!isLegacyData(input)||!context||context.attemptId!==attemptId||!this.canCreateCheckout(input)||!this.cardClient)return false;
  const reserved={...context,phase:'dispatching' as const,lookup:'attempt' as const,checkoutInvoked:true,fresh:false};
  this.busy=true;this.set(idle);this.setCard(reserved);
  try{
   const result=await this.cardClient.createCheckout(attemptId);
   if(result.kind==='attempt'&&result.data.state==='attempt')this.adoptCard(reserved,result.data);
   else if(result.kind==='conflict'){
    const current=scopedData(result.current,reserved.scope);if(current.balance.revision<this.currentFor(input).balance.revision)throw Error('STALE_CARD_CONFLICT');
    this.latest=current;this.setCard({...reserved,phase:'conflict'});
   }else if(result.kind==='rejected')this.setCard({...reserved,phase:'rejected',code:result.code});
   else this.setCard({...reserved,phase:'unknown'});
  }catch{this.setCard({...reserved,phase:'unknown'});}finally{this.finishCard();}
  return true;
 }
 canReadCard(input:BillingData,existingAttemptId?:string):boolean{
  if(isGuestData(input))return this.canReadGuestCard(input,existingAttemptId);
  if(!isLegacyData(input)||this.ports&&isGuestPorts(this.ports)||this.busy||guestCardUnresolved(this.state.guestCard)||!this.cardClient||['submitting','unknown','checking','refreshing','refresh_required'].includes(this.state.phase))return false;
  const context=this.state.card;
  if(existingAttemptId){
   if(this.unresolved()||!input.balance.pendingAttemptIds.includes(existingAttemptId))return false;
   if(context&&context.attemptId!==existingAttemptId&&(!context.projection||!['paid','failed','expired','stale'].includes(context.projection.attempt.state)))return false;
   if(!context||context.attemptId!==existingAttemptId)return true;
  }
  return Boolean(context&&context.scope.quoteId===input.quote.id&&context.scope.familyId===input.quote.familyId&&context.scope.workspaceId===input.quote.workspaceId);
 }
 async readCard(input:BillingData,existingAttemptId?:string){
  if(isGuestData(input))return this.readGuestCard(input,existingAttemptId);
  if(!isLegacyData(input)||!this.canReadCard(input,existingAttemptId)||!this.cardClient)return false;
  let context=this.state.card;
  if(existingAttemptId&&(!context||context.attemptId!==existingAttemptId))context={scope:dataScope(input),operationId:existingAttemptId,attemptId:existingAttemptId,command:null,phase:'reading',lookup:'attempt',checkoutInvoked:false,fresh:false};
  if(!context)return false;
  this.latest=this.currentFor(scopedData(input,context.scope));
  const pending={...context,phase:'reading' as const,fresh:false};this.busy=true;this.set(idle);this.setCard(pending);
  try{
   const result=await (context.lookup==='operation'?this.cardClient.readOperation(context.operationId):this.cardClient.readAttempt(context.attemptId));
   if(result===null)this.setCard({...pending,phase:'unknown'});else{if(context.lookup==='operation'&&result.state!=='prepared')throw Error('CARD_OPERATION_RECEIPT_REQUIRED');this.adoptCard(pending,result);}
  }catch{this.setCard({...pending,phase:'unknown'});}finally{this.finishCard();}
  return true;
 }
 private canReadGuestCard(input:GuestOwnerSnapshotV3,existingAttemptId?:string){
  if(!this.hasCardClient(input)||this.busy||cardUnresolved(this.state.card)||['submitting','unknown','checking','refreshing','refresh_required'].includes(this.state.phase))return false;
  const context=this.state.guestCard;
  if(existingAttemptId){
   if(this.unresolved()||!input.balance.pendingAttemptIds.includes(existingAttemptId))return false;
   if(context&&context.attemptId!==existingAttemptId&&(!context.projection||!['paid','failed','expired','stale'].includes(context.projection.attempt.state)))return false;
   if(!context||context.attemptId!==existingAttemptId)return true;
  }
  return Boolean(context&&context.scope.quoteId===input.quote.id&&context.scope.familyId===input.quote.familyId&&context.scope.workspaceId===input.quote.workspaceId);
 }
 private async readGuestCard(input:GuestOwnerSnapshotV3,existingAttemptId?:string){
  if(!this.canReadGuestCard(input,existingAttemptId)||!isGuestCardPorts(this.guestCardClient))return false;
  let context=this.state.guestCard;
  if(existingAttemptId&&(!context||context.attemptId!==existingAttemptId))context=guestCardContext(input,existingAttemptId,null);
  if(!context)return false;
  const observed=this.currentFor(input);try{guestCardLineage(context.basis,observed);}catch{return false;}this.latest=observed;
  const pending={...context,phase:'reading' as const,fresh:false};this.busy=true;this.set(idle);this.setGuestCard(pending);
  try{
   const result=await (context.lookup==='operation'?this.guestCardClient.readOperation(context.operationId):this.guestCardClient.readAttempt(context.attemptId));
   if(result===null)this.setGuestCard({...pending,phase:'unknown'});else{if(context.lookup==='operation'&&result.state!=='prepared')throw Error('GUEST_PREPARATION_RECEIPT_REQUIRED');this.adoptGuestCard(pending,result);}
  }catch{this.setGuestCard({...pending,phase:'unknown'});}finally{this.finishCard();}return true;
 }
}
