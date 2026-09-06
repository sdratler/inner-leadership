import React from 'react';
import { describe,expect,it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { GalleryFrame,initialGalleryState } from './gallery-frame.tsx';
import { Button } from './controls.tsx';
import { VisibilityControl } from './practice.tsx';
import { NoticeReceipt,CreditBalance } from './appointments.tsx';
import { localHref,tabStep,validParentSelection,checkedPage } from './model.ts';
import { uiCopy,formatInstant } from './i18n.ts';
import messages from './messages.json';
describe('LS-020 real React rendering and foundation interfaces',()=>{
 it('keeps translation keys identical',()=>expect(Object.keys(messages.he).sort()).toEqual(Object.keys(messages.en).sort()));
 for(const locale of ['he','en'] as const)for(const role of ['parent','practitioner'] as const){
  it(`${locale} ${role}: renders semantic shell and separate parent identities`,()=>{
   const html=renderToStaticMarkup(React.createElement(GalleryFrame,{locale,role,state:initialGalleryState,onEvent:()=>undefined}));
   expect(html).toContain(`dir="${locale==='he'?'rtl':'ltr'}"`);
   expect((html.match(/<h1(?:\s|>)/g)||[]).length).toBe(1);
   expect(html).toContain('id="lsw-main"');expect(html).toContain(uiCopy(locale).notReported);
   expect(html).not.toMatch(/href="[^\"]*\/(child|student)\b/);
   expect(html).not.toContain('undefined');
  });
 }
 it('keeps a busy button named',()=>{const html=renderToStaticMarkup(<Button busy>Save</Button>);expect(html).toContain('disabled=""');expect(html).toContain('Save');});
 it('never offers a share control for a private practitioner note',()=>{const html=renderToStaticMarkup(<VisibilityControl id="note" locale="en" value="private" audience={[]} isPrivateNote onChange={()=>undefined}/>);expect(html).not.toContain('<button');expect(html).not.toContain('<dialog');});
 it('asks for confirmation before changing private visibility',()=>{const html=renderToStaticMarkup(<VisibilityControl id="share" locale="en" value="private" audience={['Synthetic parent A','Synthetic parent B']} onChange={()=>undefined}/>);expect((html.match(/<dialog\b/g)||[]).length).toBe(2);expect(html).toContain('Synthetic parent A');});
 it('renders server credit state without calculating it',()=>{const html=renderToStaticMarkup(<NoticeReceipt locale="en" receipt={{originalStartsAt:'2026-09-09T13:00:00Z',receivedAt:'2026-09-09T12:59:00Z',credit:'protected',replacement:'pending'}}/>);expect(html).toContain(uiCopy('en').creditProtected);expect(html).toContain(uiCopy('en').pendingReplacement);});
 it('does not turn unknown credit into zero',()=>{const html=renderToStaticMarkup(<CreditBalance locale="en" credits={null} asOf="2026-09-06T09:00:00Z"/>);expect(html).toContain(uiCopy('en').unknown);});
 it('rejects nonlocal navigation',()=>{for(const href of ['javascript:alert(1)','//example.test','https://example.test','/a\\b'])expect(()=>localHref(href)).toThrow();});
 it('keeps native Hebrew roving tab order',()=>{expect(tabStep(0,'ArrowLeft',3,true)).toBe(1);expect(tabStep(0,'ArrowRight',3,true)).toBe(2);});
 it('rejects empty or unauthorized assignee selections',()=>{expect(validParentSelection([],['a'])).toBe(false);expect(validParentSelection(['b'],['a'])).toBe(false);expect(validParentSelection(['a'],['a'])).toBe(true);});
 it('rejects oversized rendered pages',()=>expect(()=>checkedPage({items:Array.from({length:51},(_,i)=>i),page:1,totalPages:1})).toThrow());
 it('uses the foundation timestamp validator',()=>{expect(()=>formatInstant('2026-09-06T09:00:00','en')).toThrow();expect(()=>formatInstant('2026-02-30T09:00:00Z','en')).toThrow();});
});
