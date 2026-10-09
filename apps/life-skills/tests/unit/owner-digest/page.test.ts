import {expect,it,vi} from 'vitest';
const calls=vi.hoisted(()=>({snapshot:vi.fn(),page:vi.fn(),context:vi.fn(),digest:vi.fn(),headers:vi.fn(),voice:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/headers',()=>({headers:calls.headers}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('NOT_FOUND');},useRouter:()=>({push:vi.fn(),replace:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));
vi.mock('../../../src/features/marketing-overview/provider.ts',()=>({loadMarketingSnapshot:calls.snapshot}));
vi.mock('../../../src/features/marketing-overview/page-publication-provider.ts',()=>({loadFacebookPagePublicationState:calls.page}));
vi.mock('../../../src/features/owner-digest/runtime.ts',()=>({ownerDigestContext:calls.context,loadOwnerDigest:calls.digest}));
vi.mock('../../../src/features/content-voice/source.ts',()=>({readContentVoiceSource:calls.voice}));
import Page from '../../../src/app/[locale]/app/marketing/page.tsx';
import {MarketingDashboard} from '../../../src/ui/revamp/marketing-dashboard.tsx';
import {CommunitySection} from '../../../src/features/community-reply/section.tsx';
import type {MarketingSnapshot} from '../../../src/features/marketing-overview/contracts.ts';
import {AppError} from '../../../src/lib/errors.ts';
const snapshot:MarketingSnapshot={source:'registry_only',fetchedAt:null,creatives:[],publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:'unbound'}};
function setup(){
 for(const call of Object.values(calls))call.mockReset();
 calls.snapshot.mockResolvedValue(snapshot);calls.page.mockResolvedValue({state:'BRIDGE_UNAVAILABLE',lifecycleState:'BLOCKED',reason:null,destinationConfigured:false,providerEvidenceAvailable:false,externalWriteEnabled:false,externalWritePerformed:false,noBlindRetry:false,recentRecords:[]});
 calls.headers.mockResolvedValue(new Headers({cookie:'synthetic-ordinary-session'}));
 calls.context.mockResolvedValue({actor:{role:'practitioner'},runtime:{}});calls.digest.mockResolvedValue({syntheticDigest:true});
}
for(const locale of ['he','en'] as const){
 it('preserves the actual graphics page and filters while sharing section normalization',async()=>{
  setup();const result=await Page({params:Promise.resolve({locale}),searchParams:Promise.resolve({section:'creatives',page:'2',placement:'facebook_feed',language:'he',search:'DEMO'})});
  expect(result.props.creativeQuery).toMatchObject({section:'creatives',page:'2',placement:'facebook_feed',language:'he',search:'DEMO'});expect(calls.context).toHaveBeenCalledOnce();expect(calls.digest).not.toHaveBeenCalled();
 });
 it('denies the owner overview for another practitioner without exposing either read model',async()=>{
  setup();calls.context.mockRejectedValueOnce(new AppError('FORBIDDEN'));
  await expect(Page({params:Promise.resolve({locale}),searchParams:Promise.resolve({section:'overview'})})).rejects.toThrow('NOT_FOUND');
  expect(calls.snapshot).not.toHaveBeenCalled();expect(calls.page).not.toHaveBeenCalled();expect(calls.digest).not.toHaveBeenCalled();
 });
 it('does not turn a fresh role denial during digest reads into a permitted marketing response',async()=>{
  setup();calls.digest.mockRejectedValueOnce(new AppError('FORBIDDEN'));
  await expect(Page({params:Promise.resolve({locale}),searchParams:Promise.resolve({section:'overview'})})).rejects.toThrow('NOT_FOUND');
 });
 it('does not hide an actual digest failure as another practitioner',async()=>{
  setup();calls.digest.mockRejectedValueOnce(new AppError('UNAVAILABLE'));
  await expect(Page({params:Promise.resolve({locale}),searchParams:Promise.resolve({section:'overview'})})).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it.each([undefined,'overview','calendar','bogus',['ads','community']])(`${locale}: loads the owner summary for an overview after normalizing %j`,async section=>{
  setup();const result=await Page({params:Promise.resolve({locale}),searchParams:Promise.resolve({section})});
  expect(result.type).toBe(MarketingDashboard);expect(result.props.ownerDigest).toEqual({syntheticDigest:true});
  expect(calls.context).toHaveBeenCalledOnce();expect(calls.digest).toHaveBeenCalledWith({role:'practitioner'},{},snapshot,locale);
 });
 it.each(['content_calendar','creatives','needs_approval','community','ads'])(`${locale}: checks owner access for %s without reading the overview digest`,async section=>{
  setup();const result=await Page({params:Promise.resolve({locale}),searchParams:Promise.resolve({section})});
  if(section==='community'){
   expect(result.type).toBe(CommunitySection);expect(result.props.view).toBe('opportunities');expect(calls.snapshot).not.toHaveBeenCalled();
  }else expect(result.props.initialSection).toBe(section);
  expect(result.props.ownerDigest).toBeUndefined();
  expect(calls.context).toHaveBeenCalledOnce();expect(calls.digest).not.toHaveBeenCalled();
  if(section==='content_calendar')expect(calls.page).toHaveBeenCalledOnce();else expect(calls.page).not.toHaveBeenCalled();
 });
 it('checks actual configured-owner access before reading any source',async()=>{
  setup();calls.context.mockRejectedValueOnce(new AppError('FORBIDDEN'));
  await expect(Page({params:Promise.resolve({locale}),searchParams:Promise.resolve({section:'bogus'})})).rejects.toThrow('NOT_FOUND');
  expect(calls.snapshot).not.toHaveBeenCalled();expect(calls.page).not.toHaveBeenCalled();expect(calls.voice).not.toHaveBeenCalled();
 });
 it.each(['UNAUTHENTICATED','NOT_FOUND'] as const)(`denies %s before provider reads`,async code=>{
  setup();calls.context.mockRejectedValueOnce(new AppError(code));
  await expect(Page({params:Promise.resolve({locale}),searchParams:Promise.resolve({section:'content_calendar'})})).rejects.toThrow('NOT_FOUND');
  expect(calls.snapshot).not.toHaveBeenCalled();expect(calls.page).not.toHaveBeenCalled();
 });
}
