import {beforeEach,describe,expect,it,vi} from 'vitest';
import {SESSION_COOKIE} from '../../../src/lib/security/session.ts';
const hooks=vi.hoisted(()=>({actor:vi.fn(),reply:vi.fn(),csrf:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('../../../src/features/identity/runtime.ts',()=>({identityRuntime:async()=>({config:{origin:'https://life-skills.bneineviimacademy.org'},services:{sessions:{actor:hooks.actor,csrf:hooks.csrf}}})}));
vi.mock('../../../src/features/community-reply/bridge.ts',()=>({requestCommunityReply:hooks.reply}));
import {POST} from '../../../src/app/api/community-reply/route.ts';
const origin='https://life-skills.bneineviimacademy.org',owner='9fe575fe-fba2-4a4b-a136-bb28560b13f2',csrf='a'.repeat(43);
const command={operationId:'412302a8-3694-4718-9a3b-e5de1a78de6e',mode:'generate',question:'DEMO public question only.'};
const request=(body:unknown)=>new Request(origin+'/api/community-reply',{method:'POST',headers:{cookie:`${SESSION_COOKIE}=synthetic-token`,origin,'content-type':'application/json','x-csrf-token':csrf},body:JSON.stringify(body)});
describe('generation validates the same public source link as saved drafts',()=>{
 beforeEach(()=>{vi.clearAllMocks();hooks.actor.mockResolvedValue({id:owner,role:'practitioner'});hooks.csrf.mockReturnValue(csrf);hooks.reply.mockResolvedValue({reply:'DEMO only.'});});
 it.each(['https://example.com/post','https://fb.watch/demo','http://facebook.com/post','https://user:password@facebook.com/post','https://facebook.com.untrusted.example/post'])('rejects %s before Scout/source/model work',async originalUrl=>{
  expect((await POST(request({...command,originalUrl}))).status).toBe(400);expect(hooks.reply).not.toHaveBeenCalled();
 });
 it.each(['facebook.com','www.facebook.com','m.facebook.com'])('preserves accepted %s sources and trusted session owner',async host=>{
  const originalUrl=`https://${host}/groups/demo/posts/42`;
  expect((await POST(request({...command,originalUrl}))).status).toBe(200);expect(hooks.reply).toHaveBeenCalledWith({...command,originalUrl,ownerId:owner});
 });
 it('allows no URL and retains role/CSRF/ownership denial',async()=>{
  expect((await POST(request(command))).status).toBe(200);hooks.reply.mockClear();
  expect((await POST(request({...command,ownerId:owner}))).status).toBe(400);
  hooks.actor.mockResolvedValue({id:owner,role:'parent'});expect((await POST(request(command))).status).toBe(403);expect(hooks.reply).not.toHaveBeenCalled();
 });
});
