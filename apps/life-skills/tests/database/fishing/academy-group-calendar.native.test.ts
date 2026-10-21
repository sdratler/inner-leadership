import {afterEach,expect,test,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
vi.mock('server-only',()=>({}));
import {groupCalendarFixture} from './academy-group-calendar-fixture.ts';
import {AcademyGroupCalendarService} from '../../../src/features/fishing/academy-group-calendar-service.ts';
import type {SqlSession} from '../../../src/features/identity/store.ts';

const opened:Awaited<ReturnType<typeof groupCalendarFixture>>[]=[];afterEach(async()=>{await Promise.all(opened.splice(0).map(f=>f.close()));});
async function fixture(){const f=await groupCalendarFixture();opened.push(f);return f;}
async function groups(f:Awaited<ReturnType<typeof fixture>>,hours:readonly [number,number][]){const refs=[];for(const [start,end]of hours){const ref=await f.group();await f.schedule(ref,start,end);refs.push(ref);}return refs;}

test('actual transaction allows two3h groups but rejects a third catchup without any named-table change',async()=>{
 const f=await fixture(),[a,b,c]=await groups(f,[[8,11],[12,15],[16,18]]);await (await f.publication(a!)).execute();await (await f.publication(b!)).execute();const before=await f.snapshot(),p=await f.publication(c!);
 await expect(p.execute()).rejects.toMatchObject({code:'CAPACITY'});expect(await f.snapshot()).toEqual(before);expect((await f.read(c!))!.occurrences[0]!.state).toBe('draft');
});
test('two2h introductory groups already exhaust the two-session count',async()=>{
 const f=await fixture(),[a,b,c]=await groups(f,[[8,10],[11,13],[14,15]]);await (await f.publication(a!)).execute();await (await f.publication(b!)).execute();const before=await f.snapshot();await expect((await f.publication(c!)).execute()).rejects.toMatchObject({code:'CAPACITY'});expect(await f.snapshot()).toEqual(before);
});
test('two nonoverlapping groups still cannot exceed six direct hours',async()=>{
 const f=await fixture(),[a,b]=await groups(f,[[8,12],[13,16]]);await (await f.publication(a!)).execute();const before=await f.snapshot();await expect((await f.publication(b!)).execute()).rejects.toMatchObject({code:'CAPACITY'});expect(await f.snapshot()).toEqual(before);
});
test('moving a published session into an already full date rolls back plan, receipts and resource effects',async()=>{
 const f=await fixture(),[a,b,c]=await groups(f,[[8,11],[12,15],[16,18]]),tomorrow=new Date(Date.parse(f.monday+'T12:00:00Z')+86400000).toISOString().slice(0,10);
 await f.schedule(c!,16,18,tomorrow);for(const ref of [a!,b!,c!])await (await f.publication(ref)).execute();const before=await f.snapshot();await expect(f.schedule(c!,16,18)).rejects.toMatchObject({code:'CAPACITY'});expect(await f.snapshot()).toEqual(before);
});
test('a cancelled meeting frees its prospective slot and the same failed publication can then commit once',async()=>{
 const f=await fixture(),[a,b,c]=await groups(f,[[8,11],[12,15],[16,18]]);await (await f.publication(a!)).execute();await (await f.publication(b!)).execute();const p=await f.publication(c!);await expect(p.execute()).rejects.toMatchObject({code:'CAPACITY'});await f.action(a!,'cancel');const result=await p.execute(),after=await f.snapshot();expect(result.replayed).toBe(false);expect(await p.execute()).toEqual({...result,replayed:true});expect(await f.snapshot()).toEqual(after);expect((await f.read(a!))!.occurrences[0]!.state).toBe('cancelled');
});
test('completed instruction in a retired group still counts after its active resource reservation is released',async()=>{
 const f=await fixture(),past=new Date(Date.parse(f.monday+'T12:00:00Z')-14*86400000).toISOString().slice(0,10),[a,b,c]=await groups(f,[[8,10],[11,13],[14,15]]);
 for(const [i,ref]of [a!,b!,c!].entries())await f.schedule(ref,[8,11,14][i]!,[10,13,15][i]!,past);
 await (await f.publication(a!)).execute();await f.action(a!,'complete');await f.action(a!,'cancel',2);
 expect((await f.pool.query("SELECT count(*)::int AS n FROM ls_fishing_stage.resource_reservations WHERE workspace_id=$1 AND occurrence_id=$2 AND active",[f.workspaceId,(await f.read(a!))!.occurrences[0]!.id])).rows[0]!.n).toBe(0);
 await f.pool.query('UPDATE ls_fishing_stage.cohorts SET active=false WHERE workspace_id=$1 AND stage_id=$2',[f.workspaceId,a!.stageId]);await (await f.publication(b!)).execute();const before=await f.snapshot();await expect((await f.publication(c!)).execute()).rejects.toMatchObject({code:'CAPACITY'});expect(await f.snapshot()).toEqual(before);
 await expect(f.program.calendarOperatorChoices(f.owner,a!)).rejects.toMatchObject({code:'NOT_FOUND'});
});
test('concurrent different-group publication cannot both consume the final daily teaching slot',async()=>{
 const f=await fixture(),[a,b,c]=await groups(f,[[8,10],[11,13],[14,16]]);await (await f.publication(a!)).execute();const p=await f.publication(b!),q=await f.publication(c!),results=await Promise.allSettled([p.execute(),q.execute()]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);const failure=results.find(r=>r.status==='rejected');expect(failure?.status==='rejected'&&failure.reason).toMatchObject({code:'CAPACITY'});
});
test('ordinary Saturday draft remains unbooked and its publication is denied under native policy',async()=>{
 const f=await fixture(),ref=await f.group(),sat=new Date(Date.parse(f.monday+'T12:00:00Z')+5*86400000).toISOString().slice(0,10);await f.schedule(ref,8,10,sat);const before=await f.snapshot();await expect((await f.publication(ref)).execute()).rejects.toMatchObject({code:'APPROVAL_REQUIRED'});expect(await f.snapshot()).toEqual(before);
});

test('one durable physical-event draft links two actual groups without changing any original or creating seats or resources',async()=>{
 const f=await fixture(),a=await f.group(),b=await f.group(),command=await f.draft([a,b]),before=await f.snapshot(),first=await f.planning().saveDraft(f.owner,command);
 expect(first.receipt).toMatchObject({eventId:command.eventId,revision:1,state:'needs_placement',resourceEffect:'none',purchaseEffect:'none',replayed:false});
 const saved=await f.planningRows();expect(await new AcademyGroupCalendarService(f.db,f.config).saveDraft(f.owner,command)).toEqual({receipt:{...first.receipt,replayed:true}});expect(await f.planningRows()).toEqual(saved);
 const context=await f.planning().context(f.owner,f.query);expect(context.events).toHaveLength(1);expect(context.events[0]!.originals.map(o=>o.selection)).toEqual(command.originals);expect(context.events[0]!.originals.map(o=>o.selection.cohortId)).toEqual([a.cohortId,b.cohortId]);
 expect((await f.pool.query('SELECT event_id FROM ls_academy_calendar.events WHERE workspace_id=$1',[f.workspaceId])).rows).toHaveLength(1);expect((await f.pool.query('SELECT occurrence_id FROM ls_academy_calendar.original_links WHERE workspace_id=$1',[f.workspaceId])).rows).toHaveLength(2);expect(await f.snapshot()).toEqual(before);
 const raw=(await f.pool.query('SELECT payload_ciphertext FROM ls_academy_calendar.event_revisions WHERE workspace_id=$1',[f.workspaceId])).rows;expect(JSON.stringify(raw)).not.toContain(command.label);
});

test('event revisions retain original learning snapshots; stale writes and changed-body retries cannot overwrite history',async()=>{
 const f=await fixture(),ref=await f.group(),command=await f.draft([ref]),first=await f.planning().saveDraft(f.owner,command),old=(await f.planning().context(f.owner,f.query)).events[0]!;await f.schedule(ref,8,11);
 const context=await f.planning().context(f.owner,f.query);expect(context.events[0]).toEqual(old);expect(context.groups.find(g=>g.stageId===ref.stageId)!.originals[0]!.selection.expectedRevision).toBeGreaterThan(old.originals[0]!.selection.expectedRevision);
 const next={...await f.draft([ref]),eventId:command.eventId,expectedRevision:1,label:'SYNTHETIC revised private plan'},second=await f.planning().saveDraft(f.owner,next);expect(second.receipt.revision).toBe(2);expect(second.receipt.sha256).not.toBe(first.receipt.sha256);
 const before=await f.planningRows();await expect(f.planning().saveDraft(f.owner,{...next,operationId:randomUUID()})).rejects.toMatchObject({code:'CONFLICT'});await expect(f.planning().saveDraft(f.owner,{...command,label:'DIFFERENT_BODY'})).rejects.toMatchObject({code:'CONFLICT'});expect(await f.planningRows()).toEqual(before);
 await expect(f.pool.query('UPDATE ls_academy_calendar.event_revisions SET state=$2 WHERE workspace_id=$1',[f.workspaceId,'review_required'])).rejects.toMatchObject({code:'23514'});expect(await f.planningRows()).toEqual(before);
});

test('concurrent drafts cannot create two physical Keys identities for the same operator/calendar month',async()=>{
 const f=await fixture(),a=await f.draft(),b=await f.draft(),results=await Promise.allSettled([f.planning().saveDraft(f.owner,a),f.planning().saveDraft(f.owner,b)]);expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);expect(results.find(r=>r.status==='rejected')).toMatchObject({reason:{code:'CONFLICT'}});expect((await f.planning().context(f.owner,f.query)).events).toHaveLength(1);
});

test('native draft failure after the actual command insert rolls back identity, revision, original links and receipt together',async()=>{
 const f=await fixture(),ref=await f.group(),command=await f.draft([ref]),before=await f.planningRows(),stageBefore=await f.snapshot();let inserted=false;
 const failing=new AcademyGroupCalendarService({transaction:work=>f.db.transaction(tx=>{const query:SqlSession['query']=async<T extends object>(sql:string,params?:readonly unknown[])=>{const rows=await tx.query<T>(sql,params);if(sql.startsWith('INSERT INTO ls_academy_calendar.commands')){inserted=true;throw Error('SYNTHETIC_AFTER_ACTUAL_INSERT');}return rows;};return work({query});})},f.config);
 await expect(failing.saveDraft(f.owner,command)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(inserted).toBe(true);expect(await f.planningRows()).toEqual(before);expect(await f.snapshot()).toEqual(stageBefore);expect((await f.planning().saveDraft(f.owner,command)).receipt.revision).toBe(1);
});

test('draft reads and saved replay require current actual owner session and reject forged roles',async()=>{
 const f=await fixture(),ref=await f.group(),command=await f.draft([ref]);await f.planning().saveDraft(f.owner,command);const before=await f.planningRows(),parent=await f.account('parent');await expect(f.planning().context(parent,f.query)).rejects.toMatchObject({code:'FORBIDDEN'});await expect(f.planning().saveDraft({...parent,role:'practitioner'},command)).rejects.toMatchObject({code:'FORBIDDEN'});expect(()=>f.planning().saveDraft(f.owner,{...command,operationId:randomUUID(),eventId:randomUUID(),originals:[command.originals[0]!,command.originals[0]!]})).toThrow();
 await f.pool.query('UPDATE ls_identity.sessions SET revoked_at=clock_timestamp() WHERE workspace_id=$1 AND account_id=$2',[f.workspaceId,f.owner.id]);await expect(f.planning().saveDraft(f.owner,command)).rejects.toMatchObject({code:'UNAUTHENTICATED'});expect(await f.planningRows()).toEqual(before);
});

test('retiring a linked cohort denies archived snapshot reads and exact replay without rewriting original links',async()=>{
 const f=await fixture(),ref=await f.group(),command=await f.draft([ref]);await f.planning().saveDraft(f.owner,command);const before=await f.planningRows();await f.pool.query('UPDATE ls_fishing_stage.cohorts SET active=false WHERE workspace_id=$1 AND stage_id=$2',[f.workspaceId,ref.stageId]);await expect(f.planning().context(f.owner,f.query)).rejects.toMatchObject({code:'NOT_FOUND'});await expect(f.planning().saveDraft(f.owner,command)).rejects.toMatchObject({code:'NOT_FOUND'});expect(await f.planningRows()).toEqual(before);
});

test('existing Calendar HTTP saves and rereads private group drafts with native login, CSRF and exact idempotency',async()=>{
 const f=await fixture(),ref=await f.group(),command=await f.draft([ref]),http=await f.planningHttp();expect((await http.post(command,{'x-csrf-token':'wrong'})).status).toBe(403);expect((await http.post(command,{'idempotency-key':randomUUID()})).status).toBe(400);const before=await f.snapshot();const first=await http.post(command);expect(first.status).toBe(200);expect(first.headers.get('cache-control')).toBe('private, no-store');expect((await first.json()).data.receipt).toMatchObject({state:'needs_placement',revision:1,replayed:false});const read=await http.get();expect(read.status).toBe(200);expect((await read.json()).data.events[0].eventId).toBe(command.eventId);expect((await(await http.post(command)).json()).data.receipt.replayed).toBe(true);expect((await http.get('?'+new URLSearchParams(f.query)+'&from='+f.query.from)).status).toBe(400);expect(await f.snapshot()).toEqual(before);
});


test('owner proposed placement uses current native venue choices, preserves originals and makes no bookings',async()=>{
 const f=await fixture(),ref=await f.group(),draft=await f.draft([ref]),http=await f.planningHttp(),context=(await(await http.get()).json()).data;
 expect(context.venues).toEqual(expect.arrayContaining([expect.objectContaining({id:f.venueCommand.id,label:f.venueCommand.label})]));
 const sunday=new Date(Date.parse(f.monday+'T12:00Z')+6*86400000).toISOString().slice(0,10);
 const placement={kind:'proposed' as const,startsAt:f.wall(sunday,8),endsAt:f.wall(sunday,18),venueId:f.venueCommand.id};
 const command={...draft,calendarMonth:sunday.slice(0,7),placement};
 const before=await f.snapshot();const first=await http.post(command);expect(first.status).toBe(200);expect((await first.json()).data.receipt).toMatchObject({state:'review_required',resourceEffect:'none',purchaseEffect:'none',replayed:false});
 const current=await f.planning().context(f.owner,{from:command.calendarMonth,to:command.calendarMonth});expect(current.events[0]!.placement).toEqual(placement);expect(current.events[0]!.originals.map(o=>o.selection)).toEqual(draft.originals);
 const saved=await f.planningRows();expect((await(await http.post(command)).json()).data.receipt.replayed).toBe(true);expect(await f.planningRows()).toEqual(saved);expect(await f.snapshot()).toEqual(before);
 await f.pool.query('UPDATE ls_fishing_stage.venues SET active=false WHERE workspace_id=$1 AND id=$2',[f.workspaceId,f.venueCommand.id]);
 expect((await(await http.get()).json()).data.venues).toEqual([]);expect((await http.post(command)).status).toBe(404);expect(await f.planningRows()).toEqual(saved);
 await f.pool.query('UPDATE ls_fishing_stage.venues SET active=true WHERE workspace_id=$1 AND id=$2',[f.workspaceId,f.venueCommand.id]);
 expect((await(await http.post(command)).json()).data.receipt.replayed).toBe(true);
 await expect(f.planning().saveDraft(f.owner,{...command,operationId:randomUUID(),expectedRevision:1,placement:{...placement,venueId:randomUUID()}})).rejects.toMatchObject({code:'NOT_FOUND'});expect(await f.planningRows()).toEqual(saved);
});
