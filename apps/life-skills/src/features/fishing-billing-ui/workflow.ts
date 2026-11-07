import type {BillingCommand,BillingData,BillingUiPorts,CommandKind,Scope,BillingOperationReceipt} from './model.ts';
import {commandFor,confirmedReceipt,dataScope,scopedData} from './model.ts';

type Operation={scope:Scope;kind:CommandKind;command:BillingCommand};
export type BillingWorkflowState=
 | {phase:'idle'}
 | (Operation&{phase:'submitting'|'unknown'|'checking'|'refreshing'|'refresh_required';receipt?:BillingOperationReceipt})
 | (Operation&{phase:'confirmed';data:BillingData;receipt:BillingOperationReceipt})
 | (Operation&{phase:'conflict';data:BillingData})
 | (Operation&{phase:'rejected';code:'INVALID_REQUEST'|'FORBIDDEN'|'UNAVAILABLE'});
const idle:BillingWorkflowState=Object.freeze({phase:'idle'});
/** Keep this instance for the owner context across panel/dialog remounts. Root
 * must reconcile server operations on navigation; no browser-storage journal. */
export class BillingWorkflow{
 private state:BillingWorkflowState=idle;
 private listeners=new Set<()=>void>();
 private busy=false;
 private latest:BillingData|null=null;
 constructor(readonly ports:BillingUiPorts|null){}
 getSnapshot=()=>this.state;
 getServerSnapshot=()=>idle;
 subscribe=(fn:()=>void)=>{this.listeners.add(fn);return()=>{this.listeners.delete(fn);};};
 private set(state:BillingWorkflowState){this.state=state;for(const f of this.listeners)f();}
 unresolved(){return ['submitting','unknown','checking','refreshing','refresh_required'].includes(this.state.phase);}
 currentFor(base:BillingData){return this.latest&&this.latest.quote.id===base.quote.id&&this.latest.quote.familyId===base.quote.familyId&&this.latest.quote.workspaceId===base.quote.workspaceId&&this.latest.balance.revision>=base.balance.revision?this.latest:base;}
 clear(){if(this.busy||this.unresolved())return false;this.set(idle);return true;}
 async submit(kind:CommandKind,raw:unknown,data:BillingData){
  if(this.busy||this.unresolved()||!this.ports)return false;
  const command=commandFor(kind,raw),scope=dataScope(data),operation={scope,kind,command};
  if(command.quoteId!==scope.quoteId)throw Error('BILLING_SCOPE_MISMATCH');
  if(command.expectedVersion!==data.balance.revision){this.set({...operation,phase:'conflict',data});return false;}
  this.busy=true;this.set({...operation,phase:'submitting'});
  try{
   const result=await (kind==='cash'?this.ports.recordCashDate(command as Parameters<BillingUiPorts['recordCashDate']>[0]):this.ports.reverseCash(command as Parameters<BillingUiPorts['reverseCash']>[0]));
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
}
