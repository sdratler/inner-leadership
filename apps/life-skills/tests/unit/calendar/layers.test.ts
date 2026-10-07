import {renderToStaticMarkup} from 'react-dom/server';
import {expect,it} from 'vitest';
import {calendarLayerQuery,initialCalendarLayers,calendarLayersQuery} from '../../../src/features/calendar/layers.ts';
import {WorkspaceShell} from '../../../src/ui/workspace/workspace-shell.tsx';
it('defaults to operational practitioner tasks/followups with optional practice/content and retains customer practice',()=>{
 expect(initialCalendarLayers({},true,true)).toEqual({tasks:true,followups:true,practice:false,content:false});
 expect(initialCalendarLayers({},false,true).practice).toBe(true);
});
it.each(['0','1'] as const)('parses exact single %s presentation selectors only',value=>{
 expect(calendarLayerQuery(new URLSearchParams({tasks:value,followups:value,practice:value,content:value,role:'practitioner'}))).toEqual({tasks:value,followups:value,practice:value,content:value});
});
it.each(['true','false','constructor','__proto__','01',' 1','1\n',''])('ignores malformed %j selectors without altering defaults',value=>{
 expect(calendarLayerQuery(new URLSearchParams({tasks:value,followups:value,practice:value,content:value}))).toEqual({});
});
it('drops repeated selectors and does not grant Content access to DEMO or customer roles',()=>{
 expect(calendarLayerQuery(new URLSearchParams('tasks=1&tasks=0&content=1&content=1'))).toEqual({});
 expect(initialCalendarLayers({content:'1'},true,false).content).toBe(false);
 expect(initialCalendarLayers({content:'1'},false,true).content).toBe(false);
 expect(calendarLayersQuery(initialCalendarLayers({tasks:'0',followups:'0',practice:'1',content:'1'},true,true))).toEqual({tasks:'0',followups:'0',practice:'1',content:'1'});
});
it.each(['he','en'] as const)('keeps %s current-calendar header views and date/case with chosen layers without polluting other sections',locale=>{
 const caseId='123e4567-e89b-42d3-a456-426614174000';
 function Shell(){return WorkspaceShell({locale,role:'practitioner',pathname:`/${locale}/app/calendar`,caseId,date:'2026-10-05',view:'week',calendarLayers:{tasks:'0',followups:'1',practice:'1',content:'1'},languageHref:`/${locale==='he'?'en':'he'}/app/calendar`,children:'Synthetic content'});}
 const html=renderToStaticMarkup(createElement(Shell));
 const header=html.split('<nav class="lsu-top-tabs"')[1]!.split('</nav>')[0]!;
 const hrefs=[...header.matchAll(/href="([^"]+)"/g)].map(match=>new URL(match[1]!.replaceAll('&amp;','&'),'https://private.invalid'));
 expect(hrefs).toHaveLength(4);
 expect(hrefs.map(url=>url.searchParams.get('view'))).toEqual(['day','week','month','agenda']);
 for(const url of hrefs)expect(Object.fromEntries(url.searchParams)).toMatchObject({caseId,date:'2026-10-05',tasks:'0',followups:'1',practice:'1',content:'1'});
 for(const match of html.matchAll(/href="([^"]+)"/g)){const url=new URL(match[1]!.replaceAll('&amp;','&'),'https://private.invalid');if(!url.pathname.endsWith('/app/calendar'))expect(url.searchParams.has('content')).toBe(false);}
});
import {createElement} from 'react';
