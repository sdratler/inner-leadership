import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,describe,expect,it,vi} from 'vitest';
import type {Locale} from '../../src/lib/locale.ts';
import type {AcademyRouteMode} from '../../src/features/group-application/academy-routing.ts';
import {academyPath} from '../../src/features/group-application/academy-routing.ts';
import {academyExactCurriculum} from '../../src/features/group-application/academy-exact-copy.ts';

const hooks=vi.hoisted(()=>({mode:'bna' as AcademyRouteMode,subscribe:null as null|((notify:()=>void)=>()=>void)}));
vi.mock('react',async()=>{
 const actual=await vi.importActual<typeof import('react')>('react');
 return {...actual,useId:()=>'age-test',useSyncExternalStore:(subscribe:(notify:()=>void)=>()=>void,snapshot:()=>string,server:()=>string)=>{
  hooks.subscribe=subscribe;return typeof window==='undefined'?server():snapshot();
 }};
});
vi.mock('../../src/features/group-application/academy-campaign-state.ts',()=>({useAcademyCampaign:()=>null}));
vi.mock('../../src/features/group-application/academy-route-context.tsx',()=>({useAcademyHref:()=>(locale:Locale,path='')=>academyPath(locale,path,hooks.mode)}));
vi.mock('../../src/features/group-application/academy-site-frame.tsx',()=>({AcademySiteFrame:({children}:{children:React.ReactNode})=>React.createElement('div',null,children)}));
import {AcademyStage,academyAgeHref,academyAgeIndex} from '../../src/features/group-application/academy-stage.tsx';

function browser(start:string){
 const events=new EventTarget(),entries=[new URL(start)],state={nextRouterState:'preserved'};let cursor=0;
 const assigned:string[]=[];
 const location={get href(){return entries[cursor]!.href;},get search(){return entries[cursor]!.search;},assign:(href:string)=>{assigned.push(href);}};
 const history={state,pushState:vi.fn((nextState:unknown,_title:string,path:string)=>{
  expect(nextState).toBe(state);entries.splice(cursor+1);entries.push(new URL(path,location.href));cursor++;
 }),back:()=>{if(cursor>0){cursor--;events.dispatchEvent(new Event('popstate'));}},forward:()=>{if(cursor<entries.length-1){cursor++;events.dispatchEvent(new Event('popstate'));}}};
 vi.stubGlobal('window',{location,history,addEventListener:events.addEventListener.bind(events),removeEventListener:events.removeEventListener.bind(events),dispatchEvent:events.dispatchEvent.bind(events)});
 return {location,history,assigned};
}
function view(locale:Locale='en',slug='foundation'){return AcademyStage({locale,slug})!;}
function descendants(node:React.ReactNode):React.ReactElement<Record<string,unknown>>[]{
 if(!React.isValidElement<Record<string,unknown>>(node))return [];
 return [node,...React.Children.toArray(node.props.children as React.ReactNode).flatMap(descendants)];
}
function choose(index:number){
 const input=descendants(view()).find(n=>n.type==='input'&&n.props['data-age-choice']===index)!;
 (input.props.onChange as ()=>void)();
}
afterEach(()=>{vi.unstubAllGlobals();hooks.mode='bna';hooks.subscribe=null;});

describe('curriculum presentation age URL continuity',()=>{
 it.each(['','?age=','?age=adult','?age=11–13','?age=11-13&age=14-17','?age=14-17&age=14-17','?AGE=14-17'])('safely defaults invalid/missing/duplicate query %s',search=>expect(academyAgeIndex(search)).toBe(0));
 it.each([['8-10',0],['11-13',1],['14-17',2]] as const)('reads only exact shareable %s', (age,index)=>expect(academyAgeIndex('?other=kept&age='+age)).toBe(index));
 it('never inserts an unvalidated age into links',()=>{
  expect(academyAgeHref('/fishing-academy/stages/advanced',99)).toBe('/fishing-academy/stages/advanced');
  expect(academyAgeHref('/fishing-academy/stages/advanced',0)).toBe('/fishing-academy/stages/advanced');
 });
 it('keeps ordinary locale anchors for the server-rendered default without requiring JavaScript',()=>{
  const page=view();expect(page.props.onLocaleChange).toBeUndefined();
  expect(renderToStaticMarkup(page)).toMatch(/data-age-choice="0"[^>]*checked=""/);
 });
 for(const mode of ['bna','legacy'] as const)for(const locale of ['en','he'] as const)it(`${mode}/${locale} keeps selected age across every stage and locale, without changing registration`,()=>{
  hooks.mode=mode;const b=browser('https://example.test'+academyPath(locale,'/stages/foundation',mode)+'?age=14-17');
  const page=view(locale),html=renderToStaticMarkup(page);
  expect(html).toMatch(/data-age-choice="2"[^>]*checked=""/);
  for(const stage of academyExactCurriculum.stages)expect(html).toContain(`href="${academyPath(locale,'/stages/'+stage.slug,mode)}?age=14-17"`);
  expect(html).toContain(`href="${academyPath(locale,'/apply',mode)}"`);
  const other=locale==='en'?'he':'en';page.props.onLocaleChange!(other);
  expect(b.assigned).toEqual([academyPath(other,'/stages/foundation',mode)+'?age=14-17']);
  expect(page.props.path).toBe('/stages/foundation'); // canonical metadata receives no presentation query
  expect(html).not.toContain('name="stageInterest"');
 });
 it('preserves URL fields and Next history state; Back/Forward restores age and cleanup detaches listeners',()=>{
  const b=browser('https://example.test/fishing-academy/stages/foundation?campaign=kept#lessons');
  view();const changed=vi.fn(),unsubscribe=hooks.subscribe!(changed);
  choose(1);expect(b.location.search).toBe('?campaign=kept&age=11-13');expect(b.location.href).toContain('#lessons');
  choose(2);expect(academyAgeIndex(b.location.search)).toBe(2);
  b.history.back();expect(academyAgeIndex(b.location.search)).toBe(1);
  expect(renderToStaticMarkup(view())).toMatch(/data-age-choice="1"[^>]*checked=""/);
  b.history.forward();expect(academyAgeIndex(b.location.search)).toBe(2);expect(changed).toHaveBeenCalledTimes(4);
  choose(2);expect(b.history.pushState).toHaveBeenCalledTimes(2);
  unsubscribe();b.history.back();expect(changed).toHaveBeenCalledTimes(4);
 });
 for(const locale of ['en','he'] as const)it(`${locale} keeps all twelve exact lesson entries and three panels at each age`,()=>{
  for(const stage of academyExactCurriculum.stages)for(const age of ['8-10','11-13','14-17']){
   browser('https://example.test/fishing-academy/stages/'+stage.slug+'?age='+age);
   const nodes=descendants(view(locale,stage.slug));
   const list=nodes.find(n=>n.type==='ol'&&'data-academy-lesson-list' in n.props)!;
   const items=React.Children.toArray(list.props.children as React.ReactNode) as React.ReactElement[];
   expect(items).toHaveLength(12);
   stage.lessons.forEach((lesson,index)=>{
    const text=renderToStaticMarkup(items[index]!);
    expect(text).toContain(renderToStaticMarkup(React.createElement('h3',null,lesson.title[locale])));
    expect(text).toContain(renderToStaticMarkup(React.createElement('p',null,lesson.description[locale])));
    expect(items[index]!.key).toContain(lesson.rmId);
   });
   expect(nodes.filter(n=>'data-age-panel' in n.props)).toHaveLength(3);
  }
 });
});
