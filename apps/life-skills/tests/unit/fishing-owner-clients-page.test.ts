import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const h=vi.hoisted(()=>({session:vi.fn(),runtime:vi.fn(),cutover:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/headers',()=>({headers:async()=>new Headers({cookie:'__Host-ls-session='+'a'.repeat(43)})}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('NOT_FOUND');},redirect:(url:string)=>{throw Error('REDIRECT:'+url);}}));
vi.mock('../../src/features/integration/page-session.ts',()=>({requireWorkspaceRole:h.session}));
vi.mock('../../src/features/identity/runtime.ts',()=>({identityRuntime:h.runtime}));
vi.mock('../../src/features/contact-ops/server/cutover-store.ts',()=>({ContactCutoverStore:class{read=h.cutover;}}));
vi.mock('../../src/features/contact-ops/academy-crm-workspace.tsx',()=>({AcademyCrmWorkspace:()=>null}));
vi.mock('../../src/features/cases/clients-roster.tsx',()=>({ClientsRoster:()=>null}));
vi.mock('../../src/features/bna-inquiry/owner-panel.tsx',()=>({BnaInquiryOwnerPanel:()=>null}));
vi.mock('../../src/features/conversation-305/owner-panel.tsx',()=>({Owner305ConversationPanel:()=>null}));
vi.mock('../../src/features/people/lead-workspace.tsx',()=>({LeadWorkspace:()=>null}));
vi.mock('../../src/features/provider-index/entry-link.tsx',()=>({ProviderIndexEntryLink:()=>null}));
import Page from '../../src/app/[locale]/app/clients/page.tsx';
import {AcademyCrmWorkspace} from '../../src/features/contact-ops/academy-crm-workspace.tsx';
beforeEach(()=>{
 h.session.mockReset().mockResolvedValue({role:'practitioner',fishingOwner:true});
 h.cutover.mockReset().mockResolvedValue({phase:'academy_native'});
 h.runtime.mockReset().mockResolvedValue({config:{keyring:{},lookupKey:Buffer.alloc(32)},store:{},clock:{},services:{sessions:{actor:async()=>({id:'synthetic-owner'})}}});
 for(const key of ['LS_BNA_COMBINED_PEOPLE_ENABLED','LS_BNA_INQUIRY_ENABLED','LS_305_CLASSIFICATION_ENABLED','LS_BNA_PREFERENCES_ENABLED','LS_BNA_MAILBOX_REPLIES_ENABLED'])vi.stubEnv(key,'true');
 vi.stubEnv('LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID','synthetic-owner');
});
afterEach(()=>vi.unstubAllEnvs());
it.each(['en','he'] as const)('%s selected owner returns only native Academy contacts despite BNA flags and legacy query hints',async locale=>{
 const page=await Page({params:Promise.resolve({locale}),searchParams:Promise.resolve({mode:'demo',view:'legacy',section:'practice'})});
 expect(page.type).toBe(AcademyCrmWorkspace);expect(page.props.locale).toBe(locale);
});
it('selected owner cannot fall back to the retired roster when native admission is unavailable',async()=>{
 h.cutover.mockResolvedValue({phase:'frozen'});
 await expect(Page({params:Promise.resolve({locale:'en'}),searchParams:Promise.resolve({view:'legacy'})})).rejects.toThrow('UNAVAILABLE');
});
