import type {ReactElement} from 'react';
import {beforeEach,expect,test,vi} from 'vitest';
const hooks=vi.hoisted(()=>{const slots:unknown[]=[];let cursor=0;return {
 reset(){slots.length=0;cursor=0;},render<T>(fn:()=>T){cursor=0;return fn();},
 useState<T>(initial:T){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i] as T,(value:T|((old:T)=>T))=>{slots[i]=typeof value==='function'?(value as (old:T)=>T)(slots[i] as T):value;}] as const;},
 useRef<T>(initial:T){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i] as {current:T};},
 useCallback<T>(fn:T){return fn;},useEffect(){},
};});
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:hooks.useState,useRef:hooks.useRef,useCallback:hooks.useCallback,useEffect:hooks.useEffect}));
vi.mock('../../../src/features/identity/client.ts',()=>({sessionInfo:async()=>({role:'practitioner',csrfToken:'synthetic'})}));
import {CommunityReplyWorkspace} from '../../../src/features/community-reply/workspace.tsx';
import type {CommunitySavedDraft} from '../../../src/features/community-reply/drafts-bridge.ts';
import {matchesGeneratedReadback} from '../../../src/features/community-reply/input-state.ts';
import {UnsavedChangesGuard} from '../../../src/ui/workspace/draft-guard.tsx';
function find(node:unknown,match:(item:ReactElement<Record<string,unknown>>)=>boolean):ReactElement<Record<string,unknown>>|undefined {
 if(!node||typeof node!=='object')return;if(Array.isArray(node))return node.map(value=>find(value,match)).find(Boolean);
 const item=node as ReactElement<Record<string,unknown>>;return match(item)?item:find(item.props?.children,match);
}
const source={declaredVersion:'2.0',driveRevision:'13',modifiedAt:'2026-10-01T08:00:00Z',checkedAt:'2026-10-01T08:01:00Z',sha256:'a'.repeat(64)};
const generated:CommunitySavedDraft['generated']={operationId:'412302a8-3694-4718-9a3b-e5de1a78de6e',reply:'DEMO public reply only.',copyAllowed:true,reviewFlags:[],suggestedRule:'',ruleScope:'',originalUrl:null,
 provenance:{guide:{...source,id:'174-EqMG0QIH5rCuRgn2xYYPMX-XWJZNn',includedCommunityRuleIds:[]},playbook:{...source,id:'12C3QM4F6RZdpeWRvReN2x2BB7GzBnSqvfhjMg1PKwC0'},generatedAt:'2026-10-01T08:02:00Z',model:'synthetic',policyVersion:'synthetic',usage:{inputTokens:1,outputTokens:1}}};
function savedDraft():CommunitySavedDraft{return {draftId:generated.operationId,question:'DEMO public source question',originalUrl:null,draft:generated.reply,revision:1,editedAt:null,expiresAt:'2026-11-01T08:02:00Z',generated:structuredClone(generated),copyAllowed:true,reviewFlags:[]};}
beforeEach(()=>{hooks.reset();vi.stubGlobal('fetch',vi.fn());});

test('complete readback ignores object property order, normalizes the submitted URL and preserves edited-draft conflict evidence',()=>{
 const value={...generated,originalUrl:'https://www.facebook.com/'};
 const row={...savedDraft(),originalUrl:value.originalUrl,generated:{provenance:{...value.provenance,usage:{outputTokens:1,inputTokens:1}},...Object.fromEntries(Object.entries(value).filter(([key])=>key!=='provenance').reverse())} as CommunitySavedDraft['generated']};
 const input={question:row.question,originalUrl:'https://www.facebook.com'};
 expect(matchesGeneratedReadback(row,value,input)).toBe(true);
 expect(matchesGeneratedReadback({...row,revision:2,draft:'DEMO later edited public response.',copyAllowed:false,reviewFlags:['REVIEW_EDIT']},value,input)).toBe(true);
 expect(matchesGeneratedReadback(row,value,null)).toBe(false);
});

test.each(['question','originalUrl','draftId','safety','rule','guide revision','guide checked time','guide rules','playbook version','model','policy','usage','generated time','initial safety'] as const)('rejects a saved draft with altered %s despite matching reply and source hashes',async field=>{
 const saved=savedDraft();
 switch(field){
  case 'question':saved.question='DEMO unrelated public question';break;
  case 'originalUrl':saved.originalUrl='https://www.facebook.com/groups/demo/posts/99';break;
  case 'draftId':saved.draftId='9fe575fe-fba2-4a4b-a136-bb28560b13f2';break;
  case 'safety':saved.generated.copyAllowed=false;break;
  case 'rule':saved.generated.suggestedRule='Use a different opening.';break;
  case 'guide revision':saved.generated.provenance.guide.driveRevision='14';break;
  case 'guide checked time':saved.generated.provenance.guide.checkedAt='2026-10-01T08:03:00Z';break;
  case 'guide rules':saved.generated.provenance.guide.includedCommunityRuleIds=['CR-12345678123441238123123456789abc'];break;
  case 'playbook version':saved.generated.provenance.playbook.declaredVersion='2.1';break;
  case 'model':saved.generated.provenance.model='other-synthetic';break;
  case 'policy':saved.generated.provenance.policyVersion='other-policy';break;
  case 'usage':saved.generated.provenance.usage.inputTokens=2;break;
  case 'generated time':saved.generated.provenance.generatedAt='2026-10-01T08:04:00Z';break;
  case 'initial safety':saved.copyAllowed=false;saved.reviewFlags=['UNREVIEWED'];break;
 }
 vi.mocked(fetch).mockImplementation(async(_url,options)=>Response.json(options?.method==='POST'?{ok:true,data:generated}:{ok:true,data:{drafts:[saved]}}));
 const render=()=>hooks.render(()=>CommunityReplyWorkspace({locale:'en'}));let tree=render();
 (find(tree,item=>item.type==='textarea')!.props.onChange as (e:unknown)=>void)({target:{value:'DEMO public source question'}});tree=render();
 (find(tree,item=>item.type==='button'&&item.props.className==='lsr-primary')!.props.onClick as ()=>void)();
 await vi.waitFor(()=>{tree=render();expect(find(tree,item=>item.type==='button'&&item.props.className==='lsr-primary')!.props.disabled).toBe(false);expect(find(tree,item=>item.type==='textarea'&&item.props.value===generated.reply)).toBeDefined();});
 expect(find(tree,item=>item.type===UnsavedChangesGuard)!.props.dirty).toBe(true);
 expect(find(tree,item=>item.type==='button'&&item.props.children==='Retry this draft’s verification')).toBeDefined();
 expect(find(tree,item=>item.type==='button'&&item.props.children==='Copy reply')!.props.disabled).toBe(true);
});

test.each(['en','he'] as const)('%s reconciles an unconfirmed draft with GET only, not another generation',async locale=>{
 let verified=false;const saved=savedDraft();
 vi.mocked(fetch).mockImplementation(async(_url,options)=>options?.method==='POST'?Response.json({ok:true,data:generated}):verified?Response.json({ok:true,data:{drafts:[saved]}}):Response.json({ok:false},{status:503}));
 const render=()=>hooks.render(()=>CommunityReplyWorkspace({locale}));let tree=render();
 (find(tree,item=>item.type==='textarea')!.props.onChange as (e:unknown)=>void)({target:{value:'DEMO public source question'}});tree=render();
 (find(tree,item=>item.type==='button'&&item.props.className==='lsr-primary')!.props.onClick as ()=>void)();
 await vi.waitFor(()=>{tree=render();expect(find(tree,item=>item.type==='button'&&item.props.className==='lsr-primary')!.props.disabled).toBe(false);expect(find(tree,item=>item.type===UnsavedChangesGuard)!.props.dirty).toBe(true);});
 const retry=find(tree,item=>item.type==='button'&&item.props.children===(locale==='en'?'Retry this draft’s verification':'ניסיון חוזר לאימות הטיוטה הזאת'));expect(retry).toBeDefined();verified=true;(retry!.props.onClick as ()=>void)();
 await vi.waitFor(()=>{tree=render();expect(find(tree,item=>item.type===UnsavedChangesGuard)!.props.dirty).toBe(false);});
 expect(vi.mocked(fetch).mock.calls.filter(([,options])=>options?.method==='POST')).toHaveLength(1);expect(vi.mocked(fetch).mock.calls.filter(([,options])=>!options?.method)).toHaveLength(2);
});
test.each(['en','he'] as const)('%s retains the navigation warning after failed generation readback, then clears only after verification',async locale=>{
 let verified=false;const saved=savedDraft();
 vi.mocked(fetch).mockImplementation(async(_url,options)=>{if(options?.method==='POST')return Response.json({ok:true,data:generated});await new Promise(resolve=>setTimeout(resolve,5));return verified?Response.json({ok:true,data:{drafts:[saved]}}):Response.json({ok:false},{status:503});});
 const render=()=>hooks.render(()=>CommunityReplyWorkspace({locale}));let tree=render();
 expect(find(tree,item=>item.type===UnsavedChangesGuard)!.props.dirty).toBe(false);
 (find(tree,item=>item.type==='textarea')!.props.onChange as (e:unknown)=>void)({target:{value:'DEMO public source question'}});tree=render();
 const generate=()=>{const button=find(tree,item=>item.type==='button'&&item.props.className==='lsr-primary')!;(button.props.onClick as ()=>void)();};
 generate();await vi.waitFor(()=>{tree=render();expect(find(tree,item=>item.type==='button'&&item.props.className==='lsr-primary')!.props.disabled).toBe(false);expect(find(tree,item=>item.type==='textarea'&&item.props.value===generated.reply)).toBeDefined();});
 expect(find(tree,item=>item.type==='textarea'&&item.props.value===generated.reply)).toBeDefined();
 expect(find(tree,item=>item.type===UnsavedChangesGuard)!.props.dirty).toBe(true);
 verified=true;generate();await vi.waitFor(()=>{tree=render();expect(find(tree,item=>item.type==='button'&&item.props.className==='lsr-primary')!.props.disabled).toBe(false);expect(find(tree,item=>item.type===UnsavedChangesGuard)!.props.dirty).toBe(false);});
 const writes=vi.mocked(fetch).mock.calls.filter(([,options])=>options?.method==='POST');expect(writes).toHaveLength(2);
 const ids=writes.map(([,options])=>JSON.parse(options!.body as string).operationId);expect(ids[1]).toBe(ids[0]);
 generate();await vi.waitFor(()=>{tree=render();expect(find(tree,item=>item.type==='button'&&item.props.className==='lsr-primary')!.props.disabled).toBe(false);});
 const subsequent=vi.mocked(fetch).mock.calls.filter(([,options])=>options?.method==='POST');expect(subsequent).toHaveLength(3);expect(JSON.parse(subsequent[2]![1]!.body as string).operationId).not.toBe(ids[0]);
});
