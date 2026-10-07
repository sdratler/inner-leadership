import {expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
vi.mock('../../../src/features/marketing-overview/provider.ts',()=>({loadContentRegistry:vi.fn()}));
import {renderToStaticMarkup} from 'react-dom/server';
import {createElement} from 'react';
import {AppError} from '../../../src/lib/errors.ts';
import {administrativeTaskTitle,localizedAdministrativeTaskTitle} from '../../../src/features/calendar/administrative-work-copy.ts';
import {contentWorkSources} from '../../../src/features/calendar/content-work-tasks.ts';
import {syncContentWork} from '../../../src/features/calendar/content-work-read.ts';
import {CalendarAgenda,CalendarBoard} from '../../../src/features/calendar/views.tsx';
import type {InternalTask} from '../../../src/features/calendar/tasks.ts';
import {asId} from '../../../src/lib/ids.ts';
import {actor} from './fixtures.ts';
import {contentSnapshot,contentPublication} from './content-fixture.ts';

it('uses only the highest unambiguous registered current creative; never templates/history or invented approval',()=>{
 const snapshot=contentSnapshot([]),base={...snapshot.creatives[0]!,review:'in_review' as const,approvedDigest:null};
 snapshot.creatives=[{...base,revision:2},base];snapshot.library=[{...base,assetId:'DEMO-template',collection:'templates'}];
 const before=JSON.stringify(snapshot),rows=contentWorkSources(snapshot);
 expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({kind:'creative_approval',sourceId:base.assetId,active:true,dueDate:null,caseId:null,revisionFacts:{revision:3,digest:base.contentDigest,state:'unapproved'}});
 expect(rows[0]!.sourcePath).toContain('section=needs_approval');expect(JSON.stringify(rows)).not.toContain('caption');expect(JSON.stringify(snapshot)).toBe(before);
 snapshot.creatives=[base,{...base,contentDigest:'c'.repeat(64)}];expect(contentWorkSources(snapshot)).toEqual([]);
 snapshot.creatives=[base,{...base,review:'approved',approvedDigest:base.contentDigest}];expect(contentWorkSources(snapshot)).toEqual([]);
 snapshot.creatives=[{...base,registeredRevision:false}];expect(contentWorkSources(snapshot)).toEqual([]);
});
it('explicit current approval/discard retires review work without changing the registered asset',()=>{
 const snapshot=contentSnapshot([]);expect(contentWorkSources(snapshot)[0]).toMatchObject({active:false,kind:'creative_approval'});
 snapshot.creatives=[{...snapshot.creatives[0]!,review:'retired',approvedDigest:null}];expect(contentWorkSources(snapshot)[0]).toMatchObject({active:false});
 snapshot.creatives=[{...snapshot.creatives[0]!,review:'in_review',libraryState:'REJECTED'}];expect(contentWorkSources(snapshot)[0]).toMatchObject({active:false});
});
it('failure is work; provider acceptance, requeue, unknown and manual reporting do not resolve it',()=>{
 const snapshot=contentSnapshot([contentPublication({state:'failed',errorCode:'SYNTHETIC_FAILURE'})]);
 expect(contentWorkSources(snapshot).find(row=>row.kind==='publishing_failure')).toMatchObject({active:true,dueDate:null,sourceId:'DEMO-status-1'});
 for(const state of ['ready','scheduled','sending','unknown','manually_reported','published'] as const){
  snapshot.publications=[contentPublication({state,providerReceiptId:'DEMO-provider-acceptance',providerReadAt:'2026-10-05T19:00:00Z',receiptKind:'schedule'})];
  expect(contentWorkSources(snapshot).some(row=>row.kind==='publishing_failure')).toBe(false);
 }
 snapshot.publications=[contentPublication({state:'published',receiptKind:'publication',providerReceiptId:'DEMO-confirmed',providerReadAt:'2026-10-05T19:00:00Z',confirmedAt:'2026-10-05T17:01:00Z'})];
 expect(contentWorkSources(snapshot).find(row=>row.kind==='publishing_failure')).toMatchObject({active:false});
 snapshot.publications=[contentPublication({state:'published',channel:'facebook_group_manual',provider:'manual',receiptKind:'publication',providerReceiptId:'DEMO-manual',providerReadAt:'2026-10-05T19:00:00Z',confirmedAt:'2026-10-05T17:01:00Z'})];
 expect(contentWorkSources(snapshot).some(row=>row.kind==='publishing_failure')).toBe(false);
 snapshot.publications=[contentPublication({state:'skipped'})];expect(contentWorkSources(snapshot).find(row=>row.kind==='publishing_failure')).toMatchObject({active:false});
});
it.each(['synthetic','null-freshness','duplicate','malformed','overbound'] as const)('rejects %s sources, never empty success or saved-source resolution',kind=>{
 const snapshot=contentSnapshot();if(kind==='synthetic')snapshot.source='synthetic';if(kind==='null-freshness')snapshot.fetchedAt=null;
 if(kind==='duplicate')snapshot.publications=[contentPublication(),contentPublication()];if(kind==='malformed')snapshot.publications=[contentPublication({confirmedAt:'not-a-date'})];
 if(kind==='overbound')snapshot.publications=Array.from({length:2001},(_,i)=>contentPublication({id:String(i)}));
 expect(()=>contentWorkSources(snapshot)).toThrowError(expect.objectContaining({code:'UNAVAILABLE'}));
});
it.each(['parent','child','adult_client'] as const)('denies %s before content reads or internal writes',async role=>{
 const auth=vi.fn(),save=vi.fn(),load=vi.fn();await expect(syncContentWork({...actor,role},auth,save,load)).rejects.toMatchObject({code:'FORBIDDEN'});expect(auth).not.toHaveBeenCalled();expect(load).not.toHaveBeenCalled();expect(save).not.toHaveBeenCalled();
});
it.each(['before','after'] as const)('reauthorizes %s external read and prevents revoked writes',async phase=>{
 const auth=vi.fn().mockResolvedValueOnce(undefined),load=vi.fn().mockResolvedValue(contentSnapshot()),save=vi.fn();
 if(phase==='before')auth.mockReset().mockRejectedValue(new AppError('FORBIDDEN'));else auth.mockRejectedValueOnce(new AppError('FORBIDDEN'));
 await expect(syncContentWork(actor,auth,save,load)).rejects.toMatchObject({code:'FORBIDDEN'});expect(load).toHaveBeenCalledTimes(phase==='before'?0:1);expect(save).not.toHaveBeenCalled();
});
it('failed registry reads are sanitized and never reach a write; successful order is auth/read/auth/save',async()=>{
 const auth=vi.fn(),save=vi.fn();await expect(syncContentWork(actor,auth,save,async()=>{throw Error('SYNTHETIC_PRIVATE_DETAIL');})).rejects.toMatchObject({code:'UNAVAILABLE'});expect(save).not.toHaveBeenCalled();
 const order:string[]=[];await syncContentWork(actor,async()=>{order.push('auth');},async rows=>{order.push('save');return rows.length;},async()=>{order.push('read');return contentSnapshot();});expect(order).toEqual(['auth','read','auth','save']);
});
it.each(['en','he'] as const)('renders same durable administrative task in %s board/agenda with source and no external action',locale=>{
 const title=administrativeTaskTitle('booking_followup','DEMO person'),task:InternalTask={id:asId('11111111-1111-4111-8111-111111111111','task'),caseId:null,title,sourceKind:'booking_followup',sourcePath:'/en/app/clients?section=prospects&leadId=LS-LEAD-DEMO',dueDate:'2026-10-06',dueTime:null,note:null,state:'open',version:1,createdAt:'2026-10-06T00:00:00Z',updatedAt:'2026-10-06T00:00:00Z'};
 const common={items:[],tasks:[task],locale,names:{},onOpen:vi.fn()};
 for(const markup of [renderToStaticMarkup(createElement(CalendarAgenda,common)),renderToStaticMarkup(createElement(CalendarBoard,{...common,dates:['2026-10-06'],view:'day'}))]){
  expect(markup).toContain(localizedAdministrativeTaskTitle(title,task.sourceKind,locale));expect(markup).toContain(`/${locale}/app/clients?`);expect(markup).toContain('DEMO person');expect(markup).not.toContain('Send');expect(markup).not.toContain('Charge');
 }
 expect(localizedAdministrativeTaskTitle('Unknown stored title','booking_followup',locale)).toBe('Unknown stored title');
 expect(localizedAdministrativeTaskTitle('constructor','constructor',locale)).toBe('constructor');
});
