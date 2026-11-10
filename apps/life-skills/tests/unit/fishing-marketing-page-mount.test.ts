import { beforeEach, afterEach, expect, it, vi } from 'vitest';
const calls=vi.hoisted(()=>({owner:vi.fn(),snapshot:vi.fn(),page:vi.fn(),digest:vi.fn(),read:vi.fn(),creative:vi.fn(),attribution:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/headers',()=>({headers:async()=>new Headers({cookie:'synthetic-ordinary-session'})}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('PAGE_NOT_FOUND');}}));
vi.mock('../../src/features/owner-digest/runtime.ts',()=>({ownerDigestContext:calls.owner,loadOwnerDigest:calls.digest}));
vi.mock('../../src/features/marketing-overview/provider.ts',()=>({loadMarketingSnapshot:calls.snapshot}));
vi.mock('../../src/features/marketing-overview/page-publication-provider.ts',()=>({loadFacebookPagePublicationState:calls.page}));
vi.mock('../../src/features/fishing-marketing/store.ts',()=>({FishingMarketingStore:class{read=calls.read;}}));
vi.mock('../../src/features/fishing-marketing/creative.ts',()=>({verifiedFishingCreative:calls.creative}));
vi.mock('../../src/features/fishing-marketing/attribution-store.ts',()=>({readTaggedInquiries:calls.attribution}));
vi.mock('../../src/features/fishing-marketing/panel.tsx',()=>({FishingMarketingPanel:()=>null}));
import Page from '../../src/app/[locale]/app/marketing/page.tsx';
import { FishingMarketingPanel } from '../../src/features/fishing-marketing/panel.tsx';
import { AppError } from '../../src/lib/errors.ts';

beforeEach(()=>{
 for(const call of Object.values(calls))call.mockReset();
 calls.owner.mockResolvedValue({actor:{role:'practitioner'},runtime:{config:{workspaceId:'synthetic',keyring:{},lookupKey:Buffer.alloc(32)},store:{},clock:{}}});
 calls.snapshot.mockResolvedValue({source:'unconfigured',fetchedAt:null,creatives:[],publications:[],ads:[],scout:{readyDrafts:null,sourceUrl:null,lastChecked:null,status:'unbound'}});
 calls.page.mockResolvedValue(undefined);calls.read.mockResolvedValue(null);
 vi.stubEnv('LS_FISHING_MARKETING_ENABLED','false');
});
afterEach(()=>vi.unstubAllEnvs());

it.each(['en','he'] as const)('%s disabled Fishing sync stays visible as unavailable without invoking the store',async locale=>{
 for(const section of ['overview','content_calendar']){
  const page=await Page({params:Promise.resolve({locale}),searchParams:Promise.resolve({section})});
  const panel=page.props.groupPreparation;
  expect(panel?.type).toBe(FishingMarketingPanel);
  expect(panel?.props).toMatchObject({locale,data:null,unavailable:true,section});
 }
 expect(calls.owner).toHaveBeenCalledTimes(2);expect(calls.read).not.toHaveBeenCalled();
 expect(calls.creative).not.toHaveBeenCalled();expect(calls.attribution).not.toHaveBeenCalled();
});

it('does not mount the status panel in unrelated views or turn a storage outage into empty data',async()=>{
 for(const section of ['creatives','ads']){
  expect((await Page({params:Promise.resolve({locale:'en'}),searchParams:Promise.resolve({section})})).props.groupPreparation).toBeUndefined();
 }
 vi.stubEnv('LS_FISHING_MARKETING_ENABLED','true');calls.read.mockRejectedValueOnce(new AppError('UNAVAILABLE'));
 const page=await Page({params:Promise.resolve({locale:'en'}),searchParams:Promise.resolve({section:'overview'})});
 expect(page.props.groupPreparation?.props).toMatchObject({data:null,unavailable:true});
 expect(calls.read).toHaveBeenCalledOnce();expect(calls.attribution).not.toHaveBeenCalled();
});

it.each(['UNAUTHENTICATED','FORBIDDEN','NOT_FOUND'] as const)('owner %s denial precedes all snapshots and native data reads',async code=>{
 calls.owner.mockRejectedValueOnce(new AppError(code));
 await expect(Page({params:Promise.resolve({locale:'en'}),searchParams:Promise.resolve({section:'overview'})})).rejects.toThrow('PAGE_NOT_FOUND');
 expect(calls.snapshot).not.toHaveBeenCalled();expect(calls.page).not.toHaveBeenCalled();expect(calls.read).not.toHaveBeenCalled();
});
