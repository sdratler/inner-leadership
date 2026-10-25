import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {AcademyFounderConfirm,readConfirmationContext} from '../../src/features/group-application/academy-founder-confirm.tsx';

describe('confirmation context readback',()=>{
 const data={available:true,confirmed:false,deadline:'2026-10-30T14:00:00.000Z'};
 it('uses explicit server availability and confirmation, without a client expiry decision',()=>{
  expect(readConfirmationContext({ok:true,data})).toEqual(data);
  expect(readConfirmationContext({ok:true,data:{...data,available:false,confirmed:true}})).toEqual({...data,available:false,confirmed:true});
  expect(readConfirmationContext({ok:true,data:{available:false,confirmed:false,deadline:null}})).toEqual({available:false,confirmed:false,deadline:null});
 });
 it.each([undefined,null,{},false,{ok:false,data},{ok:'true',data},{ok:true},{ok:true,data:{...data,available:'true'}},{ok:true,data:{...data,confirmed:'true'}},{ok:true,data:{...data,deadline:undefined}},{ok:true,data:{...data,deadline:'not-a-date'}},{ok:true,data:{...data,deadline:'2026-99-99T00:00:00Z'}},{ok:true,data:{...data,deadline:{}}}])('rejects an incomplete or untrusted success body %#',body=>{
  expect(readConfirmationContext(body)).toBeNull();
 });
 for(const locale of ['en','he'] as const)it(locale+' starts with an honest check, no enabled confirmation or fabricated deadline',()=>{
  const html=renderToStaticMarkup(<AcademyFounderConfirm locale={locale}/>);
  expect(html).toContain('lang="'+locale+'"');expect(html).toContain('dir="'+(locale==='he'?'rtl':'ltr')+'"');
  expect(html).toContain('role="status"');expect(html).not.toContain('<button');
  expect(html).toContain(locale==='he'?'פתיחת העמוד אינה מאשרת דבר.':'Opening this page does not confirm anything.');
  expect(html).not.toContain(locale==='he'?'המועד האחרון לאישור:':'Confirmation deadline:');
 });
});
