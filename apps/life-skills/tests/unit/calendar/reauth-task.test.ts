import type {ReactElement} from 'react';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({index:0,session:vi.fn()}));
vi.mock('react',async original=>({...await original<typeof import('react')>(),useState:(value:unknown)=>{const i=state.index++;return [i===4?false:i===5?'auth':value,vi.fn()];},useEffect:()=>{},useRef:(value:unknown)=>({current:value}),useCallback:(fn:unknown)=>fn}));
vi.mock('next/navigation',()=>({useRouter:()=>({push:vi.fn(),replace:vi.fn()}),notFound:()=>{throw Error('NOT_FOUND');},redirect:(url:string)=>{throw Error(url);}}));
vi.mock('../../../src/features/calendar/page-session.ts',()=>({calendarPageSession:state.session}));
vi.mock('../../../src/features/calendar/form-support.tsx',()=>({useDialogGuard:()=>{},useCalendarMutation:()=>({locked:false,uncertain:false,run:vi.fn()})}));
import Page from '../../../src/app/[locale]/app/calendar/page.tsx';
import {CalendarWorkspace} from '../../../src/features/calendar/workspace.tsx';
function find(node:unknown,predicate:(item:ReactElement<Record<string,unknown>>)=>boolean):ReactElement<Record<string,unknown>>|undefined{
 if(!node||typeof node!=='object')return;if(Array.isArray(node))return node.map(n=>find(n,predicate)).find(Boolean);
 const item=node as ReactElement<Record<string,unknown>>;return predicate(item)?item:find(item.props?.children,predicate);
}
const id='123e4567-e89b-42d3-a456-426614174000';
beforeEach(()=>{state.index=0;state.session.mockResolvedValue({role:'practitioner'});});
it.each(['he','en'] as const)('retains the exact %s task in the actual Calendar async-auth recovery control',async locale=>{
 const page=await Page({params:Promise.resolve({locale}),searchParams:Promise.resolve({date:'2026-10-02',view:'agenda',taskId:id})});
 expect(page.props.initialTaskId).toBe(id);
 const tree=CalendarWorkspace(page.props),layer=find(tree,item=>typeof item.props?.renderCalendar==='function')!;
 const recovery=(layer.props.renderCalendar as (value:unknown)=>unknown)({items:[],onOpen:vi.fn()});
 const link=find(recovery,item=>item.type==='a')!;
 expect(new URL(String(link.props.href),'https://private.invalid').searchParams.get('next')).toBe(`/${locale}/app/calendar?date=2026-10-02&view=agenda&taskId=${id}`);
});
it.each(['invalid',[id,id]])('does not pass malformed or repeated task context into the retained Calendar: %j',async taskId=>{
 const page=await Page({params:Promise.resolve({locale:'en'}),searchParams:Promise.resolve({taskId})});
 expect(page.props.initialTaskId??'').toBe('');
});
