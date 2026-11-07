import {describe,it,expect,vi} from 'vitest';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {BillingWorkflow} from '../../../src/features/fishing-billing-ui/workflow.ts';
import {prepareStateCommand,decodeData,dataScope,type StateAction,type StateCommand,type BillingData,type BillingOperationReceipt,type BillingUiPorts,type CommandOutcome} from '../../../src/features/fishing-billing-ui/model.ts';
import {OwnerBillingPanel,StateActionConfirmation,WorkflowNotice} from '../../../src/features/fishing-billing-ui/owner-billing-panel.tsx';
import {syntheticDateCashFixtures} from '../../../src/features/fishing-billing/fixtures-v2.ts';
import {syntheticId} from '../../../src/features/fishing-billing/fixtures.ts';
import {changeBillingState} from '../../../src/features/fishing-billing/domain.ts';
import {BILLING_DTO_V2,projectBalanceV2} from '../../../src/features/fishing-billing/contracts-v2.ts';
import {createFishingBillingOwnerClientV2} from '../../../src/lib/fishing-billing-owner-client-v2.ts';

const op=syntheticId(710),otherOp=syntheticId(711);
function base(paused=false):BillingData{
 const f=syntheticDateCashFixtures(),quote={...f.quote,paused};
 return {quote,balance:projectBalanceV2(quote,f.balance.receipts)};
}
function transition(data:BillingData,command:StateCommand){
 const quote=changeBillingState(data.quote,command.expectedVersion,{...(command.paused!==undefined?{paused:command.paused}:{}),...(command.cancel?{cancel:true as const}:{})});
 const current={quote,balance:projectBalanceV2(quote,data.balance.receipts)};
 const receipt:BillingOperationReceipt={version:BILLING_DTO_V2,sourceVersion:BILLING_DTO_V2,operationId:command.operationId,entityId:quote.id,entityVersion:quote.revision,replayed:false,result:{...current,receiptId:null}};
 return {receipt,current};
}
function ports():BillingUiPorts{
 return {recordCashDate:vi.fn(async():Promise<CommandOutcome>=>({kind:'unknown'})),reverseCash:vi.fn(async():Promise<CommandOutcome>=>({kind:'unknown'})),setState:vi.fn(async():Promise<CommandOutcome>=>({kind:'unknown'})),readOperation:vi.fn(async()=>null),readBalance:vi.fn(async()=>base()),nextOperationId:vi.fn(()=>op)};
}
function moneyFacts(data:BillingData){
 const b=data.balance;
 return {due:b.dueMinor,quoted:b.quotedMinor,paid:b.paidMinor,remaining:b.remainingMinor,excess:b.excessMinor,unallocated:b.unallocatedMinor,lines:b.lines,receipts:b.receipts,reminders:b.reminders};
}
const cash=(data:BillingData)=>({version:BILLING_DTO_V2,operationId:otherOp,expectedVersion:data.balance.revision,quoteId:data.quote.id,receivedPrecision:'date' as const,receivedDate:'2035-01-06',timeZone:'America/New_York' as const,currency:'USD' as const,amountMinor:100,allocations:[{lineId:data.quote.lines[1]!.id,amountMinor:100}]});
const subject={familyId:syntheticId(4),label:'SYNTHETIC family',children:[{id:syntheticId(20),name:'SYNTHETIC Ari'},{id:syntheticId(21),name:'SYNTHETIC Noam'}]};
function panel(data:BillingData,workflow:BillingWorkflow,stateAllowed?:boolean){return renderToStaticMarkup(createElement(OwnerBillingPanel,{locale:'en',view:{state:'ready',data},subject,workflow,...(stateAllowed===undefined?{}:{stateAllowed})}));}
function button(html:string,label:string){const found=html.match(new RegExp(`<button[^>]*>${label}</button>`));expect(found).not.toBeNull();return found![0];}

describe('one retained workflow for owner state commands',()=>{
 it.each(['pause','resume','cancel'] as const)('uses the actual injected V2 client for %s and preserves all money facts',async action=>{
  const data=base(action==='resume'),command=prepareStateCommand(action,data,op),reply=transition(data,command),requests:unknown[]=[];
  const client=createFishingBillingOwnerClientV2({origin:'https://synthetic.invalid',scope:dataScope(data),csrf:async()=>'a'.repeat(43),transport:async request=>{
   requests.push({method:request.method,body:await request.json()});
   return new Response(JSON.stringify({ok:true,requestId:syntheticId(900),data:{version:BILLING_DTO_V2,state:'confirmed',...reply,current:{...reply.current,receiptId:null}}}),{headers:{'content-type':'application/json'}});
  }});
  const w=new BillingWorkflow({...client,nextOperationId:()=>op});
  expect(w.getSnapshot().phase).toBe('idle');expect(requests).toEqual([]);
  await w.submit('state',command,data);
  expect(requests).toEqual([{method:'POST',body:{action:'state',command}}]);
  expect(w.getSnapshot()).toMatchObject({phase:'confirmed',receipt:{result:{receiptId:null}}});
  expect(w.currentFor(data).balance).toMatchObject({paused:action==='pause',cancelled:action==='cancel'});
  expect(moneyFacts(w.currentFor(data))).toEqual(moneyFacts(data));
  expect(reply.current.balance.receipts).toHaveLength(2);
 });
 it('does not offer a state mutation when its explicit port is absent',async()=>{
  const p=ports();delete p.setState;const w=new BillingWorkflow(p),data=base();
  expect(await w.submit('state',prepareStateCommand('pause',data,op),data)).toBe(false);
  expect(w.getSnapshot().phase).toBe('idle');expect(p.recordCashDate).not.toHaveBeenCalled();
 });
 it('keeps the original immutable command through double click and caller mutation',async()=>{
  const data=base(),raw=structuredClone(prepareStateCommand('pause',data,op)),reply=transition(data,raw),p=ports();
  let release!:(value:CommandOutcome)=>void;
  const dispatch=vi.fn<NonNullable<BillingUiPorts['setState']>>(()=>new Promise<CommandOutcome>(resolve=>{release=resolve;}));p.setState=dispatch;
  const w=new BillingWorkflow(p),pending=w.submit('state',raw,data);raw.paused=false;
  expect(await w.submit('state',prepareStateCommand('cancel',data,otherOp),data)).toBe(false);
  expect(await w.submit('cash',cash(data),data)).toBe(false);
  release({kind:'confirmed',...reply});await pending;
  expect(p.setState).toHaveBeenCalledTimes(1);expect(w.getSnapshot()).toMatchObject({phase:'confirmed',command:{operationId:op,paused:true}});
  expect(Object.isFrozen(dispatch.mock.calls[0]![0])).toBe(true);
 });
 it('keeps an unknown state operation across absent lookups and blocks replacement and cash',async()=>{
  const data=base(),command=prepareStateCommand('cancel',data,op),p=ports(),w=new BillingWorkflow(p);
  await w.submit('state',command,data);await w.recover();
  expect(w.getSnapshot()).toMatchObject({phase:'unknown',command});expect(w.clear()).toBe(false);
  expect(await w.submit('state',prepareStateCommand('pause',data,otherOp),data)).toBe(false);
  expect(await w.submit('cash',cash(data),data)).toBe(false);
  expect(p.readOperation).toHaveBeenCalledWith(op);expect(p.setState).toHaveBeenCalledTimes(1);expect(p.recordCashDate).not.toHaveBeenCalled();
  expect(w.currentFor(data).balance.cancelled).toBe(false);
  p.readOperation=vi.fn(async()=>transition(data,command));await w.recover();
  expect(w.getSnapshot().phase).toBe('confirmed');expect(w.currentFor(data).balance.cancelled).toBe(true);expect(p.setState).toHaveBeenCalledTimes(1);
  expect(moneyFacts(w.currentFor(data))).toEqual(moneyFacts(data));
 });
 it('keeps UNAVAILABLE uncertainty tied to the original state operation',async()=>{
  const data=base(),p=ports();p.setState=vi.fn(async():Promise<CommandOutcome>=>({kind:'rejected',code:'UNAVAILABLE'}));
  const w=new BillingWorkflow(p);await w.submit('state',prepareStateCommand('pause',data,op),data);
  expect(w.getSnapshot().phase).toBe('unknown');expect(w.clear()).toBe(false);expect(await w.submit('cash',cash(data),data)).toBe(false);
 });
 it('recovers an actual V2 state-client 503 by original operation lookup without a second POST',async()=>{
  const data=base(),command=prepareStateCommand('cancel',data,op),reply=transition(data,command),posts:unknown[]=[],lookups:string[]=[];
  const client=createFishingBillingOwnerClientV2({origin:'https://synthetic.invalid',scope:dataScope(data),csrf:async()=>'a'.repeat(43),transport:async request=>{
   if(request.method==='POST'){
    posts.push(await request.json());
    return new Response(JSON.stringify({ok:false,requestId:syntheticId(900),error:{code:'UNAVAILABLE'}}),{status:503,headers:{'content-type':'application/json'}});
   }
   lookups.push(new URL(request.url).searchParams.get('id')!);
   return new Response(JSON.stringify({ok:true,requestId:syntheticId(900),data:{version:BILLING_DTO_V2,state:'confirmed',...reply,current:{...reply.current,receiptId:null}}}),{headers:{'content-type':'application/json'}});
  }});
  const w=new BillingWorkflow({...client,nextOperationId:()=>op});await w.submit('state',command,data);
  expect(w.getSnapshot().phase).toBe('unknown');expect(w.clear()).toBe(false);expect(w.currentFor(data).balance.cancelled).toBe(false);
  await w.recover();expect(lookups).toEqual([op]);expect(posts).toEqual([{action:'state',command}]);
  expect(w.getSnapshot()).toMatchObject({phase:'confirmed',receipt:{result:{receiptId:null}}});expect(w.currentFor(data).balance.cancelled).toBe(true);
  expect(moneyFacts(w.currentFor(data))).toEqual(moneyFacts(data));
 });
 it('refreshes only after a known state receipt with a stale current balance',async()=>{
  const data=base(),command=prepareStateCommand('pause',data,op),reply=transition(data,command),p=ports();
  p.setState=vi.fn(async():Promise<CommandOutcome>=>({kind:'confirmed',receipt:reply.receipt,current:data}));p.readBalance=vi.fn(async()=>reply.current);
  const w=new BillingWorkflow(p);await w.submit('state',command,data);
  expect(w.getSnapshot().phase).toBe('refresh_required');expect(w.clear()).toBe(false);expect(w.currentFor(data).balance.paused).toBe(false);
  await w.refresh();expect(w.getSnapshot().phase).toBe('confirmed');expect(w.currentFor(data).balance.paused).toBe(true);expect(p.setState).toHaveBeenCalledTimes(1);
 });
 it('requires a fresh confirmation after stale revision and never posts the stale command',async()=>{
  const data=base(),command=prepareStateCommand('cancel',data,op),p=ports(),w=new BillingWorkflow(p);
  const current=transition(data,prepareStateCommand('pause',data,otherOp)).current;
  expect(await w.submit('state',command,current)).toBe(false);
  expect(w.getSnapshot().phase).toBe('conflict');expect(p.setState).not.toHaveBeenCalled();expect(w.currentFor(current).balance.cancelled).toBe(false);
 });
 it('treats a fresh cancellation conflict as conflict rather than confirmed cancellation',async()=>{
  const data=base(),command=prepareStateCommand('cancel',data,op),p=ports();
  const current=transition(data,prepareStateCommand('pause',data,otherOp)).current;
  p.setState=vi.fn(async():Promise<CommandOutcome>=>({kind:'conflict',current}));
  const w=new BillingWorkflow(p);await w.submit('state',command,data);
  const html=renderToStaticMarkup(createElement(WorkflowNotice,{locale:'en',flow:w.getSnapshot(),workflow:w,showDetails:true}));
  expect(w.getSnapshot().phase).toBe('conflict');expect(w.currentFor(data).balance.cancelled).toBe(false);
  expect(html).toContain('This action was not confirmed');expect(html).not.toContain('State change recorded');expect(html).not.toContain('Offer cancelled');
 });
 it('can read an already-cancelled fresh conflict without claiming this operation confirmed it',async()=>{
  const data=base(),command=prepareStateCommand('cancel',data,op),p=ports(),current=transition(data,prepareStateCommand('cancel',data,otherOp)).current;
  p.setState=vi.fn(async():Promise<CommandOutcome>=>({kind:'conflict',current}));
  const w=new BillingWorkflow(p);await w.submit('state',command,data);
  expect(w.getSnapshot().phase).toBe('conflict');expect(w.currentFor(data).balance.cancelled).toBe(true);
  const html=renderToStaticMarkup(createElement(WorkflowNotice,{locale:'en',flow:w.getSnapshot(),workflow:w,showDetails:true}));
  expect(html).toContain('This action was not confirmed');expect(html).not.toContain('State change recorded');
 });
 it.each(['family','workspace'] as const)('does not adopt a late current snapshot from another %s',async field=>{
  const data=base(),command=prepareStateCommand('pause',data,op),reply=transition(data,command),foreign=structuredClone(reply.current),p=ports();
  if(field==='family'){foreign.quote.familyId=syntheticId(999);foreign.balance.familyId=syntheticId(999);}else foreign.quote.workspaceId=syntheticId(999);
  p.setState=vi.fn(async():Promise<CommandOutcome>=>({kind:'confirmed',receipt:reply.receipt,current:foreign}));
  const w=new BillingWorkflow(p);await w.submit('state',command,data);
  expect(w.getSnapshot().phase).toBe('refresh_required');expect(w.currentFor(data)).toEqual(data);expect(w.clear()).toBe(false);
  const html=renderToStaticMarkup(createElement(WorkflowNotice,{locale:'en',flow:w.getSnapshot(),workflow:w,showDetails:false}));
  expect(html).toContain('Earlier operation needs verification');expect(html).not.toContain(op);expect(html).not.toContain('State change recorded');
 });
 it.each(['wrong-state','money-receipt'] as const)('does not confirm a malformed %s state receipt',async fault=>{
  const data=base(),command=prepareStateCommand('pause',data,op),reply=transition(data,command),p=ports();
  if(fault==='wrong-state'){reply.receipt.result.quote.paused=false;reply.receipt.result.balance.paused=false;}else reply.receipt.result.receiptId=syntheticId(999);
  p.setState=vi.fn(async():Promise<CommandOutcome>=>({kind:'confirmed',...reply}));
  const w=new BillingWorkflow(p);await w.submit('state',command,data);
  expect(w.getSnapshot().phase).toBe('unknown');expect(w.currentFor(data).balance.paused).toBe(false);expect(w.clear()).toBe(false);
 });
 it('displays the fresh current state even when a later operation reversed the historical pause',async()=>{
  const data=base(),command=prepareStateCommand('pause',data,op),reply=transition(data,command);
  const resumed=transition(reply.current,prepareStateCommand('resume',reply.current,otherOp)).current,p=ports();
  p.setState=vi.fn(async():Promise<CommandOutcome>=>({kind:'confirmed',receipt:reply.receipt,current:resumed}));
  const w=new BillingWorkflow(p);await w.submit('state',command,data);
  expect(w.getSnapshot().phase).toBe('confirmed');expect(w.currentFor(data).balance.paused).toBe(false);expect(w.currentFor(data).balance.revision).toBe(7);
  expect(moneyFacts(w.currentFor(data))).toEqual(moneyFacts(data));
 });
});

describe('default-off deliberate owner state presentation',()=>{
 it('rejects inconsistent authoritative state flags before showing a control or balance',()=>{
  const data=base();data.balance.paused=true;
  expect(()=>decodeData(data)).toThrow('INVALID_BILLING_SNAPSHOT');
  const html=panel(data,new BillingWorkflow(ports()),true);expect(html).toContain('Billing data unavailable');expect(html).not.toContain('Pause follow-up');expect(html).not.toContain('850.00');
 });
 it('requires both capability and injected port and never mutates on render',()=>{
  const data=base(),p=ports(),w=new BillingWorkflow(p);
  expect(button(panel(data,w),'Pause follow-up')).toContain('disabled');
  expect(button(panel(data,w),'Cancel offer')).toContain('disabled');
  expect(button(panel(data,w,true),'Pause follow-up')).not.toContain('disabled');
  expect(p.setState).not.toHaveBeenCalled();expect(p.nextOperationId).not.toHaveBeenCalled();
  delete p.setState;expect(button(panel(data,w,true),'Pause follow-up')).toContain('disabled');
 });
 it('uses current paused state for resume and keeps cancelled offers disabled',()=>{
  const p=ports(),w=new BillingWorkflow(p),paused=base(true),cancelled=transition(base(),prepareStateCommand('cancel',base(),op)).current;
  expect(button(panel(paused,w,true),'Resume follow-up')).not.toContain('disabled');
  expect(button(panel(cancelled,w,true),'Cancel offer')).toContain('disabled');
  expect(button(panel(cancelled,w,true),'Pause follow-up')).toContain('disabled');
 });
 it.each(['pause','resume','cancel'] as const)('explains %s before confirmation in English and Hebrew',action=>{
  const data=base(action==='resume'),command=prepareStateCommand(action,data,op),onConfirm=vi.fn();
  for(const locale of ['en','he'] as const){
   const html=renderToStaticMarkup(createElement(StateActionConfirmation,{locale,action,data,command,allowed:true,familyLabel:subject.label,onConfirm,onBack:()=>{}}));
   expect(html).toContain(locale==='en'?'stay unchanged':'נשארים ללא שינוי');expect(html).toContain(locale==='en'?'no refund or balance write-off':'אינה מבצעת החזר ואינה מוחקת יתרה');
   expect(html).toContain('850.00');expect(html).toContain('450.00');
   if(action==='resume')expect(html).toContain(locale==='en'?'sends or queues no messages':'אינה שולחת הודעות ואינה מוסיפה הודעות לתור');
   else expect(html).toContain(locale==='en'?(action==='cancel'?'suppress further payment follow-up':'Pause payment follow-up'):(action==='cancel'?'חסימת מעקב תשלום נוסף':'השהיית מעקב התשלום'));
  }
  expect(onConfirm).not.toHaveBeenCalled();
 });
 it('disables stale, revoked, wrong-quote and mismatched-intent confirmations',()=>{
  const data=base(),command=prepareStateCommand('cancel',data,op),onConfirm=vi.fn();
  for(const props of [{allowed:false,command,action:'cancel' as StateAction},{allowed:true,command:{...command,expectedVersion:4},action:'cancel' as StateAction},{allowed:true,command:{...command,quoteId:syntheticId(999)},action:'cancel' as StateAction},{allowed:true,command,action:'pause' as StateAction}]){
   const html=renderToStaticMarkup(createElement(StateActionConfirmation,{locale:'en',data,familyLabel:subject.label,onConfirm,onBack:()=>{},...props}));
   expect(html).toContain('no longer current or authorized');expect(button(html,props.action==='pause'?'Confirm pause':'Confirm offer cancellation')).toContain('disabled');
  }
  expect(onConfirm).not.toHaveBeenCalled();
 });
 it('blocks all owner state buttons while an unresolved operation belongs to another scope',async()=>{
  const data=base(),p=ports(),w=new BillingWorkflow(p);await w.submit('state',prepareStateCommand('pause',data,op),data);
  const other=structuredClone(data);other.quote.workspaceId=syntheticId(999);
  const html=panel(other,w,true);expect(button(html,'Pause follow-up')).toContain('disabled');expect(button(html,'Cancel offer')).toContain('disabled');
  expect(w.clear()).toBe(false);expect(p.setState).toHaveBeenCalledTimes(1);
 });
});
