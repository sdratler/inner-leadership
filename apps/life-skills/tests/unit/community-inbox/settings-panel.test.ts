import React from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe,expect,it,vi} from "vitest";
import {ScoutControlsForm,ScoutRuntimeReadback} from "../../../src/features/community-reply/settings-panel.tsx";
import type {CommunitySettings} from "../../../src/features/community-reply/settings-bridge.ts";
const settings:CommunitySettings={asOf:"2026-10-02T10:00:00.000Z",collection:{authorized:false,allowedGroupCount:0,providerConfigured:false,eligible:false,maxItemsPerRun:250,workerEnabled:true,autoDraft:false},limits:{aiRequestsPerUtcDay:30,manualReplyTotal:1,manualReplyUsed:1,manualReplyRemaining:0},usageTodayUtc:{requests:0,inputTokens:0,outputTokens:0,moneyCost:null},queue:{jobs:{},posts:{}},controls:{revision:0,updatedAt:null,settings:{groups:[],lookbackDays:7,schedule:{requested:false,localTime:null,timezone:"Asia/Jerusalem"},limits:{postsPerRun:250,draftsPerDay:0,threadsPerRun:0},budgets:{currency:"USD",scrapingMonthCents:null,aiMonthCents:null},autoDraftRequested:false}}};
describe("honest centralized bilingual Scout settings",()=>{
 it.each(['en','he'] as const)('%s separates Sources from Budget while retaining one complete settings payload',locale=>{
  const value={...settings.controls.settings,groups:[{url:'https://www.facebook.com/groups/demo-public/',enabled:false}],budgets:{currency:'USD' as const,scrapingMonthCents:100,aiMonthCents:200}},onChange=vi.fn();
  const common={locale,runtime:settings,value,approve:false,busy:false,dirty:true,onChange,onApprove:()=>{},onSave:()=>{}};
  const sources=renderToStaticMarkup(React.createElement(ScoutControlsForm,{...common,view:'sources'})),budget=renderToStaticMarkup(React.createElement(ScoutControlsForm,{...common,view:'budget'}));
  expect(sources).toContain('type="url"');expect(sources).toContain('type="time"');expect(sources).not.toContain('max="1000000"');expect(sources).toContain('communityView=budget');
  expect(budget).not.toContain('type="url"');expect(budget).not.toContain('type="time"');expect(budget).toContain('max="1000000"');expect(budget).toContain(locale==='he'?'אינה מגדירה ספק':'does not configure a provider');
  const tree=ScoutControlsForm({...common,view:'budget'}),inputs:React.ReactElement<Record<string,unknown>>[]=[];
  const walk=(node:unknown)=>{if(Array.isArray(node)){node.forEach(walk);return;}if(!node||typeof node!=='object')return;const item=node as React.ReactElement<Record<string,unknown>>;if(item.type==='input'&&item.props.max==='1000000')inputs.push(item);walk(item.props?.children);};walk(tree);
  (inputs[0]!.props.onChange as (e:unknown)=>void)({target:{value:'300'}});expect(onChange).toHaveBeenCalledWith({...value,budgets:{...value.budgets,scrapingMonthCents:300}});expect(value.groups[0]!.url).toBe('https://www.facebook.com/groups/demo-public/');
 });
 it.each(["en","he"] as const)("%s: renders unknown monetary cost and actual configured state without claiming scheduled proof",locale=>{
  const html=renderToStaticMarkup(React.createElement(ScoutRuntimeReadback,{locale,settings}));expect(html).toContain(locale==="en"?"unknown is not zero":"מצב לא ידוע אינו אפס");expect(html).toContain(locale==="en"?"Eligibility is not proof":"כשירות אינה הוכחה");expect(html).toContain("1 / 0 / 1");expect(html).not.toContain("$0");
 });
 it.each(["en","he"] as const)("%s: requested settings are distinct, bounded, keyboard-native controls with no invented time or ceiling",locale=>{
  const html=renderToStaticMarkup(React.createElement(ScoutControlsForm,{locale,runtime:settings,value:settings.controls.settings,approve:false,busy:false,dirty:true,onChange:()=>{},onApprove:()=>{},onSave:()=>{}}));expect(html).toContain('type="time" value=""');expect(html).toContain('value="7" selected=""');expect(html).toContain('max="15"');expect(html).toContain("Asia/Jerusalem");expect(html).toContain(locale==="en"?"does not configure a provider":"אינה מגדירה ספק");expect(html).toContain(locale==="en"?"Blank means not authorized":"שדה ריק משמעו אין אישור");expect(html).not.toContain('type="checkbox" checked');
 });
 it("keeps saved requests visible after a runtime limit is lowered, rather than silently clamping or activating them",()=>{
  const html=renderToStaticMarkup(React.createElement(ScoutControlsForm,{locale:"en",runtime:{...settings,collection:{...settings.collection,maxItemsPerRun:5}},value:settings.controls.settings,approve:false,busy:false,dirty:false,onChange:()=>{},onApprove:()=>{},onSave:()=>{}}));expect(html).toContain("Saved requests exceed a current runtime limit");expect(html).toContain('value="250"');expect(html).toContain('type="submit" disabled');
 });
 it.each(['en','he'] as const)('%s requires renewed exact approval after either monthly amount changes',locale=>{
  const value={...settings.controls.settings,budgets:{currency:'USD' as const,scrapingMonthCents:100,aiMonthCents:200}};
  const onChange=vi.fn(),onApprove=vi.fn();
  const tree=ScoutControlsForm({locale,runtime:settings,value,approve:true,busy:false,dirty:true,onChange,onApprove,onSave:()=>{}});
  const inputs:React.ReactElement<Record<string,unknown>>[]=[];
  const walk=(node:unknown)=>{if(Array.isArray(node)){node.forEach(walk);return;}if(!node||typeof node!=='object')return;const item=node as React.ReactElement<Record<string,unknown>>;if(item.type==='input'&&item.props.max==='1000000')inputs.push(item);walk(item.props?.children);};walk(tree);
  expect(inputs).toHaveLength(2);
  for(const [index,name] of (['scrapingMonthCents','aiMonthCents'] as const).entries()){
   onApprove.mockClear();(inputs[index]!.props.onChange as (e:unknown)=>void)({target:{value:'300'}});expect(onApprove).toHaveBeenCalledWith(false);expect(onChange).toHaveBeenLastCalledWith({...value,budgets:{...value.budgets,[name]:300}});
   onApprove.mockClear();(inputs[index]!.props.onChange as (e:unknown)=>void)({target:{value:''}});expect(onApprove).toHaveBeenCalledWith(false);
   onApprove.mockClear();(inputs[index]!.props.onChange as (e:unknown)=>void)({target:{value:String(value.budgets[name])}});expect(onApprove).not.toHaveBeenCalled();
  }
 });
});
