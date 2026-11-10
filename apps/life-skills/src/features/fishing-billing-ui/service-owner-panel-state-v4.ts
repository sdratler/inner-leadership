import type {BillingSubject} from './model.ts';
import {ServiceOwnerBillingWorkflowV4,type ServiceOwnerWorkflowStateV4} from './service-owner-workflow-v4.ts';
import {serviceOwnerDataV4,serviceOwnerProgressV4,prepareServiceOwnerCashV4,prepareServiceOwnerReversalV4,prepareServiceOwnerStateV4} from './service-owner-model-v4.ts';
import {freezeServiceOwnerV4,type FishingBillingOwnerClientV4,type PreparedServiceOwnerOperationV4,type ServiceOwnerClientScopeV4} from '../../lib/fishing-billing-owner-client-v4.ts';
import {billingId} from '../fishing-billing/contracts.ts';
import type {ServiceOwnerSnapshotV4} from '../fishing-billing/guest-service-owner-financial-contract-v4.ts';

export type ServiceOwnerPanelSourceV4={state:'ready';data:unknown;subject:BillingSubject}|{state:'unavailable'};
export type ServiceOwnerPanelCapabilitiesV4=Readonly<{cash:boolean;reversal:boolean;state:boolean}>;
export type ServiceOwnerPanelDraftV4={kind:'cash'|'reversal'|'state';receiptId:string|null;action:'pause'|'resume'|'cancel'|null;
 amount:string;date:string;reason:string;allocations:Readonly<Record<string,string>>;sourceRevision:number;operationId:string|null;
 review:PreparedServiceOwnerOperationV4|null;error:'invalid'|'changed'|'unavailable'|null};
export type ServiceOwnerPanelSnapshotV4={state:'ready'|'pending'|'unavailable'|'inactive';data:ServiceOwnerSnapshotV4|null;subject:BillingSubject|null;
 flow:ServiceOwnerWorkflowStateV4;draft:ServiceOwnerPanelDraftV4|null;formOpen:boolean;capabilities:ServiceOwnerPanelCapabilitiesV4;canReload:boolean;canRecover:boolean};
type Options={scope:ServiceOwnerClientScopeV4;client:FishingBillingOwnerClientV4|null;source:ServiceOwnerPanelSourceV4;
 capabilities?:Partial<ServiceOwnerPanelCapabilitiesV4>;nextOperationId?:()=>string;reload?:()=>void|Promise<void>;resumeOriginal?:PreparedServiceOwnerOperationV4};
const off:ServiceOwnerPanelCapabilitiesV4=Object.freeze({cash:false,reversal:false,state:false});
function subjectFor(subject:BillingSubject,data:ServiceOwnerSnapshotV4):BillingSubject{
 if(!subject||subject.familyId!==data.quote.familyId||typeof subject.label!=='string'||!subject.label.trim()||subject.label.length>200||
  !Array.isArray(subject.children)||subject.children.length>200||new Set(subject.children.map(c=>c.id)).size!==subject.children.length||
  subject.children.some(c=>!billingId.safeParse(c.id).success||typeof c.name!=='string'||!c.name.trim()||c.name.length>160)||
  data.quote.lines.some(l=>!subject.children.some(c=>c.id===l.childId)))throw Error('SERVICE_PANEL_SUBJECT');
 return freezeServiceOwnerV4({familyId:subject.familyId,label:subject.label,children:subject.children.map(c=>({id:c.id,name:c.name}))});
}
/** Retain ONE instance per authenticated owner/offer context, including across
 * component/dialog remounts. Mandatory client|null has no default transport.
 * Root owns actual admission, route/factory and preserved-command navigation. */
export class ServiceOwnerPanelStateV4{
 readonly workflow:ServiceOwnerBillingWorkflowV4;
 private readonly allowed:ServiceOwnerPanelCapabilitiesV4;
 private readonly connected:boolean;
 private readonly nextId:(()=>string)|undefined;private readonly reloadPort:(()=>void|Promise<void>)|undefined;
 private base:ServiceOwnerSnapshotV4|null=null;private subject:BillingSubject|null=null;private visible=false;private active=true;
 private draft:ServiceOwnerPanelDraftV4|null=null;private formOpen=false;private needsReadback=false;
 private listeners=new Set<()=>void>();private unsubscribe:()=>void;private snapshot!:ServiceOwnerPanelSnapshotV4;
 constructor(options:Options){
  this.workflow=new ServiceOwnerBillingWorkflowV4(options.scope,options.client,options.resumeOriginal);this.nextId=options.nextOperationId;this.reloadPort=options.reload;
  this.connected=options.client!==null;const connected=this.connected&&typeof this.nextId==='function';
  const enabled=(key:keyof ServiceOwnerPanelCapabilitiesV4)=>connected&&Object.hasOwn(options.capabilities??{},key)&&options.capabilities?.[key]===true;
  this.allowed=Object.freeze({cash:enabled('cash'),reversal:enabled('reversal'),state:enabled('state')});
  this.unsubscribe=this.workflow.subscribe(()=>{
   const phase=this.workflow.getSnapshot().phase;
   if(phase==='rejected_current_attempt'||phase==='not_sent')this.needsReadback=true;
   if(this.workflow.unresolved())this.formOpen=false;
   this.publish();
  });
  this.setSource(options.source);
 }
 getSnapshot=()=>this.snapshot;
 getServerSnapshot=()=>this.snapshot;
 subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
 private publish(){
  let state:ServiceOwnerPanelSnapshotV4['state']='unavailable',data:ServiceOwnerSnapshotV4|null=null,flow:ServiceOwnerWorkflowStateV4={phase:'idle'};
  if(!this.active){state='inactive';flow={phase:'inactive'};}
  else if(this.visible&&this.base&&this.subject){
   flow=this.workflow.getSnapshot();
   if(this.workflow.unresolved()||this.needsReadback)state='pending';
   else{try{data=this.workflow.currentFor(this.base);state=data?'ready':'unavailable';}catch{state='unavailable';flow={phase:'idle'};}}
  }
  this.snapshot=freezeServiceOwnerV4({state,data,subject:state==='ready'?this.subject:null,flow,draft:state==='ready'?this.draft:null,
   formOpen:state==='ready'&&this.formOpen,capabilities:state==='ready'?this.allowed:off,canReload:this.active&&Boolean(this.reloadPort)&&!this.workflow.unresolved(),
   canRecover:this.active&&this.visible&&this.connected&&flow.phase==='unknown'});
  for(const listener of this.listeners){try{listener();}catch{/* Rendering cannot change a financial outcome. */}}
 }
 setSource(source:ServiceOwnerPanelSourceV4){
  if(!this.active)return false;
  try{
   if(source.state!=='ready')throw Error('UNAVAILABLE');const data=serviceOwnerDataV4(source.data,this.workflow.scope),subject=subjectFor(source.subject,data);
   if(this.base){if(data.quote.revision<this.base.quote.revision)serviceOwnerProgressV4(data,this.base);else{serviceOwnerProgressV4(this.base,data);this.base=data;}}
   else this.base=data;
   this.subject=subject;this.visible=true;
   if(this.needsReadback&&!this.workflow.unresolved()){
    this.needsReadback=false;if(this.draft)this.draft={...this.draft,review:null,operationId:null,error:null};this.workflow.clear();
   }
   const current=this.workflow.currentFor(this.base);
   if(current&&this.draft?.review&&this.workflow.getSnapshot().phase==='idle'&&this.draft.sourceRevision!==current.quote.revision)this.draft={...this.draft,review:null,error:'changed'};
  }catch{this.visible=false;}
  this.publish();return this.visible;
 }
 private current(){return this.snapshot.state==='ready'?this.snapshot.data:null;}
 private enabled(kind:ServiceOwnerPanelDraftV4['kind']){return this.snapshot.state==='ready'&&this.snapshot.capabilities[kind]&&!this.workflow.unresolved();}
 private open(kind:ServiceOwnerPanelDraftV4['kind'],receiptId:string|null=null,action:ServiceOwnerPanelDraftV4['action']=null){
  const data=this.current();if(!data||!this.enabled(kind))return false;
  if(this.workflow.getSnapshot().phase==='confirmed'){this.workflow.clear();this.draft=null;}
  if(this.draft?.kind===kind&&this.draft.receiptId===receiptId&&this.draft.action===action){this.formOpen=true;this.publish();return true;}
  if(kind==='reversal'&&!data.balance.receipts.some(r=>r.id===receiptId&&r.kind==='cash'))return false;
  if(kind==='cash'&&(data.quote.state!=='accepted'||data.balance.pendingAttemptIds.length))return false;
  if(kind==='state'&&(data.quote.state==='cancelled'||action==='pause'&&data.quote.paused||action==='resume'&&!data.quote.paused))return false;
  const lineIds=kind==='reversal'?data.balance.receipts.find(r=>r.id===receiptId)!.allocations.map(a=>a.lineId):data.quote.lines.map(l=>l.id);
  this.draft={kind,receiptId,action,amount:'',date:'',reason:'',allocations:Object.fromEntries(lineIds.map(id=>[id,''])),sourceRevision:data.quote.revision,operationId:null,review:null,error:null};
  this.formOpen=true;this.publish();return true;
 }
 openCash(){return this.open('cash');}
 openReversal(receiptId:string){return this.open('reversal',receiptId);}
 openState(action:'pause'|'resume'|'cancel'){return this.open('state',null,action);}
 closeForm(){if(!this.active)return false;this.formOpen=false;if(this.workflow.getSnapshot().phase==='confirmed'){this.workflow.clear();this.draft=null;}this.publish();return true;}
 updateDraft(patch:Partial<Pick<ServiceOwnerPanelDraftV4,'amount'|'date'|'reason'|'allocations'>>){
  if(!this.draft||!this.enabled(this.draft.kind)||this.workflow.getSnapshot().phase!=='idle')return false;
  this.draft={...this.draft,...patch,allocations:patch.allocations?{...patch.allocations}:this.draft.allocations,review:null,error:null};this.publish();return true;
 }
 review(){
  const data=this.current(),draft=this.draft;if(!data||!draft||!this.enabled(draft.kind)||this.workflow.getSnapshot().phase!=='idle')return false;
  try{
   const operationId=draft.operationId??billingId.parse(this.nextId!());this.draft={...draft,operationId};
   const review=draft.kind==='cash'?prepareServiceOwnerCashV4(data,operationId,draft):draft.kind==='reversal'?prepareServiceOwnerReversalV4(data,operationId,draft.receiptId!,draft):
    prepareServiceOwnerStateV4(data,operationId,draft.action!);
   this.draft={...this.draft,review,sourceRevision:data.quote.revision,error:null};this.publish();return true;
  }catch{this.draft={...this.draft!,error:'invalid',review:null};this.publish();return false;}
 }
 backToEdit(){if(!this.draft||!this.enabled(this.draft.kind)||this.workflow.getSnapshot().phase!=='idle')return false;this.draft={...this.draft,review:null,error:null};this.publish();return true;}
 /** True means one invocation began, not that money was confirmed. */
 async confirm(){
  const data=this.current(),draft=this.draft;if(!data||!draft?.review||!this.enabled(draft.kind)||this.workflow.getSnapshot().phase!=='idle')return false;
  if(draft.sourceRevision!==data.quote.revision){this.draft={...draft,review:null,error:'changed'};this.publish();return false;}
  const accepted=await this.workflow.submit(draft.review,data);
  if(!accepted&&this.active&&this.draft){this.draft={...this.draft,review:null,error:'unavailable'};this.publish();}return accepted;
 }
 recover(){if(!this.snapshot.canRecover)return Promise.resolve(false);return this.workflow.recover();}
 async reload(){if(!this.snapshot.canReload||!this.reloadPort)return false;try{await this.reloadPort();return this.active;}catch{if(this.active){this.visible=false;this.publish();}return false;}}
 /** Only authenticated-context teardown disposes. Ordinary component unmount
  * must not call this or discard Root's preserved original command. */
 dispose(){if(!this.active)return;this.active=false;this.workflow.dispose();this.unsubscribe();this.base=null;this.subject=null;this.draft=null;this.visible=false;this.publish();this.listeners.clear();}
}
