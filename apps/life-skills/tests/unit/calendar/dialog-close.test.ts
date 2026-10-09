import { describe,expect,it,vi } from 'vitest';
import { finalizeDialogClose,restoreDialogOpenerFocus } from '../../../src/ui/workspace/dialogs.tsx';
import {guardCalendarDialogEscape} from '../../../src/features/calendar/form-support.tsx';

describe('Calendar Escape guard',()=>{
 it('blocks native close before opening a confirmation, even when the user declines',()=>{
  const order:string[]=[],event={key:'Escape',preventDefault:()=>order.push('prevent'),stopPropagation:()=>order.push('stop')};
  expect(guardCalendarDialogEscape(event,()=>order.push('confirm-declined'))).toBe(true);
  expect(order).toEqual(['prevent','stop','confirm-declined']);
 });
 it('allows one explicit approved close instead of a second native close request',()=>{
  const event={key:'Escape',preventDefault:vi.fn(),stopPropagation:vi.fn()},close=vi.fn();
  expect(guardCalendarDialogEscape(event,close)).toBe(true);expect(close).toHaveBeenCalledOnce();expect(event.preventDefault).toHaveBeenCalledBefore(close);
 });
 it('leaves ordinary keys alone',()=>{
  const event={key:'Enter',preventDefault:vi.fn(),stopPropagation:vi.fn()},close=vi.fn();
  expect(guardCalendarDialogEscape(event,close)).toBe(false);expect(close).not.toHaveBeenCalled();expect(event.preventDefault).not.toHaveBeenCalled();expect(event.stopPropagation).not.toHaveBeenCalled();
 });
});

describe('native dialog close finalization',()=>{
 it('finalizes a genuinely closed dialog',()=>{
  const finalize=vi.fn();expect(finalizeDialogClose({open:false},finalize)).toBe(true);expect(finalize).toHaveBeenCalledOnce();
 });
 it('does not finalize a delayed close event after reopening',()=>{
  const finalize=vi.fn();expect(finalizeDialogClose({open:true},finalize)).toBe(false);expect(finalize).not.toHaveBeenCalled();
 });
 it('preserves the new selection until the reopened dialog closes',()=>{
  const dialog={open:true};let selection:string|null='second-occurrence';const clear=()=>{selection=null;};
  expect(finalizeDialogClose(dialog,clear)).toBe(false);expect(selection).toBe('second-occurrence');
  dialog.open=false;expect(finalizeDialogClose(dialog,clear)).toBe(true);expect(selection).toBeNull();
 });
 it('does not consume or focus the new opener for the stale close',()=>{
  const dialog={open:true},focus=vi.fn();let opener:{focus:()=>void}|undefined={focus};
  const finish=()=>{opener?.focus();opener=undefined;};
  expect(finalizeDialogClose(dialog,finish)).toBe(false);expect(opener).toBeDefined();expect(focus).not.toHaveBeenCalled();
  dialog.open=false;expect(finalizeDialogClose(dialog,finish)).toBe(true);expect(opener).toBeUndefined();expect(focus).toHaveBeenCalledOnce();
 });
 it('does not invoke a stale callback even when it would fail',()=>{
  expect(finalizeDialogClose({open:true},()=>{throw new Error('stale callback');})).toBe(false);
 });
 it('does not swallow an actual close callback failure',()=>{
  expect(()=>finalizeDialogClose({open:false},()=>{throw new Error('actual callback');})).toThrow('actual callback');
 });
});

describe('late native close focus restoration',()=>{
 const setup=()=>{const focus=vi.fn(),opener={isConnected:true,focus} as unknown as HTMLElement,body={} as HTMLElement,inside={} as HTMLElement,next={} as HTMLElement;const ownerDocument={activeElement:inside,body} as unknown as Document;const dialog={ownerDocument,contains:(node:Node|null)=>node===inside};return {focus,opener,body,inside,next,ownerDocument,dialog};};
 it('returns remaining dialog focus to its connected opener',()=>{
  const {dialog,opener,focus}=setup();expect(restoreDialogOpenerFocus(dialog,opener)).toBe(true);expect(focus).toHaveBeenCalledOnce();
 });
 it('restores focus when the browser leaves it on the document body',()=>{
  const {dialog,ownerDocument,body,opener,focus}=setup();Object.defineProperty(ownerDocument,'activeElement',{value:body});expect(restoreDialogOpenerFocus(dialog,opener)).toBe(true);expect(focus).toHaveBeenCalledOnce();
 });
 it('does not steal focus from the next Calendar item before its Enter key',()=>{
  const {dialog,ownerDocument,next,opener,focus}=setup();Object.defineProperty(ownerDocument,'activeElement',{value:next});expect(restoreDialogOpenerFocus(dialog,opener)).toBe(false);expect(focus).not.toHaveBeenCalled();
 });
 it('does not focus a removed opener',()=>{
  const {dialog,opener,focus}=setup();Object.defineProperty(opener,'isConnected',{value:false});expect(restoreDialogOpenerFocus(dialog,opener)).toBe(false);expect(restoreDialogOpenerFocus(dialog,undefined)).toBe(false);expect(focus).not.toHaveBeenCalled();
 });
});
