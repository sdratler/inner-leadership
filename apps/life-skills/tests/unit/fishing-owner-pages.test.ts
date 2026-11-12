import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const h=vi.hoisted(()=>({session:vi.fn(),owner:vi.fn(),availability:vi.fn(),contacts:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/headers',()=>({headers:async()=>new Headers({'x-ls-practitioner-return':'/en/app/settings'})}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('PAGE_NOT_FOUND');},redirect:(url:string)=>{throw Error('REDIRECT:'+url);}}));
vi.mock('../../src/features/integration/page-session.ts',()=>({requireWorkspaceRole:h.session,requireFishingOwnerPage:h.owner}));
vi.mock('../../src/lib/fishing-owner-surface-runtime.ts',()=>({fishingOwnerSurfaceAvailability:h.availability}));
vi.mock('../../src/features/fishing-owner/fishing-owner-shell.tsx',()=>({FishingOwnerShell:()=>null}));
vi.mock('../../src/features/fishing-owner/fishing-owner-settings.tsx',()=>({FishingOwnerSettings:()=>null}));
vi.mock('../../src/ui/workspace/core-navigation.tsx',()=>({CoreNavigation:()=>null}));
vi.mock('../../src/features/pwa/registration.tsx',()=>({PwaRegistration:()=>null}));
import Layout from '../../src/app/[locale]/app/layout.tsx';
import Settings from '../../src/app/[locale]/app/settings/page.tsx';
import {FishingOwnerShell} from '../../src/features/fishing-owner/fishing-owner-shell.tsx';
import {FishingOwnerSettings} from '../../src/features/fishing-owner/fishing-owner-settings.tsx';
import {SettingsIndex} from '../../src/ui/workspace/settings-index.tsx';
import {AppError} from '../../src/lib/errors.ts';
beforeEach(()=>{
 for(const call of Object.values(h))call.mockReset();
 h.session.mockResolvedValue({role:'practitioner',fishingOwner:true});
 h.owner.mockResolvedValue({scope:{binding:{workspaceId:'SYNTHETIC-workspace'}},actor:{id:'SYNTHETIC-owner'},identity:{services:{preferences:{contacts:h.contacts}}}});
 h.availability.mockResolvedValue({inquiries:{state:'available'},settings:{state:'available'}});
 h.contacts.mockResolvedValue({email:'owner@example.invalid',emailVerified:true,phone:null,phoneVerified:false});
 vi.stubEnv('LS_FISHING_OWNER_APP_SCOPE_JSON','SYNTHETIC-server-selection');
});
afterEach(()=>vi.unstubAllEnvs());
it.each(['en','he'] as const)('%s actual layout selects only the trusted owner shell and native availability',async locale=>{
 const page=await Layout({params:Promise.resolve({locale}),children:'SYNTHETIC guarded page'});
 expect(page.type).toBe(FishingOwnerShell);expect(page.props.locale).toBe(locale);
 expect(page.props.availability).toEqual({inquiries:{state:'available'},settings:{state:'available'}});
 expect(h.owner).toHaveBeenCalledOnce();expect(h.availability).toHaveBeenCalledOnce();
});
it('a role alone cannot select the owner shell',async()=>{
 h.session.mockResolvedValue({role:'practitioner'});
 const page=await Layout({params:Promise.resolve({locale:'en'}),children:'SYNTHETIC'});
 expect(page.type).not.toBe(FishingOwnerShell);expect(h.owner).not.toHaveBeenCalled();
});
it('late owner revocation redirects safely; native outage never falls back to a legacy shell',async()=>{
 h.owner.mockRejectedValueOnce(new AppError('UNAUTHENTICATED'));
 await expect(Layout({params:Promise.resolve({locale:'en'}),children:'SYNTHETIC'})).rejects.toThrow('REDIRECT:/en/login?next=%2Fen%2Fapp%2Fsettings');
 h.availability.mockRejectedValueOnce(new AppError('UNAVAILABLE'));
 await expect(Layout({params:Promise.resolve({locale:'en'}),children:'SYNTHETIC'})).rejects.toThrow('UNAVAILABLE');
});
it.each(['en','he'] as const)('%s settings binds only same-owner contacts with trusted account/workspace lifetime key',async locale=>{
 const page=await Settings({params:Promise.resolve({locale})});
 expect(page.type).toBe(FishingOwnerSettings);expect(page.key).toBe('SYNTHETIC-workspace:SYNTHETIC-owner');
 expect(page.props).toEqual({mode:'fishing_owner',locale,contacts:{state:'available',value:{email:'owner@example.invalid',emailVerified:true,phone:null,phoneVerified:false}}});
 expect(h.contacts).toHaveBeenCalledExactlyOnceWith({id:'SYNTHETIC-owner'});
});
it('settings read failure contains no stale contact facts and does not invent a saved result',async()=>{
 h.contacts.mockRejectedValueOnce(new AppError('UNAVAILABLE'));
 const page=await Settings({params:Promise.resolve({locale:'en'})});
 expect(page.props.contacts).toEqual({state:'unavailable',reason:'UNAVAILABLE'});
 h.contacts.mockRejectedValueOnce(new AppError('FORBIDDEN'));
 await expect(Settings({params:Promise.resolve({locale:'en'})})).rejects.toThrow('PAGE_NOT_FOUND');
});
it('the separate unselected application keeps its existing settings without owner-scope inference',async()=>{
 vi.stubEnv('LS_FISHING_OWNER_APP_SCOPE_JSON',undefined);
 const page=await Settings({params:Promise.resolve({locale:'he'})});expect(page.type).toBe(SettingsIndex);
 expect(h.owner).not.toHaveBeenCalled();expect(h.contacts).not.toHaveBeenCalled();
});
