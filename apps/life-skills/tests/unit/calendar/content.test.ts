import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {describe,expect,it,vi} from 'vitest';
import {calendarContent,calendarContentHref} from '../../../src/features/calendar/content.ts';
import {CalendarBoard,CalendarAgenda} from '../../../src/features/calendar/views.tsx';
import {contentPublication,contentSnapshot,contentReadAt} from './content-fixture.ts';
const from='2026-10-01T00:00:00Z',to='2026-11-01T00:00:00Z';
describe('optional operational Calendar content projection',()=>{
 it('keeps exact source IDs, revision/digest and Jerusalem time without copying captions or delivery fields',()=>{
  const snapshot=contentSnapshot(),before=JSON.stringify(snapshot),result=calendarContent(snapshot,from,to);
  expect(result).toMatchObject({fetchedAt:contentReadAt,partial:true,undated:0});
  expect(result.items[0]).toMatchObject({id:'DEMO-status-1',assetId:'DEMO-content',revision:3,digest:'b'.repeat(64),date:'2026-10-05',localTime:'20:00',at:snapshot.publications[0]!.scheduledFor,locale:'he',assetAvailable:true,state:'scheduled'});
  expect(result.items[0]?.status.en).toBe('Planned — not provider-confirmed');
  expect(result.items[0]?.status.he).toBe('מתוכנן — ללא אישור מהספק');
  expect(JSON.stringify(result)).not.toContain('caption');expect(JSON.stringify(result)).not.toContain('providerReceiptId');
  expect(JSON.stringify(snapshot)).toBe(before);
 });
 it('uses confirmed publication or actual manual report time, never freshness/readback as the event time',()=>{
  const publications=[contentPublication({id:'DEMO-published',state:'published',receiptKind:'publication',providerReceiptId:'DEMO-receipt',providerReadAt:contentReadAt,confirmedAt:'2026-10-06T17:01:00Z'}),contentPublication({id:'DEMO-manual',state:'manually_reported',provider:'manual',receiptKind:'manual_open',manualReportedAt:'2026-10-06T16:00:00Z'}),contentPublication({id:'DEMO-sending',state:'sending',providerReceiptId:'DEMO-accepted',providerReadAt:contentReadAt})];
  const rows=calendarContent(contentSnapshot(publications),from,to).items;
  expect(rows.map(row=>row.id)).toEqual(['DEMO-sending','DEMO-manual','DEMO-published']);
  expect(rows[1]).toMatchObject({at:'2026-10-06T16:00:00Z',localTime:'19:00'});
  expect(rows[1]?.status.en).toContain('not provider-verified');
  expect(rows[2]).toMatchObject({at:'2026-10-06T17:01:00Z',localTime:'20:01'});
  expect(rows[0]?.status.en).toBe('Sending — awaiting result');
 });
 it('keeps undated records unassigned and half-open range boundaries exact',()=>{
  const publications=[contentPublication({id:'DEMO-undated',scheduledFor:null}),contentPublication({id:'DEMO-start',scheduledFor:from}),contentPublication({id:'DEMO-end',scheduledFor:to}),contentPublication({id:'DEMO-before',scheduledFor:'2026-09-30T23:59:59Z'})];
  const result=calendarContent(contentSnapshot(publications),from,to);
  expect(result.undated).toBe(1);expect(result.items.map(row=>row.id)).toEqual(['DEMO-start']);
 });
 it.each([
  ['2026-03-26T00:30:00Z','2026-03-26','02:30'],['2026-03-27T00:30:00Z','2026-03-27','03:30'],
  ['2026-10-24T21:30:00Z','2026-10-25','00:30'],['2026-10-25T00:30:00Z','2026-10-25','02:30'],
 ])('uses real Jerusalem DST for %s', (at,date,localTime)=>{
  const row=calendarContent(contentSnapshot([contentPublication({scheduledFor:at})]),new Date(Date.parse(at)-3600000).toISOString(),new Date(Date.parse(at)+3600000).toISOString()).items[0];
  expect(row).toMatchObject({at,date,localTime});
 });
 it.each([{creativeRevision:4},{creativeDigest:'c'.repeat(64)}])('does not match another source revision or digest: %j',patch=>{
  const row=calendarContent(contentSnapshot([contentPublication(patch)]),from,to).items[0];
  expect(row).toMatchObject({assetAvailable:false,locale:null,title:'DEMO-content'});expect(row?.status.en).toBe('Creative revision unavailable');
 });
 it('preserves explicitly unregistered and held source records without promoting them into eligible assets',()=>{
  const snapshot=contentSnapshot();snapshot.creatives=[{...snapshot.creatives[0]!,registeredRevision:false}];
  expect(calendarContent(snapshot,from,to).items[0]?.assetAvailable).toBe(false);
  snapshot.publications=[contentPublication({state:'held',provider:'unbound',assetId:'',creativeDigest:'',errorCode:'ASSET_BINDING_UNAVAILABLE'})];
  const row=calendarContent(snapshot,from,to).items[0];expect(row).toMatchObject({assetAvailable:false,errorCode:'ASSET_BINDING_UNAVAILABLE',state:'held'});expect(row?.status.en).toBe('Held — not eligible for publication');
 });
 it.each(['en','he'] as const)('opens the exact existing %s Marketing record and day, not a recreated calendar event',locale=>{
  const row=calendarContent(contentSnapshot(),from,to).items[0]!;
  const url=new URL(calendarContentHref(row,locale),'https://private.invalid');
  expect(url.pathname).toBe(`/${locale}/app/marketing`);expect(Object.fromEntries(url.searchParams)).toEqual({section:'content_calendar',publication:row.id,date:row.date,month:'2026-10',layout:'agenda'});
 });
 it.each(['synthetic','null-freshness','duplicate','malformed','oversized'] as const)('rejects %s source instead of displaying an empty success',kind=>{
  const snapshot=contentSnapshot();
  if(kind==='synthetic')snapshot.source='synthetic';if(kind==='null-freshness')snapshot.fetchedAt=null;
  if(kind==='duplicate')snapshot.publications=[contentPublication(),contentPublication()];
  if(kind==='malformed')snapshot.publications=[contentPublication({scheduledFor:'not-a-date'})];
  if(kind==='oversized')snapshot.publications=Array.from({length:2001},(_,i)=>contentPublication({id:`DEMO-${i}`}));
  expect(()=>calendarContent(snapshot,from,to)).toThrowError(expect.objectContaining({code:'UNAVAILABLE'}));
 });
 it.each([[to,from],[from,from],['2026-01-01T00:00:00Z','2026-04-01T00:00:00Z'],['not-a-date',to]])('rejects invalid/unbounded range %s -> %s', (start,end)=>{
  expect(()=>calendarContent(contentSnapshot(),start,end)).toThrowError(expect.objectContaining({code:'INVALID_REQUEST'}));
 });
 it.each(['en','he'] as const)('renders the same source once per visible board/agenda in %s with read-only actions',locale=>{
  const content=calendarContent(contentSnapshot(),from,to).items;
  const shared={items:[],content,locale,names:{},onOpen:vi.fn()};
  for(const view of ['day','week','month'] as const){const markup=renderToStaticMarkup(createElement(CalendarBoard,{...shared,dates:['2026-10-05'],view}));expect(markup.match(/data-publication-id=/g)).toHaveLength(1);expect(markup).toContain('publication=DEMO-status-1');expect(markup).not.toContain('<button');}
  const markup=renderToStaticMarkup(createElement(CalendarAgenda,shared));expect(markup.match(/data-publication-id=/g)).toHaveLength(1);expect(markup).toContain('20:00');expect(markup).not.toContain('<button');
 });
});
