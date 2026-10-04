import type {ReactElement} from 'react';import {beforeEach,expect,test,vi} from 'vitest';
const hooks=vi.hoisted(()=>{const slots:unknown[]=[];let cursor=0,started=false;const effects:Array<()=>void>=[];return {
 reset(){slots.length=0;cursor=0;started=false;effects.length=0;},render<T>(fn:()=>T){cursor=0;return fn();},flush(){effects.splice(0).forEach(fn=>fn());},
 useState<T>(initial:T){const i=cursor++;if(!(i in slots))slots[i]=initial;return [slots[i] as T,(value:T)=>{slots[i]=value;}] as const;},
 useRef<T>(initial:T){const i=cursor++;if(!(i in slots))slots[i]={current:initial};return slots[i] as {current:T};},
 useCallback<T>(fn:T){return fn;},useEffect(fn:()=>void){if(!started){started=true;effects.push(fn);}},
};});
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:hooks.useState,useRef:hooks.useRef,useCallback:hooks.useCallback,useEffect:hooks.useEffect}));
vi.mock('../../../src/features/identity/client.ts',()=>({sessionInfo:async()=>({role:'practitioner',csrfToken:'synthetic'})}));
import {CommunityThreadPanel} from '../../../src/features/community-reply/thread-panel.tsx';
function find(node:unknown,match:(item:ReactElement<Record<string,unknown>>)=>boolean):ReactElement<Record<string,unknown>>|undefined {
 if(!node||typeof node!=='object')return;if(Array.isArray(node))return node.map(value=>find(value,match)).find(Boolean);const item=node as ReactElement<Record<string,unknown>>;return match(item)?item:find(item.props?.children,match);
}
const id='412302a8-3694-4718-9a3b-e5de1a78de6e',task='112302a8-3694-4718-9a3b-e5de1a78de6e';
const data={threads:[{id,commentUrl:'https://www.facebook.com/groups/demo/posts/10?comment_id=101',commentId:'101',registeredAt:'2026-09-01T21:30:00Z'}],responses:[{id:task,threadId:id,commentUrl:'https://www.facebook.com/groups/demo/posts/10?comment_id=101&reply_comment_id=202',text:'DEMO public response',parentCommentId:'101',capturedAt:'2026-09-01T21:30:00Z',taskId:task}],partial:true,captureStatus:null,autonomousCollectionEnabled:false};
beforeEach(()=>{hooks.reset();vi.stubGlobal('window',{location:{search:'?section=community&threadId='+id,href:'https://life-skills.example.invalid/en/app/marketing?section=community&threadId='+id},setTimeout:(fn:()=>void)=>{fn();return 1;},clearTimeout:vi.fn(),history:{replaceState:vi.fn()}});vi.stubGlobal('fetch',vi.fn());});
test.each(['en','he'] as const)('%s clears a failed deep-link filter while preserving entered tracking input',async locale=>{
 vi.mocked(fetch).mockImplementation(async(url,options)=>options?.method==='PUT'?Response.json({ok:false},{status:503}):String(url).includes('threadId=')?Response.json({ok:false},{status:404}):Response.json({ok:true,data}));
 const render=()=>hooks.render(()=>CommunityThreadPanel({locale,posts:[]}));let tree=render();hooks.flush();for(let i=0;i<12;i++)await Promise.resolve();tree=render();
 const input=find(tree,item=>item.type==='input'&&item.props.type==='url')!;(input.props.onChange as (e:unknown)=>void)({target:{value:'https://www.facebook.com/groups/demo/posts/20?comment_id=303'}});tree=render();
 const all=find(tree,item=>item.type==='button'&&item.props.children===(locale==='en'?'All tracked replies':'כל התגובות במעקב'));expect(all).toBeDefined();
 (all!.props.onClick as ()=>void)();for(let i=0;i<12;i++)await Promise.resolve();tree=render();
 expect(vi.mocked(fetch).mock.calls.at(-1)?.[0]).toBe('/api/community-threads');expect(window.history.replaceState).toHaveBeenCalled();
 expect(find(tree,item=>item.type==='input'&&item.props.type==='url')!.props.value).toContain('posts/20');
 expect(find(tree,item=>item.type==='a'&&item.props.href===`/${locale}/app/calendar?date=2026-09-02&view=agenda&taskId=${task}#task-${task}`)).toBeDefined();
});
