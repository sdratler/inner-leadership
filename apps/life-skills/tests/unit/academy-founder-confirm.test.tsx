import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe,expect,it} from 'vitest';
import {AcademyFounderConfirm,AcademyConfirmationOutcome,readConfirmationContext,readConfirmedResult,confirmationStateFromContext} from '../../src/features/group-application/academy-founder-confirm.tsx';
import {academyExactStates} from '../../src/features/group-application/academy-exact-copy.ts';

describe('confirmation context readback',()=>{
 const data={available:true,confirmed:false,deadline:'2026-10-30T14:00:00.000Z',founderRateReserved:false,unusable:false};
 it('uses explicit server availability and confirmation, without a client expiry decision',()=>{
  expect(readConfirmationContext({ok:true,data})).toEqual(data);
  expect(readConfirmationContext({ok:true,data:{...data,available:false,confirmed:true}})).toEqual({...data,available:false,confirmed:true});
  expect(readConfirmationContext({ok:true,data:{available:false,confirmed:false,deadline:null}})).toEqual({available:false,confirmed:false,deadline:null,founderRateReserved:false,unusable:false});
 });
 it.each([undefined,null,{},false,{ok:false,data},{ok:'true',data},{ok:true},{ok:true,data:{...data,available:'true'}},{ok:true,data:{...data,confirmed:'true'}},{ok:true,data:{...data,deadline:undefined}},{ok:true,data:{...data,deadline:'not-a-date'}},{ok:true,data:{...data,deadline:'2026-99-99T00:00:00Z'}},{ok:true,data:{...data,deadline:{}}}])('rejects an incomplete or untrusted success body %#',body=>{
  expect(readConfirmationContext(body)).toBeNull();
 });
 for(const locale of ['en','he'] as const)it(locale+' starts with an honest check, no enabled confirmation or fabricated deadline',()=>{
  const rendered=renderToStaticMarkup(<AcademyFounderConfirm locale={locale}/>);
  const html=rendered.slice(rendered.indexOf('<main id="main"'),rendered.indexOf('</main>')+7);
  expect(html).toContain('lang="'+locale+'"');expect(html).toContain('dir="'+(locale==='he'?'rtl':'ltr')+'"');
  expect(html).toContain('role="status"');expect(html).not.toContain('<button');
  expect(html).toContain(academyExactStates[locale].confirmation.heading);
  expect(html).toContain(academyExactStates[locale].confirmation.smallLine);
  expect(html).not.toContain(locale==='he'?'המועד האחרון לאישור:':'Confirmation deadline:');
 });
 it('never infers founder reservation from a successful or confirmed legacy response',()=>{
  expect(readConfirmedResult({ok:true,data:{confirmed:true}})).toEqual({founderRateReserved:false,alreadyConfirmed:false});
  expect(readConfirmedResult({ok:true,data:{confirmed:true,founderRateReserved:true}})).toEqual({founderRateReserved:true,alreadyConfirmed:false});
  expect(readConfirmationContext({ok:true,data:{...data,confirmed:true}})?.founderRateReserved).toBe(false);
  for(const flag of ['true',1,null,{},[]]){
   expect(readConfirmationContext({ok:true,data:{...data,founderRateReserved:flag}})).toBeNull();
   expect(readConfirmedResult({ok:true,data:{confirmed:true,founderRateReserved:flag}})).toBeNull();
  }
  for(const body of [null,{}, {ok:true},{ok:true,data:{confirmed:false}},{ok:true,data:{confirmed:'true'}},{ok:false,data:{confirmed:true}}])expect(readConfirmedResult(body)).toBeNull();
 });
 for(const locale of ['en','he'] as const)for(const alreadyConfirmed of [false,true])for(const founderRateReserved of [false,true])it(`${locale} result distinguishes existing confirmation and actual founder reservation (${alreadyConfirmed}/${founderRateReserved})`,()=>{
  const copy=academyExactStates[locale].confirmation;
  const html=renderToStaticMarkup(<AcademyConfirmationOutcome locale={locale} alreadyConfirmed={alreadyConfirmed} founderRateReserved={founderRateReserved}/>);
  expect(html).toContain(alreadyConfirmed?copy.alreadyConfirmed:copy.confirmedHeading);
  expect(html.includes(copy.founderSentence)).toBe(founderRateReserved);
  expect(html).not.toContain('<button');expect(html).not.toContain('<a');
  expect(html).not.toContain(alreadyConfirmed?copy.confirmedText:copy.alreadyConfirmed);
 });

 it('unknown readiness never becomes a terminal-link claim without server evidence',()=>{
  for(const unusable of [undefined,false]){
   const context=readConfirmationContext({ok:true,data:{available:false,confirmed:false,deadline:null,...(unusable===undefined?{}:{unusable})}})!;
   expect(context.unusable).toBe(false);expect(confirmationStateFromContext(context)).toBe('not_ready');
  }
  const terminal=readConfirmationContext({ok:true,data:{available:false,confirmed:false,deadline:null,unusable:true}})!;
  expect(confirmationStateFromContext(terminal)).toBe('unavailable');
  expect(confirmationStateFromContext({...terminal,unusable:false,available:true})).toBe('available');
  expect(confirmationStateFromContext({...terminal,unusable:false,confirmed:true})).toBe('already_confirmed');
 });
 it('rejects malformed or contradictory terminal and replay evidence',()=>{
  for(const unusable of ['true',1,null,{}])expect(readConfirmationContext({ok:true,data:{...data,unusable}})).toBeNull();
  expect(readConfirmationContext({ok:true,data:{...data,unusable:true}})).toBeNull();
  expect(readConfirmationContext({ok:true,data:{...data,available:false,confirmed:true,unusable:true}})).toBeNull();
  expect(readConfirmedResult({ok:true,data:{confirmed:true,alreadyConfirmed:true,founderRateReserved:false}})).toEqual({founderRateReserved:false,alreadyConfirmed:true});
  expect(readConfirmedResult({ok:true,data:{confirmed:true,alreadyConfirmed:'true'}})).toBeNull();
 });
 for(const locale of ['en','he'] as const)it(locale+' reuses the Academy shell without exposing the token in language links',()=>{
  const html=renderToStaticMarkup(<AcademyFounderConfirm locale={locale}/>);
  expect(html).toContain('data-academy-header');expect(html).toContain('data-academy-footer');
  expect(html).toContain('id="main"');expect(html).toContain('lang="'+locale+'"');
  expect(html).not.toContain('confirm-interest#');
  expect(html).toMatch(/<button[^>]*lang="en"/);expect(html).toMatch(/<button[^>]*lang="he"/);
 });
});
