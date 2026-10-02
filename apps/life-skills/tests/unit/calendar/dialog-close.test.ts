import { describe,expect,it,vi } from 'vitest';
import { finalizeDialogClose } from '../../../src/ui/workspace/dialogs.tsx';

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
