import {BILLING_SERVICE_V4} from '../fishing-billing/guest-service-contract-v4.ts';
import type {ServiceOwnerSnapshotV4} from '../fishing-billing/guest-service-owner-financial-contract-v4.ts';
import type {OwnerServiceReadV4} from '../../lib/fishing-billing-owner-contract-v4.ts';
import {freezeServiceOwnerV4,preservedServiceOwnerOperationV4,scopedServiceOwnerReadV4,serviceOwnerClientScopeV4,
 type FishingBillingOwnerClientV4,type PreparedServiceOwnerOperationV4,type ServiceOwnerClientScopeV4,type ServiceOwnerOperationResultV4} from '../../lib/fishing-billing-owner-client-v4.ts';
import {serviceOwnerDataV4,serviceOwnerProgressV4} from './service-owner-model-v4.ts';

export type ServiceOwnerWorkflowStateV4=
 | {phase:'idle'|'inactive'}
 | {phase:'submitting'|'recovering';pending:PreparedServiceOwnerOperationV4}
 | {phase:'unknown';pending:PreparedServiceOwnerOperationV4;lastRecovery?:'unresolved'|'rejected_current_attempt'|'not_sent'|'unavailable'}
 | {phase:'not_sent';pending:PreparedServiceOwnerOperationV4;code:'INVALID_REQUEST'|'FORBIDDEN'|'UNAVAILABLE'}
 | {phase:'rejected_current_attempt';pending:PreparedServiceOwnerOperationV4;code:Extract<OwnerServiceReadV4,{state:'rejected_current_attempt'}>['code']}
 | {phase:'confirmed';pending:PreparedServiceOwnerOperationV4;data:Extract<OwnerServiceReadV4,{state:'confirmed'}>};
type Ports=Pick<FishingBillingOwnerClientV4,'version'|'scope'|'execute'|'recover'>;
const idle:ServiceOwnerWorkflowStateV4=Object.freeze({phase:'idle'});
/** Retain per authenticated owner/offer context across dialog remounts. Root
 * must retain/recover the original command on navigation; no browser-storage
 * journal or new ledger is introduced. Absent ports keep mutations disabled. */
export class ServiceOwnerBillingWorkflowV4{
 readonly version=BILLING_SERVICE_V4;
 readonly scope:Readonly<ServiceOwnerClientScopeV4>;
 private state:ServiceOwnerWorkflowStateV4=idle;
 private listeners=new Set<()=>void>();private busy=false;private active=true;
 private latest:ServiceOwnerSnapshotV4|null=null;private used=new Set<string>();private controller:AbortController|null=null;
 constructor(scope:ServiceOwnerClientScopeV4,private readonly ports:Ports|null,resumeOriginal?:PreparedServiceOwnerOperationV4){
  this.scope=serviceOwnerClientScopeV4(scope);
  if(ports&&(ports.version!==BILLING_SERVICE_V4||JSON.stringify(serviceOwnerClientScopeV4(ports.scope))!==JSON.stringify(this.scope)))throw Error('SERVICE_PORT_SCOPE');
  if(resumeOriginal){const pending=preservedServiceOwnerOperationV4(resumeOriginal);if(pending.operation.command.quoteId!==this.scope.quoteId)throw Error('SERVICE_RESUME_SCOPE');
   this.used.add(pending.operation.command.operationId);this.state=freezeServiceOwnerV4({phase:'unknown',pending});}
 }
 getSnapshot=()=>this.state;
 getServerSnapshot=()=>idle;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private set(state:ServiceOwnerWorkflowStateV4){this.state=freezeServiceOwnerV4(state);for(const listener of this.listeners){try{listener();}catch{/* A rendering subscriber cannot change a financial outcome. */}}}
 unresolved(){return this.state.phase==='unknown'||this.state.phase==='submitting'||this.state.phase==='recovering';}
 clear(){if(!this.active||this.busy||this.unresolved())return false;this.set(idle);return true;}
 currentFor(raw:unknown){
  if(!this.active||this.unresolved())return null;const base=serviceOwnerDataV4(raw,this.scope);
  if(!this.latest)return base;
  if(this.latest.quote.revision>=base.quote.revision){serviceOwnerProgressV4(base,this.latest);return this.latest;}
  serviceOwnerProgressV4(this.latest,base);this.latest=base;return base;
 }
 async submit(raw:PreparedServiceOwnerOperationV4,basis:unknown){
  if(!this.active||this.busy||this.unresolved()||!this.ports)return false;
  let pending:PreparedServiceOwnerOperationV4,data:ServiceOwnerSnapshotV4;
  try{
   pending=preservedServiceOwnerOperationV4(raw);data=serviceOwnerDataV4(basis,this.scope);if(this.latest)serviceOwnerProgressV4(this.latest,data);
   const op=pending.operation,expected=op.action==='state'?op.command.expectedQuoteRevision:op.command.expectedVersion;
   if(op.command.quoteId!==this.scope.quoteId||expected!==data.quote.revision||this.used.has(op.command.operationId))return false;
  }catch{return false;}
  this.used.add(pending.operation.command.operationId);this.latest=data;this.busy=true;const controller=new AbortController();this.controller=controller;
  this.set({phase:'submitting',pending});
  try{
   const result=await this.ports.execute(pending,controller.signal);if(!this.active)return true;
   this.accept(result,pending,false);
  }catch{if(this.active)this.set({phase:'unknown',pending});}
  finally{this.busy=false;if(this.controller===controller)this.controller=null;}
  return true;
 }
 private accept(result:ServiceOwnerOperationResultV4,pending:PreparedServiceOwnerOperationV4,recovery:boolean){
  if(result.kind==='confirmed'){
   const data=scopedServiceOwnerReadV4(result.data,this.scope,pending);if(data.state!=='confirmed')throw Error('SERVICE_CONFIRMATION_REQUIRED');
   const current=serviceOwnerDataV4(data.current,this.scope);if(this.latest)serviceOwnerProgressV4(this.latest,current);
   this.latest=current;this.set({phase:'confirmed',pending,data:{...data,current}});return;
  }
  if(result.kind==='rejected_current_attempt'||result.kind==='unresolved'){
   const data=scopedServiceOwnerReadV4(result.data,this.scope,pending);
   if(data.state!==result.kind)throw Error('SERVICE_RESULT_KIND');
   if(!recovery&&data.state==='rejected_current_attempt'){this.set({phase:'rejected_current_attempt',pending,code:data.code});return;}
   this.set({phase:'unknown',pending,lastRecovery:result.kind});return;
  }
  if(result.kind==='not_sent'&&!recovery){this.set({phase:'not_sent',pending,code:result.code});return;}
  this.set(recovery?{phase:'unknown',pending,lastRecovery:result.kind==='not_sent'?'not_sent':'unavailable'}:{phase:'unknown',pending});
 }
 /** Only exact-original-command recovery can release this UNKNOWN. A later
  * current snapshot or rejection of this recovery invocation cannot do so. */
 async recover(){
  if(!this.active||this.busy||this.state.phase!=='unknown'||!this.ports)return false;
  const pending=this.state.pending;this.busy=true;const controller=new AbortController();this.controller=controller;this.set({phase:'recovering',pending});
  try{const result=await this.ports.recover(pending,controller.signal);if(this.active)this.accept(result,pending,true);}
  catch{if(this.active)this.set({phase:'unknown',pending,lastRecovery:'unavailable'});}
  finally{this.busy=false;if(this.controller===controller)this.controller=null;}
  return true;
 }
 /** UI teardown does not assert that an original command failed or was undone.
  * A later context must be resumed with Root's preserved original command. */
 dispose(){if(!this.active)return;this.active=false;this.controller?.abort();this.latest=null;this.set({phase:'inactive'});this.listeners.clear();}
}
