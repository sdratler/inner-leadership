import {beforeEach,describe,expect,it,vi} from 'vitest';
import {SESSION_COOKIE} from '../../../src/lib/security/session.ts';
const hooks=vi.hoisted(()=>({actor:vi.fn(),read:vi.fn(),save:vi.fn(),csrf:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('../../../src/features/identity/runtime.ts',()=>({identityRuntime:async()=>({config:{origin:'https://life-skills.bneineviimacademy.org'},services:{sessions:{actor:hooks.actor,csrf:hooks.csrf}}})}));
vi.mock('../../../src/features/community-reply/drafts-bridge.ts',()=>({readCommunityDrafts:hooks.read,saveCommunityDraft:hooks.save}));
import {GET,PUT} from '../../../src/app/api/community-drafts/route.ts';
const origin='https://life-skills.bneineviimacademy.org',owner='9fe575fe-fba2-4a4b-a136-bb28560b13f2',id='412302a8-3694-4718-9a3b-e5de1a78de6e',cookie=`${SESSION_COOKIE}=synthetic-token`,csrf='a'.repeat(43);
const value={operationId:owner,draftId:id,expectedRevision:1,draft:'DEMO edited public draft only.'};
const request=(extra={},body:unknown=value)=>new Request(origin+'/api/community-drafts',{method:'PUT',headers:{cookie,origin,'content-type':'application/json','x-csrf-token':csrf,...extra},body:JSON.stringify(body)});
describe('ordinary authenticated practitioner draft route',()=>{
 beforeEach(()=>{vi.clearAllMocks();hooks.actor.mockResolvedValue({id:owner,role:'practitioner'});hooks.csrf.mockReturnValue(csrf);hooks.read.mockResolvedValue({drafts:[],limit:20});hooks.save.mockResolvedValue({draftId:id,revision:2});});
 it.each(['parent','child','adult_client'])('denies %s before contacting Scout',async role=>{hooks.actor.mockResolvedValue({id:owner,role});expect((await GET(new Request(origin+'/api/community-drafts',{headers:{cookie}}))).status).toBe(403);expect((await PUT(request())).status).toBe(403);expect(hooks.read).not.toHaveBeenCalled();expect(hooks.save).not.toHaveBeenCalled();});
 it('requires one current session and server identity; never accepts caller ownership',async()=>{
  expect((await GET(new Request(origin+'/api/community-drafts'))).status).toBe(401);expect((await GET(new Request(origin+'/api/community-drafts',{headers:{cookie:cookie+';'+cookie}}))).status).toBe(401);
  expect((await PUT(request({}, {...value,ownerId:id}))).status).toBe(400);expect(hooks.save).not.toHaveBeenCalled();
  expect((await GET(new Request(origin+'/api/community-drafts?draftId='+id,{headers:{cookie}}))).status).toBe(200);expect(hooks.read).toHaveBeenCalledWith(owner,id);
  const response=await PUT(request());expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(hooks.save).toHaveBeenCalledWith(owner,value);
 });
 it('retains exact origin/CSRF/strict query and input denials',async()=>{
  for(const extra of [{origin:'https://untrusted.invalid'},{'x-csrf-token':'b'.repeat(43)}])expect((await PUT(request(extra))).status).toBe(403);
  for(const query of ['draftId='+id+'&draftId='+id,'ownerId='+owner])expect((await GET(new Request(origin+'/api/community-drafts?'+query,{headers:{cookie}}))).status).toBe(400);
  for(const body of [{...value,expectedRevision:0},{...value,draft:' '},{...value,draft:'x'.repeat(3001)}])expect((await PUT(request({},body))).status).toBe(400);expect(hooks.save).not.toHaveBeenCalled();
 });
});
