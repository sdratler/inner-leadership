import {expect,it,vi} from 'vitest';
const calls=vi.hoisted(()=>({role:vi.fn(),snapshot:vi.fn(),context:vi.fn(),digest:vi.fn(),headers:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/headers',()=>({headers:calls.headers}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('NOT_FOUND');},useRouter:()=>({push:vi.fn(),replace:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));
vi.mock('../../../src/features/integration/page-session.ts',()=>({requireWorkspaceRole:calls.role}));
vi.mock('../../../src/features/marketing-overview/provider.ts',()=>({loadMarketingSnapshot:calls.snapshot}));
vi.mock('../../../src/features/owner-digest/runtime.ts',()=>({ownerDigestContext:calls.context,loadOwnerDigest:calls.digest}));
import Page from '../../../src/app/[locale]/app/marketing/page.tsx';
import {MarketingDashboard} from '../../../src/ui/revamp/marketing-dashboard.tsx';
import type {MarketingSnapshot} from '../../../src/features/marketing-overview/contracts.ts';
import {AppError} from '../../../src/lib/errors.ts';
const snapshot:MarketingSnapshot={source:'registry_only',fetchedAt:null,creatives:[],publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:'unbound'}};
function setup(){
 for(const call of Object.values(calls))call.mockReset();
 calls.role.mockResolvedValue({role:'practitioner'});calls.snapshot.mockResolvedValue(snapshot);
 calls.headers.mockResolvedValue(new Headers({cookie:'synthetic-ordinary-session'}));
 calls.context.mockResolvedValue({actor:{role:'practitioner'},runtime:{}});calls.digest.mockResolvedValue({syntheticDigest:true});
}
for(const locale of ['he','en'] as const){
 it('omits the private owner digest for another practitioner without breaking permitted marketing sections',async()=>{
  setup();calls.context.mockRejectedValueOnce(new AppError('FORBIDDEN'));
  const result=await Page({params:Promise.resolve({locale}),searchParams:Promise.resolve({section:'overview'})});
  expect(result.type).toBe(MarketingDashboard);expect(result.props.ownerDigest).toBeUndefined();expect(calls.digest).not.toHaveBeenCalled();
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
 it.each(['content_calendar','creatives','needs_approval','community','ads'])(`${locale}: does not read the private owner digest on %s`,async section=>{
  setup();const result=await Page({params:Promise.resolve({locale}),searchParams:Promise.resolve({section})});
  expect(result.props.initialSection).toBe(section);expect(result.props.ownerDigest).toBeUndefined();
  expect(calls.context).not.toHaveBeenCalled();expect(calls.digest).not.toHaveBeenCalled();
 });
 it('checks practitioner access before reading either source',async()=>{
  setup();calls.role.mockRejectedValueOnce(Error('FORBIDDEN'));
  await expect(Page({params:Promise.resolve({locale}),searchParams:Promise.resolve({section:'bogus'})})).rejects.toThrow('NOT_FOUND');
  expect(calls.snapshot).not.toHaveBeenCalled();expect(calls.context).not.toHaveBeenCalled();
 });
}
