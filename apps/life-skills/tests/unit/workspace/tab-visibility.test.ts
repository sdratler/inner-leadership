import {readFileSync} from 'node:fs';
import {describe,expect,it,vi} from 'vitest';
import {revealWorkspaceTab} from '../../../src/ui/workspace/tab-visibility.ts';
import {calendarCopy} from '../../../src/features/calendar/copy.ts';

function fixture(left:number,right:number,width=300,contains=true){
 const scrollBy=vi.fn();
 const strip={clientWidth:width,clientLeft:2,contains:()=>contains,getBoundingClientRect:()=>({left:10}),scrollBy} as unknown as HTMLElement;
 const tab={getBoundingClientRect:()=>({left,right})} as HTMLElement;
 return {strip,tab,scrollBy};
}
describe('workspace horizontal tab visibility',()=>{
 it('reveals a clipped LTR tab without moving page scroll or focus',()=>{
  const {strip,tab,scrollBy}=fixture(270,370);revealWorkspaceTab(strip,tab);
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith({left:58,behavior:'instant'});
 });
 it('reveals a clipped RTL tab with a negative physical delta',()=>{
  const {strip,tab,scrollBy}=fixture(-50,60);revealWorkspaceTab(strip,tab);
  expect(scrollBy).toHaveBeenCalledExactlyOnceWith({left:-62,behavior:'instant'});
 });
 it.each([[12,312],[30,100],[-20,350],[11.5,311]])('does not disturb visible/oversized/subpixel tabs (%s,%s)',(left,right)=>{
  const {strip,tab,scrollBy}=fixture(left,right);revealWorkspaceTab(strip,tab);expect(scrollBy).not.toHaveBeenCalled();
 });
 it('ignores hidden strips, absent selection and unrelated targets',()=>{
  for(const [width,contains] of [[0,true],[300,false]] as const){const {strip,tab,scrollBy}=fixture(-50,60,width,contains);revealWorkspaceTab(strip,tab);expect(scrollBy).not.toHaveBeenCalled();}
  const {strip,scrollBy}=fixture(0,20);revealWorkspaceTab(strip,null);expect(scrollBy).not.toHaveBeenCalled();
 });
 it('wires route, translation, resize and keyboard focus changes to the real shell with cleanup',()=>{
  const source=readFileSync(new URL('../../../src/ui/workspace/workspace-shell.tsx',import.meta.url),'utf8');
  expect(source).toContain('ref={tabStrip}');expect(source).toContain('onFocus={event');
  expect(source).toContain('new ResizeObserver(reveal)');expect(source).toContain('observer.disconnect()');
  expect(source).toContain('[pathname, currentContext, active?.key, locale, tabKeys]');
  expect(source).not.toContain('scrollIntoView');
 });
 it('uses real-app metadata and a session-count label appropriate to child and adult cases',()=>{
  expect(calendarCopy.en.attendedCount).toBe('Attended individual sessions');
  expect(calendarCopy.he.attendedCount).toBe('פגישות אישיות שהתקיימו');
  const layout=readFileSync(new URL('../../../src/app/[locale]/layout.tsx',import.meta.url),'utf8');
  expect(layout).toContain('title: "Life Skills"');expect(layout).not.toContain('Life Skills — Foundation');
 });
});
