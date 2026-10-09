import {beforeEach,expect,test,vi} from 'vitest';
import {AppError} from '../../../src/lib/errors.ts';
import {SESSION_COOKIE} from '../../../src/lib/security/session.ts';
const hooks=vi.hoisted(()=>({actor:vi.fn(),csrf:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('../../../src/features/identity/runtime.ts',()=>({identityRuntime:async()=>({config:{origin:'https://life-skills.bneineviimacademy.org'},services:{sessions:{actor:hooks.actor,csrf:hooks.csrf}}})}));
import {marketingReview,saveArtworkReviewBridge,type ArtworkReviewResult} from '../../../src/features/marketing-overview/review.ts';
const origin='https://life-skills.bneineviimacademy.org',csrf='a'.repeat(43);
const command={assetId:'DEMO-artwork',revision:1,digest:'b'.repeat(64),reviewToken:'c'.repeat(64),operationId:'412302a8-3694-4718-9a3b-e5de1a78de6e',decision:'approve_artwork' as const,note:'DEMO artwork only.'};
const asset={assetId:command.assetId,revision:1,registeredRevision:true,locale:'he' as const,width:1080,height:1350,imageUrl:null,title:'DEMO only',caption:'',contentDigest:command.digest,review:'approved' as const,approvedDigest:command.digest,libraryState:'CURRENT_ACCEPTED_HELD',reviewToken:'d'.repeat(64),artworkReview:{decision:command.decision,note:command.note,savedAt:'2026-10-05T13:00:00.000Z',operationId:command.operationId}};
const result:ArtworkReviewResult={saved:true,readbackVerified:true,replayed:false,operationId:command.operationId,decision:command.decision,note:command.note,savedAt:asset.artworkReview.savedAt,asset};
const request=(input:unknown=command,headers:Record<string,string>={})=>new Request(origin+'/api/marketing/review',{method:'POST',headers:{cookie:`${SESSION_COOKIE}=synthetic-token`,origin,'content-type':'application/json','x-csrf-token':csrf,...headers},body:JSON.stringify(input)});
beforeEach(()=>{vi.clearAllMocks();vi.unstubAllEnvs();vi.unstubAllGlobals();hooks.actor.mockResolvedValue({role:'practitioner'});hooks.csrf.mockReturnValue(csrf);});
test.each(['parent','child','adult_client'])('%s denied before canonical source is contacted',async role=>{
 hooks.actor.mockResolvedValue({role});const fetch=vi.fn();vi.stubGlobal('fetch',fetch);
 const response=await marketingReview(request());expect(response.status).toBe(403);expect(response.headers.get('cache-control')).toBe('private, no-store');expect(fetch).not.toHaveBeenCalled();
});
test.each([{cookie:''},{cookie:`${SESSION_COOKIE}=a; ${SESSION_COOKIE}=b`},{origin:'https://untrusted.example'},{'x-csrf-token':'bad'},{'sec-fetch-site':'cross-site'}])('ordinary session/origin/CSRF denial preserves the source',async headers=>{
 const fetch=vi.fn();vi.stubGlobal('fetch',fetch);expect([401,403]).toContain((await marketingReview(request(command,headers))).status);expect(fetch).not.toHaveBeenCalled();
});
test('successful canonical readback must bind exact source, decision, time, holds and operation',async()=>{
 const authorize=vi.fn(),save=vi.fn().mockResolvedValue(result),response=await marketingReview(request(),{authorize,save});expect(response.status).toBe(200);expect(save).toHaveBeenCalledWith(command);expect((await response.json()).data).toEqual(result);expect(response.headers.get('referrer-policy')).toBe('no-referrer');
});
test.each([{readbackVerified:false},{decision:'needs_revision'},{operationId:'different'},{savedAt:'2020-01-01T00:00:00Z'},{asset:{...asset,contentDigest:'a'.repeat(64)}},{asset:{...asset,libraryState:'CURRENT_APPROVED'}},{asset:{...asset,artworkReview:{...asset.artworkReview,note:'Different'}}},{asset:{...asset,registeredRevision:false}}])('unbound success does not become a saved claim',async patch=>{
 const response=await marketingReview(request(),{authorize:vi.fn(),save:vi.fn().mockResolvedValue({...result,...patch})});expect(response.status).toBe(503);
});
test.each([{...command,ownerId:'caller'},{...command,revision:0},{...command,note:'x'.repeat(1201)},{...command,decision:'needs_revision',note:''}])('strict input rejects invalid command before writing',async input=>{
 const save=vi.fn();expect((await marketingReview(request(input),{authorize:vi.fn(),save})).status).toBe(400);expect(save).not.toHaveBeenCalled();
});
test('conflict stays recoverable without leaking provider error text',async()=>{
 const response=await marketingReview(request(),{authorize:vi.fn(),save:vi.fn().mockRejectedValue(new AppError('CONFLICT'))});expect(response.status).toBe(409);expect((await response.json()).error.code).toBe('CONFLICT');
});
test('fixed bridge POST has bounded time, private headers and no redirect; provider conflict remains 409',async()=>{
 vi.stubEnv('LIFE_SKILLS_CRM_BRIDGE_ORIGIN','https://existing-private-bridge.example');vi.stubEnv('LIFE_SKILLS_APP_BRIDGE_SECRET','z'.repeat(32));const fetch=vi.fn().mockResolvedValue(Response.json({success:true,result}));vi.stubGlobal('fetch',fetch);expect(await saveArtworkReviewBridge(command)).toEqual(result);const [url,init]=fetch.mock.calls[0]!;expect(url).toBe('https://existing-private-bridge.example/api/bna/life-skills-app/marketing/review');expect(init.method).toBe('POST');expect(init.redirect).toBe('error');expect(init.cache).toBe('no-store');expect(init.signal).toBeInstanceOf(AbortSignal);
 fetch.mockResolvedValue(Response.json({code:'PRIVATE_PROVIDER_ERROR'},{status:409}));await expect(saveArtworkReviewBridge(command)).rejects.toMatchObject({code:'CONFLICT'});
});
