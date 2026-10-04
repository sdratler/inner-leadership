import {beforeEach,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {commentLink,readCommunityThreads,registerCommunityThread,pendingCommunityResponses} from '../../../src/features/community-reply/threads-bridge.ts';
import {projectCommunityTasks} from '../../../src/features/community-reply/threads.ts';
import type {InternalTaskService} from '../../../src/features/calendar/tasks.ts';
import type {Actor} from '../../../src/features/identity/types.ts';
const owner='9fe575fe-fba2-4a4b-a136-bb28560b13f2',id='412302a8-3694-4718-9a3b-e5de1a78de6e',rid='112302a8-3694-4718-9a3b-e5de1a78de6e',post='https://www.facebook.com/groups/demo/posts/10',at='2026-10-02T06:00:00.000Z',env={LS_COMMUNITY_SCOUT_BRIDGE_SECRET:'a'.repeat(43)};
const thread={id,postId:10,postUrl:post,commentId:'101',commentUrl:post+'?comment_id=101',registeredAt:at,expiresAt:'2026-10-30T06:00:00.000Z'},response={id:rid,threadId:id,commentId:'202',parentCommentId:'101',commentUrl:post+'?comment_id=101&reply_comment_id=202',text:'DEMO public response',postedAt:at,capturedAt:at,expiresAt:thread.expiresAt,taskId:null};
const data={threads:[thread],responses:[response],partial:true,captureStatus:null,autonomousCollectionEnabled:false};
const fetcher=vi.fn<typeof fetch>();beforeEach(()=>{fetcher.mockReset();fetcher.mockResolvedValue(Response.json({ok:true,data}));});
it('retains only exact supported post/comment links rather than guesses or unsafe targets',()=>{
 expect(commentLink('https://m.facebook.com/groups/DEMO/permalink/10?comment_id=101&reply_comment_id=202&fbclid=track')).toEqual({postUrl:post,commentId:'202',rootCommentId:'101',url:response.commentUrl});
 for(const value of [post,post+'?comment_id=101&comment_id=102',post+'?comment_id=101&reply_comment_id=bad',post+'?comment_id=101&next=private','https://secret@facebook.com/groups/demo/posts/10?comment_id=101'])expect(commentLink(value)).toBeNull();
});
it('binds trusted owner, exact parent/post relationship and bounded envelopes on the fixed Scout origin',async()=>{
 expect(await readCommunityThreads(owner,undefined,fetcher,env)).toEqual(data);expect(fetcher.mock.calls[0]?.[0]).toContain('https://community-scout-production.up.railway.app/internal/life-skills/threads?ownerId='+owner);
 for(const altered of [{...data,responses:[{...response,parentCommentId:'999'}]},{...data,responses:[{...response,threadId:rid}]},{...data,responses:[response,response]},{...data,autonomousCollectionEnabled:true},{...data,threads:Array(21).fill(thread)}]){fetcher.mockResolvedValueOnce(Response.json({ok:true,data:altered}));await expect(readCommunityThreads(owner,undefined,fetcher,env)).rejects.toMatchObject({code:'UNAVAILABLE'});}
 fetcher.mockResolvedValueOnce(new Response('x'.repeat(1_000_001)));await expect(readCommunityThreads(owner,undefined,fetcher,env)).rejects.toMatchObject({code:'UNAVAILABLE'});
});
it.each(['2026-10-02T06:00:00','2026-10-02','2026-02-30T06:00:00Z'])('rejects noncanonical instants before rendering or task projection: %s',async invalid=>{
 for(const malformed of [
  {...data,threads:[{...thread,registeredAt:invalid}]}, {...data,threads:[{...thread,expiresAt:invalid}]},
  ...['postedAt','capturedAt','expiresAt'].map(field=>({...data,responses:[{...response,[field]:invalid}]})),
  {...data,captureStatus:{checkedAt:invalid,reason:null,observedRunCostCents:null}},
 ]){fetcher.mockResolvedValueOnce(Response.json({ok:true,data:malformed}));await expect(readCommunityThreads(owner,undefined,fetcher,env)).rejects.toMatchObject({code:'UNAVAILABLE'});}
 fetcher.mockResolvedValueOnce(Response.json({ok:true,data:{responses:[{...response,capturedAt:invalid}],more:false}}));
 const create=vi.fn().mockResolvedValue({id}),acknowledge=vi.fn(),actor={id:owner,role:'practitioner',state:'active'} as Actor;
 await expect(projectCommunityTasks(actor,{create} as unknown as InternalTaskService,{pending:()=>pendingCommunityResponses(owner,fetcher,env),acknowledge})).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect(create).not.toHaveBeenCalled();expect(acknowledge).not.toHaveBeenCalled();
});
it('normalizes explicit provider offsets to the same UTC instant used by Calendar',async()=>{
 const offset='2026-10-02T09:00:00+03:00';fetcher.mockResolvedValueOnce(Response.json({ok:true,data:{...data,threads:[{...thread,registeredAt:offset}],responses:[{...response,capturedAt:offset}],captureStatus:{checkedAt:offset,reason:null,observedRunCostCents:null}}}));
 const actual=await readCommunityThreads(owner,undefined,fetcher,env);
 expect(actual.threads[0]?.registeredAt).toBe('2026-10-02T06:00:00.000Z');expect(actual.responses[0]?.capturedAt).toBe('2026-10-02T06:00:00.000Z');expect(actual.captureStatus?.checkedAt).toBe('2026-10-02T06:00:00.000Z');
});
it.each([
 {postedAt:'2026-10-02T06:00:01.000Z'},
 {expiresAt:'2026-10-02T05:59:59.000Z'},
])('rejects impossible response chronology before rendering or any task write: %j',async change=>{
 const wrong={...response,...change};fetcher.mockResolvedValueOnce(Response.json({ok:true,data:{...data,responses:[wrong]}}));
 await expect(readCommunityThreads(owner,undefined,fetcher,env)).rejects.toMatchObject({code:'UNAVAILABLE'});
 fetcher.mockResolvedValueOnce(Response.json({ok:true,data:{responses:[wrong],more:false}}));fetcher.mockResolvedValueOnce(Response.json({ok:true,data:{...data,responses:[]}}));
 const create=vi.fn().mockResolvedValue({id}),acknowledge=vi.fn(),actor={id:owner,role:'practitioner',state:'active'} as Actor;
 await expect(projectCommunityTasks(actor,{create} as unknown as InternalTaskService,{pending:()=>pendingCommunityResponses(owner,fetcher,env),acknowledge})).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect(create).not.toHaveBeenCalled();expect(acknowledge).not.toHaveBeenCalled();
});
it('rejects a tracked thread expiring before registration on both list and registration readback',async()=>{
 const wrong={...thread,expiresAt:'2026-10-02T05:59:59.000Z'};
 fetcher.mockResolvedValueOnce(Response.json({ok:true,data:{...data,threads:[wrong],responses:[]}}));await expect(readCommunityThreads(owner,undefined,fetcher,env)).rejects.toMatchObject({code:'UNAVAILABLE'});
 fetcher.mockResolvedValueOnce(Response.json({ok:true,data:wrong}));await expect(registerCommunityThread(owner,{operationId:rid,postId:10,commentUrl:thread.commentUrl,confirmManualReply:true},fetcher,env)).rejects.toMatchObject({code:'UNAVAILABLE'});
});
it('accepts equal chronological boundaries and a response posted before manual tracking',async()=>{
 const same={...data,threads:[{...thread,registeredAt:at,expiresAt:at}],responses:[{...response,postedAt:'2026-10-01T06:00:00.000Z',capturedAt:at,expiresAt:at}]};
 fetcher.mockResolvedValueOnce(Response.json({ok:true,data:same}));expect(await readCommunityThreads(owner,undefined,fetcher,env)).toEqual(same);
});
it('rejects a response URL whose root comment disagrees with its declared parent, including pending task projection',async()=>{
 const wrong={...response,commentUrl:post+'?comment_id=999&reply_comment_id=202'};
 fetcher.mockResolvedValueOnce(Response.json({ok:true,data:{...data,responses:[wrong]}}));await expect(readCommunityThreads(owner,undefined,fetcher,env)).rejects.toMatchObject({code:'UNAVAILABLE'});
 fetcher.mockResolvedValueOnce(Response.json({ok:true,data:{responses:[wrong],more:false}}));
 const create=vi.fn(),acknowledge=vi.fn(),actor={id:owner,role:'practitioner',state:'active'} as Actor;
 await expect(projectCommunityTasks(actor,{create} as unknown as InternalTaskService,{pending:()=>pendingCommunityResponses(owner,fetcher,env),acknowledge})).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect(create).not.toHaveBeenCalled();expect(acknowledge).not.toHaveBeenCalled();
});
it('registration validates exact server readback and pending task data never accepts a duplicate or a caller-owned task',async()=>{
 const command={operationId:rid,postId:10,commentUrl:thread.commentUrl,confirmManualReply:true as const};fetcher.mockResolvedValueOnce(Response.json({ok:true,data:thread}));expect(await registerCommunityThread(owner,command,fetcher,env)).toEqual(thread);expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({...command,ownerId:owner});
 fetcher.mockResolvedValueOnce(Response.json({ok:true,data:{...thread,postId:11}}));await expect(registerCommunityThread(owner,command,fetcher,env)).rejects.toMatchObject({code:'UNAVAILABLE'});
 fetcher.mockResolvedValueOnce(Response.json({ok:true,data:{responses:[{...response,taskId:id}],more:false}}));await expect(pendingCommunityResponses(owner,fetcher,env)).rejects.toMatchObject({code:'UNAVAILABLE'});
});
it.each(['parent','post','missing'] as const)('rejects a self-consistent pending response with an unrelated %s thread before any task write',async mismatch=>{
 const captured=mismatch==='parent'?{...thread,commentId:'999',commentUrl:post+'?comment_id=999'}:mismatch==='post'?{...thread,postId:11,postUrl:post+'1',commentUrl:post+'1?comment_id=101'}:null;
 fetcher.mockResolvedValueOnce(Response.json({ok:true,data:{responses:[response],more:false}}));
 fetcher.mockResolvedValueOnce(Response.json({ok:true,data:{...data,threads:captured?[captured]:[],responses:[]}}));
 const create=vi.fn(),acknowledge=vi.fn(),actor={id:owner,role:'practitioner',state:'active'} as Actor;
 await expect(projectCommunityTasks(actor,{create} as unknown as InternalTaskService,{pending:()=>pendingCommunityResponses(owner,fetcher,env),acknowledge})).rejects.toMatchObject({code:'UNAVAILABLE'});
 expect(create).not.toHaveBeenCalled();expect(acknowledge).not.toHaveBeenCalled();
});
it('reads each distinct pending thread once and accepts only its matching parent/post binding',async()=>{
 const second={...response,id:'212302a8-3694-4718-9a3b-e5de1a78de6e',commentId:'203',commentUrl:post+'?comment_id=101&reply_comment_id=203'};
 const pending={responses:[response,second],more:true};
 fetcher.mockResolvedValueOnce(Response.json({ok:true,data:pending}));fetcher.mockResolvedValueOnce(Response.json({ok:true,data}));
 expect(await pendingCommunityResponses(owner,fetcher,env)).toEqual(pending);expect(fetcher).toHaveBeenCalledTimes(2);
 const readUrl=new URL(String(fetcher.mock.calls[1]?.[0]));expect(readUrl.searchParams.get('ownerId')).toBe(owner);expect(readUrl.searchParams.get('threadId')).toBe(id);
});
it('does not request thread metadata when no task responses are pending',async()=>{
 fetcher.mockResolvedValueOnce(Response.json({ok:true,data:{responses:[],more:false}}));expect(await pendingCommunityResponses(owner,fetcher,env)).toEqual({responses:[],more:false});expect(fetcher).toHaveBeenCalledTimes(1);
});
it.each(['read','project'] as const)('rejects duplicate canonical public replies under different response UUIDs before %s',async action=>{
 const duplicate={...response,id:'212302a8-3694-4718-9a3b-e5de1a78de6e',commentUrl:'https://m.facebook.com/groups/DEMO/permalink/10?comment_id=101&reply_comment_id=202&fbclid=ignored'};
 if(action==='read'){
  fetcher.mockResolvedValueOnce(Response.json({ok:true,data:{...data,responses:[response,duplicate]}}));
  await expect(readCommunityThreads(owner,undefined,fetcher,env)).rejects.toMatchObject({code:'UNAVAILABLE'});
 }else{
  fetcher.mockResolvedValueOnce(Response.json({ok:true,data:{responses:[response,duplicate],more:false}}));
  const create=vi.fn().mockResolvedValue({id}),acknowledge=vi.fn(),actor={id:owner,role:'practitioner',state:'active'} as Actor;
  await expect(projectCommunityTasks(actor,{create}as unknown as InternalTaskService,{pending:()=>pendingCommunityResponses(owner,fetcher,env),acknowledge})).rejects.toMatchObject({code:'UNAVAILABLE'});
  expect(create).not.toHaveBeenCalled();expect(acknowledge).not.toHaveBeenCalled();expect(fetcher).toHaveBeenCalledTimes(1);
 }
});
it('uses one canonical command across separately acknowledged response UUIDs and URL spellings',async()=>{
 const create=vi.fn().mockResolvedValue({id}),acknowledge=vi.fn().mockResolvedValue(undefined),actor={id:owner,role:'practitioner',state:'active'} as Actor;
 const pending=vi.fn().mockResolvedValueOnce({responses:[response],more:false}).mockResolvedValueOnce({responses:[{...response,id:'212302a8-3694-4718-9a3b-e5de1a78de6e',commentUrl:'https://m.facebook.com/groups/DEMO/permalink/10?comment_id=101&reply_comment_id=202&fbclid=ignored'}],more:false});
 await projectCommunityTasks(actor,{create}as unknown as InternalTaskService,{pending,acknowledge});
 await projectCommunityTasks(actor,{create}as unknown as InternalTaskService,{pending,acknowledge});
 expect(create.mock.calls[1]).toEqual(create.mock.calls[0]);expect(acknowledge.mock.calls[1]).toEqual([owner,'212302a8-3694-4718-9a3b-e5de1a78de6e',id]);
});
it('creates only internal receipt-bound tasks from server captures, with stable retry data and no narrative or case join',async()=>{
 const create=vi.fn().mockResolvedValue({id}),acknowledge=vi.fn().mockResolvedValue(undefined),pending=vi.fn().mockResolvedValue({responses:[response],more:false}),actor={id:owner,role:'practitioner',state:'active'} as Actor;
 expect(await projectCommunityTasks(actor,{create}as unknown as InternalTaskService,{pending,acknowledge})).toEqual({linked:1,more:false});expect(pending).toHaveBeenCalledWith(owner);expect(create.mock.calls[0]?.[1]).toMatch(/^community_comment_[a-f0-9]{64}$/);expect(create.mock.calls[0]?.[2]).toMatchObject({caseId:null,note:null,dueDate:'2026-10-02',sourcePath:'/he/app/marketing?section=community&threadId='+id});expect(JSON.stringify(create.mock.calls[0])).not.toContain('DEMO public response');expect(acknowledge).toHaveBeenCalledWith(owner,rid,id);
 const first=create.mock.calls[0];await projectCommunityTasks(actor,{create}as unknown as InternalTaskService,{pending,acknowledge});expect(create.mock.calls[1]).toEqual(first);
 for(const role of ['parent','child','adult_client'])await expect(projectCommunityTasks({...actor,role}as Actor,{create}as unknown as InternalTaskService,{pending,acknowledge})).rejects.toMatchObject({code:'FORBIDDEN'});
});
