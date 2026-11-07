import type {BillingCommand,BillingData,BillingUiPorts,CommandKind,Scope,BillingOperationReceipt} from './model.ts';
import {commandFor,confirmedReceipt,dataScope,scopedData} from './model.ts';
import {cardCommand,cardProjection,cardUnresolved,canStartCard,canDispatchCard,currentCheckoutUrl,type CardClient,type CardContext,type CardProjection} from './card-model.ts';

type Operation={scope:Scope;kind:CommandKind;command:BillingCommand};
type FinancialWorkflowState=
 | {phase:'idle'}
 | (Operation&{phase:'submitting'|'unknown'|'checking'|'refreshing'|'refresh_required';receipt?:BillingOperationReceipt})
 | (Operation&{phase:'confirmed';data:BillingData;receipt:BillingOperationReceipt})
 | (Operation&{phase:'conflict';data:BillingData})
 | (Operation&{phase:'rejected';code:'INVALID_REQUEST'|'FORBIDDEN'|'UNAVAILABLE'});
export type BillingWorkflowState=FinancialWorkflowState&{card?:CardContext};
const idle:BillingWorkflowState=Object.freeze({phase:'idle'});
/** Keep this instance for the owner context across panel/dialog remounts. Root
 * must reconcile server operations on navigation; no browser-storage journal. */
export class BillingWorkflow{
 private state:BillingWorkflowState=idle;
 private listeners=new Set<()=>void>();
 private busy=false;
 private latest:BillingData|null=null;
 constructor(readonly ports:BillingUiPorts|null,readonly cardClient:CardClient|null=null){}
 getSnapshot=()=>this.state;
 getServerSnapshot=()=>idle;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private set(state:FinancialWorkflowState){this.state={...state,...(this.state.card?{card:this.state.card}:{})};for(const f of this.listeners)f();}
 private setCard(card:CardContext){this.state={...this.state,card};for(const f of this.listeners)f();}
 private finishCard(){this.busy=false;this.state={...this.state};for(const f of this.listeners)f();}
 unresolved(){return ['submitting','unknown','checking','refreshing','refresh_required'].includes(this.state.phase)||cardUnresolved(this.state.card);}
 currentFor(base:BillingData){return this.latest&&this.latest.quote.id===base.quote.id&&this.latest.quote.familyId===base.quote.familyId&&this.latest.quote.workspaceId===base.quote.workspaceId&&this.latest.balance.revision>=base.balance.revision?this.latest:base;}
 clear(){if(this.busy||this.unresolved())return false;this.set(idle);return true;}
 async submit(kind:CommandKind,raw:unknown,data:BillingData){
  if(this.busy||this.unresolved()||!this.ports||(kind==='state'&&!this.ports.setState))return false;
  const command=commandFor(kind,raw),scope=dataScope(data),operation={scope,kind,command};
  if(command.quoteId!==scope.quoteId)throw Error('BILLING_SCOPE_MISMATCH');
  if(command.expectedVersion!==data.balance.revision){this.set({...operation,phase:'conflict',data});return false;}
  if(this.state.card)this.setCard({...this.state.card,fresh:false});
  this.busy=true;this.set({...operation,phase:'submitting'});
  try{
   const result=await (kind==='cash'?this.ports.recordCashDate(command as Parameters<BillingUiPorts['recordCashDate']>[0]):kind==='reversal'?this.ports.reverseCash(command as Parameters<BillingUiPorts['reverseCash']>[0]):this.ports.setState!(command as Parameters<NonNullable<BillingUiPorts['setState']>>[0]));
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
 private async accept(operation:Operation,raw:unknown,current:BillingData){
  const receipt=confirmedReceipt(raw,operation.scope,operation.command,operation.kind);
  this.set({...operation,phase:'refreshing',receipt});
  await this.refreshConfirmed(operation,receipt,current);
 }
 private async refreshConfirmed(operation:Operation,receipt:BillingOperationReceipt,current?:BillingData){
  try{
   const data=scopedData(current??await this.ports!.readBalance(operation.scope.quoteId),operation.scope);
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
 canPrepareCard(data:BillingData){return Boolean(this.cardClient&&this.ports&&!this.busy&&!this.unresolved()&&canStartCard(this.state.card,this.currentFor(data)));}
 canCreateCheckout(data:BillingData){return Boolean(this.cardClient&&!this.busy&&!this.unresolved()&&canDispatchCard(this.state.card,this.currentFor(data)));}
 checkoutUrl(data:BillingData){return this.busy||this.unresolved()?null:currentCheckoutUrl(this.state.card,this.currentFor(data));}
 private adoptCard(context:CardContext,raw:CardProjection){
  const projection=cardProjection(raw,context),data=scopedData(projection.current,context.scope);
  if(data.balance.revision<this.currentFor(data).balance.revision)throw Error('STALE_CARD_CURRENT');
  this.latest=data;
  const a=projection.attempt;
  this.setCard({...context,command:context.command??a.command,phase:'ready',lookup:'attempt',projection,fresh:true,checkoutInvoked:context.checkoutInvoked||a.dispatchId!==null||a.sessionId!==null||a.state!=='prepared'});
 }
 async prepareCard(raw:unknown,input:BillingData){
  if(!this.canPrepareCard(input)||!this.cardClient)return false;
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
  const context=this.state.card;
  if(!context||context.attemptId!==attemptId||!this.canCreateCheckout(input)||!this.cardClient)return false;
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
 async readCard(input:BillingData,existingAttemptId?:string){
  if(this.busy||!this.cardClient)return false;
  let context=this.state.card;
  if(existingAttemptId){
   if(this.unresolved()||!input.balance.pendingAttemptIds.includes(existingAttemptId))return false;
   if(context&&context.attemptId!==existingAttemptId&&(!context.projection||!['paid','failed','expired','stale'].includes(context.projection.attempt.state)))return false;
   if(!context||context.attemptId!==existingAttemptId)context={scope:dataScope(input),operationId:existingAttemptId,attemptId:existingAttemptId,command:null,phase:'reading',lookup:'attempt',checkoutInvoked:false,fresh:false};
  }
  if(!context||context.scope.quoteId!==input.quote.id||context.scope.familyId!==input.quote.familyId||context.scope.workspaceId!==input.quote.workspaceId||['submitting','unknown','checking','refreshing','refresh_required'].includes(this.state.phase))return false;
  this.latest=this.currentFor(scopedData(input,context.scope));
  const pending={...context,phase:'reading' as const,fresh:false};this.busy=true;this.set(idle);this.setCard(pending);
  try{
   const result=await (context.lookup==='operation'?this.cardClient.readOperation(context.operationId):this.cardClient.readAttempt(context.attemptId));
   if(result===null)this.setCard({...pending,phase:'unknown'});else{if(context.lookup==='operation'&&result.state!=='prepared')throw Error('CARD_OPERATION_RECEIPT_REQUIRED');this.adoptCard(pending,result);}
  }catch{this.setCard({...pending,phase:'unknown'});}finally{this.finishCard();}
  return true;
 }
}
