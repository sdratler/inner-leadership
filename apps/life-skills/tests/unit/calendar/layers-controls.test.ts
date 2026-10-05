import type {ReactElement} from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({index:0,values:[] as unknown[],query:'',replace:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:(initial:unknown)=>{
 const i=state.index++;if(!(i in state.values))state.values[i]=typeof initial==='function'?(initial as ()=>unknown)():initial;
 return[state.values[i],(next:unknown)=>{state.values[i]=typeof next==='function'?(next as (old:unknown)=>unknown)(state.values[i]):next;}];
},useEffect:()=>{},useRef:(value:unknown)=>({current:value}),useMemo:(fn:()=>unknown)=>fn(),useCallback:(fn:unknown)=>fn}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:state.replace}),useSearchParams:()=>new URLSearchParams(state.query)}));
vi.mock('../../../src/features/calendar/form-support.tsx',()=>({useDialogGuard:()=>{},useCalendarMutation:()=>({locked:false,uncertain:false,run:vi.fn()})}));
import {CalendarWorkspace} from '../../../src/features/calendar/workspace.tsx';
function checkboxes(node:unknown):ReactElement<Record<string,unknown>>[]{
 if(!node||typeof node!=='object')return[];if(Array.isArray(node))return node.flatMap(checkboxes);
 const item=node as ReactElement<Record<string,unknown>>;return item.type==='input'&&item.props.type==='checkbox'?[item]:checkboxes(item.props?.children);
}
const render=()=>{state.index=0;return checkboxes(CalendarWorkspace({locale:'en',role:'practitioner',initialDate:'2026-10-05',initialView:'week'}));};
beforeEach(()=>{state.index=0;state.values=[];state.query='date=2026-10-05&view=week';state.replace.mockReset();});
it.each([['tasks',0,true],['followups',1,true],['practice',2,false],['content',3,false]] as const)('%s checkbox responds before async URL navigation and adopts the final URL', (key,index,initial)=>{
 expect(render()[index]?.props.checked).toBe(initial);
 (render()[index]!.props.onChange as (event:unknown)=>void)({target:{checked:!initial}});
 expect(render()[index]?.props.checked).toBe(!initial);
 const target=new URL(state.replace.mock.calls[0]![0],'https://private.invalid');expect(target.searchParams.get(key)).toBe(initial?'0':'1');state.query=target.search.slice(1);expect(render()[index]?.props.checked).toBe(!initial);
});
it('adopts Back/query changes without reviving a stale optimistic override',()=>{
 (render()[3]!.props.onChange as (event:unknown)=>void)({target:{checked:true}});expect(render()[3]?.props.checked).toBe(true);
 state.query='date=2026-10-05&view=agenda&content=1';expect(render()[3]?.props.checked).toBe(true);
 state.query='date=2026-10-05&view=week';expect(render()[3]?.props.checked).toBe(false);expect(render()[3]?.props.checked).toBe(false);
});
