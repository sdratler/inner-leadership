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
import {UnsavedChangesGuard} from '../../../src/ui/workspace/draft-guard.tsx';
function find(node:unknown,match:(item:ReactElement<Record<string,unknown>>)=>boolean):ReactElement<Record<string,unknown>>|undefined {
 if(!node||typeof node!=='object')return;if(Array.isArray(node))return node.map(value=>find(value,match)).find(Boolean);
 const item=node as ReactElement<Record<string,unknown>>;return match(item)?item:find(item.props?.children,match);
}
const source={declaredVersion:'2.0',driveRevision:'13',modifiedAt:'2026-10-01T08:00:00Z',checkedAt:'2026-10-01T08:01:00Z',sha256:'a'.repeat(64),includedCommunityRuleIds:[]};
const generated={operationId:'412302a8-3694-4718-9a3b-e5de1a78de6e',reply:'DEMO public reply only.',copyAllowed:true,reviewFlags:[],suggestedRule:'',ruleScope:'',originalUrl:null,
 provenance:{guide:source,playbook:source,generatedAt:'2026-10-01T08:02:00Z',model:'synthetic',policyVersion:'synthetic',usage:{inputTokens:1,outputTokens:1}}};
beforeEach(()=>{hooks.reset();vi.stubGlobal('fetch',vi.fn());});
test.each(['en','he'] as const)('%s retains the navigation warning after failed generation readback, then clears only after verification',async locale=>{
 let verified=false;const saved={draftId:generated.operationId,draft:generated.reply,revision:1,editedAt:null,generated,copyAllowed:true};
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
