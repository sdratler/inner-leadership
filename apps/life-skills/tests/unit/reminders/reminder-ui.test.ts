import {afterEach,expect,test,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {readReminders,markReminderRead,reminderWasRead} from '../../../src/features/reminders/client.ts';
import {reminderCalendarHref,ReminderItems} from '../../../src/features/reminders/inbox-workspace.tsx';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {deliveryChannels,updatePreference,type Preference} from '../../../src/ui/workspace/preference-model.ts';
import type {ReminderItem} from '../../../src/features/reminders/service.ts';
afterEach(()=>vi.unstubAllGlobals());
const item=():ReminderItem=>({id:randomUUID(),caseId:randomUUID()as ReminderItem['caseId'],occursOn:'2026-10-02',dueAt:'2026-10-02T07:00:00.000Z',timezone:'Asia/Jerusalem',channel:'in_app',purpose:'self',state:'available',reason:null,readAt:null});
test('bounded private browser read does not trust malformed or fabricated provider proof',async()=>{
 const row=item(),data={items:[row],nextCursor:null,morePending:false,externalDeliveryActive:false};const fetch=vi.fn(async()=>new Response(JSON.stringify({ok:true,data})));vi.stubGlobal('fetch',fetch);
 expect(await readReminders()).toEqual(data);expect(fetch.mock.calls[0]).toBeDefined();
 for(const invalid of [{...data,externalDeliveryActive:true},{...data,items:[{...row,instructions:'private'}]},{...data,items:[row,row]},{...data,items:[{...row,channel:'email'}]},{...data,items:[{...row,timezone:'invalid'}]},{...data,items:Array.from({length:41},item)}]){fetch.mockImplementation(async()=>new Response(JSON.stringify({ok:true,data:invalid})));await expect(readReminders()).rejects.toMatchObject({code:'UNAVAILABLE'});}
});
test('read action uses ordinary session CSRF and requires the exact id and independent readback',async()=>{
 const row=item(),at='2026-10-02T07:01:00.000Z',fetch=vi.fn(async(path:string,init:RequestInit)=>{expect(init.cache).toBe('no-store');return new Response(JSON.stringify({ok:true,data:path==='/api/identity/session'?{csrfToken:'synthetic-session-csrf'}:{id:row.id,readAt:at}}));});vi.stubGlobal('fetch',fetch);
 expect(await markReminderRead(row.id)).toEqual({id:row.id,readAt:at});expect(fetch.mock.calls[1]?.[0]).toBe(`/api/notifications/${row.id}/read`);
 expect(fetch.mock.calls[1]?.[1]).toMatchObject({method:'PATCH',cache:'no-store',credentials:'same-origin',redirect:'error',body:'{}',headers:{'X-CSRF-Token':'synthetic-session-csrf'}});
 expect(reminderWasRead([row],row.id,at)).toBe(false);expect(reminderWasRead([{...row,readAt:at}],row.id,at)).toBe(true);expect(reminderWasRead([{...row,readAt:at}],row.id,'2026-10-02T07:02:00.000Z')).toBe(false);
 fetch.mockImplementation(async()=>new Response(JSON.stringify({ok:true,data:{id:randomUUID(),readAt:at}})));await expect(markReminderRead(row.id)).rejects.toMatchObject({code:'UNAVAILABLE'});
});
test.each(['en','he']as const)('uses the authorized exact case/day Calendar for %s parent/adult/practitioner',locale=>{
 const row=item();for(const [role,path]of [['parent','family/schedule'],['client','client/calendar'],['practitioner','app/calendar']]as const){const url=new URL(reminderCalendarHref(locale,role,row),'https://private.invalid');expect(url.pathname).toBe('/'+locale+'/'+path);expect(Object.fromEntries(url.searchParams)).toEqual({caseId:row.caseId,date:row.occursOn});}
});
test('exposes own in-app opt-out without generating missing preferences or touching another event',()=>{
 expect(deliveryChannels).toEqual(['in_app','email','push','whatsapp']);const row:Preference={eventType:'practice_due',channel:'in_app',enabled:true,locale:'he',timezone:'Asia/Jerusalem',quietStart:null,quietEnd:null};
 expect(updatePreference([row],'practice_due','in_app',false)).toEqual([{...row,enabled:false}]);expect(updatePreference([row],'summary_published','email',true)).toEqual([row]);
 const view=readFileSync(new URL('../../../src/ui/workspace/account-settings.tsx',import.meta.url),'utf8');expect(view).toContain('section==="notifications"&&<ReminderInbox');
 const inbox=readFileSync(new URL('../../../src/features/reminders/inbox-workspace.tsx',import.meta.url),'utf8');expect(inbox).not.toMatch(/localStorage|sessionStorage|Notification\.requestPermission|navigator\.serviceWorker/);expect(inbox).toContain('setPage(null)');expect(inbox).toContain('reminderWasRead(loaded.items');
});
test.each(['en','he']as const)('keeps %s active reminders readable and optional external diagnostics collapsed',locale=>{
 const own=item(),blocked:ReminderItem={...item(),channel:'email',state:'blocked',reason:'demo_external_denied'},html=renderToStaticMarkup(createElement(ReminderItems,{locale,role:'parent',items:[blocked,own],busy:false,pending:null,onMark:()=>{}}));
 expect(html.indexOf(own.caseId)).toBeLessThan(html.indexOf('<details'));expect(html.indexOf(blocked.caseId)).toBeGreaterThan(html.indexOf('<details'));
 expect(html).toMatch(/<details class="lsw-card">/);expect(html).not.toMatch(/<details[^>]*\sopen/);expect(html).toContain(locale==='he'?'מצב מסירה בערוצים חיצוניים':'External delivery status');expect(html).toContain('(1)');expect(html).toContain('minmax(min(100%,14rem),1fr)');
 const locked=renderToStaticMarkup(createElement(ReminderItems,{locale,role:'parent',items:[own],busy:false,pending:own.id,onMark:()=>{}}));expect(locked).toContain('disabled');
});
