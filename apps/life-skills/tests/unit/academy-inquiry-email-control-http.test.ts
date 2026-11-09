import {beforeEach,describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {founderPublicHttp,type FounderPublicDependencies} from '../../src/features/group-application/academy-founder-http.ts';
import {INQUIRY_EMAIL_CONTROL_PURPOSE,INQUIRY_EMAIL_CONTROL_VERSION} from '../../src/features/group-application/academy-inquiry-email-verification.ts';
import {inquiryEmailControlResult} from '../../src/features/group-application/academy-inquiry-email-control-copy.ts';

const origin='https://bneineviimacademy.org',path='/api/public/academy-founder',token='a'.repeat(43);
const confirmPost=vi.fn(async()=>({state:'confirmed' as const}));
const store={aggregate:vi.fn(async()=>{throw Error('LEGACY_AGGREGATE_MUST_NOT_RUN');}),confirm:vi.fn(async()=>{throw Error('LEGACY_CONFIRM_MUST_NOT_RUN');}),confirmationContext:vi.fn(async()=>{throw Error('LEGACY_CONTEXT_MUST_NOT_RUN');})};
const afterConfirm=vi.fn(async()=>undefined);
const limits={consume:vi.fn(async()=>({count:1,retryAfterMs:0}))};
const dependencies=(patch:Partial<FounderPublicDependencies>={}):FounderPublicDependencies=>({enabled:false,store,afterConfirm,environment:{NODE_ENV:'production',LS_APP_ORIGIN:'https://life-skills.bneineviimacademy.org',LS_GROUP_APPLICATION_PUBLIC_ORIGIN:origin},limits,rateKey:'synthetic-rate-key-at-least-thirty-two-characters',emailControl:{enabled:true,confirmPost},...patch});
const command={action:'confirm_inquiry_email',purpose:INQUIRY_EMAIL_CONTROL_PURPOSE,version:INQUIRY_EMAIL_CONTROL_VERSION,token};
function request(method='POST',body:unknown=command,headers:Record<string,string>={},suffix=''){
 return new Request(origin+path+suffix,{method,headers:{host:'bneineviimacademy.org',origin,'sec-fetch-site':'same-origin','content-type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{})});
}
beforeEach(()=>{vi.clearAllMocks();confirmPost.mockResolvedValue({state:'confirmed'});limits.consume.mockResolvedValue({count:1,retryAfterMs:0});});
describe('public mailbox control is an explicit isolated capability',()=>{
 it('accepts only the strict explicit command and returns no bearer or PII',async()=>{
  const response=await founderPublicHttp(request(),async()=>dependencies());
  expect(response.status).toBe(200);expect(await response.json()).toMatchObject({ok:true,data:{state:'confirmed'}});
  expect(confirmPost).toHaveBeenCalledExactlyOnceWith({method:'POST',token});
  expect(store.confirm).not.toHaveBeenCalled();expect(store.confirmationContext).not.toHaveBeenCalled();expect(afterConfirm).not.toHaveBeenCalled();
  expect(response.headers.get('cache-control')).toBe('private, no-store');expect(response.headers.get('referrer-policy')).toBe('no-referrer');
 });
 it('joins an actual Request/handler response to the browser evidence parser',async()=>{
  const response=await founderPublicHttp(request(),async()=>dependencies());
  const body=await response.json();expect(body.requestId).toMatch(/^[a-f0-9-]{36}$/);
  expect(inquiryEmailControlResult(body)).toBe('confirmed');
  expect(inquiryEmailControlResult({...body,data:{confirmed:true}})).toBeNull();
 });
 it.each(['GET','HEAD','OPTIONS'])('%s and scanners never call a confirmation service',async method=>{
  const response=await founderPublicHttp(request(method),async()=>dependencies());expect(response.status).toBeGreaterThanOrEqual(400);
  expect(confirmPost).not.toHaveBeenCalled();expect(store.confirm).not.toHaveBeenCalled();expect(store.aggregate).not.toHaveBeenCalled();
 });
 it.each([
  {...command,purpose:'academy_founder_interest'}, {...command,version:'v0'}, {...command,token:'bad'},
  {...command,reference:'private-reference'}, {...command,guardianAssurance:true},
  {action:'confirm_interest',token}, {action:'read_confirmation',token},
 ])('denies wrong purpose/version/shape and legacy actions while their gate is closed',async body=>{
  const response=await founderPublicHttp(request('POST',body),async()=>dependencies());expect(response.status).toBeGreaterThanOrEqual(400);
  expect(confirmPost).not.toHaveBeenCalled();expect(store.confirm).not.toHaveBeenCalled();expect(store.confirmationContext).not.toHaveBeenCalled();
 });
 it.each([{origin:'https://foreign.example'},{'sec-fetch-site':'cross-site'},{host:'foreign.example'}])('denies cross-origin or host confusion',async headers=>{
  expect((await founderPublicHttp(request('POST',command,headers),async()=>dependencies())).status).toBe(403);expect(confirmPost).not.toHaveBeenCalled();
 });
 it('does not accept a token in a server query',async()=>{
  expect((await founderPublicHttp(request('POST',command,{},'?token='+token),async()=>dependencies())).status).toBe(400);expect(confirmPost).not.toHaveBeenCalled();
 });
 it('enforces distributed rate denial before the capability',async()=>{
  limits.consume.mockResolvedValue({count:61,retryAfterMs:1000});expect((await founderPublicHttp(request(),async()=>dependencies())).status).toBe(429);expect(confirmPost).not.toHaveBeenCalled();
 });
 it('cannot enable verification through the historical founder flag',async()=>{
  const response=await founderPublicHttp(request(),async()=>dependencies({enabled:true,emailControl:{enabled:false,confirmPost}}));expect(response.status).toBe(503);expect(confirmPost).not.toHaveBeenCalled();
 });
 it('keeps uncertain service failures generic with no echoed secret',async()=>{
  confirmPost.mockRejectedValueOnce(Error(token));const response=await founderPublicHttp(request(),async()=>dependencies());expect(response.status).toBe(503);expect(await response.text()).not.toContain(token);expect(afterConfirm).not.toHaveBeenCalled();
 });
});
