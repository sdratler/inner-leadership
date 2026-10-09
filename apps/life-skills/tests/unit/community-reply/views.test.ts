import {describe,it,expect,vi,beforeEach} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {communityView} from '../../../src/features/community-reply/views.ts';
const boundary=vi.hoisted(()=>({role:vi.fn(),headers:vi.fn(),digest:vi.fn(),marketing:vi.fn(),source:vi.fn()}));
vi.mock('server-only',()=>({}));
vi.mock('next/headers',()=>({headers:boundary.headers}));
vi.mock('next/navigation',()=>({notFound:()=>{throw Error('NOT_FOUND');}}));
vi.mock('../../../src/features/owner-digest/runtime.ts',()=>({ownerDigestContext:boundary.role,loadOwnerDigest:boundary.digest}));
vi.mock('../../../src/features/marketing-overview/provider.ts',()=>({loadMarketingSnapshot:boundary.marketing}));
vi.mock('../../../src/features/content-voice/source.ts',()=>({readContentVoiceSource:boundary.source}));
vi.mock('../../../src/features/community-reply/workspace.tsx',()=>({CommunityReplyWorkspace:()=> 'DEMO opportunities only'}));
vi.mock('../../../src/features/community-reply/settings-panel.tsx',()=>({CommunitySettingsPanel:({view}:{view:string})=>`DEMO ${view} settings only`}));
import Page from '../../../src/app/[locale]/app/marketing/page.tsx';
import {AppError} from '../../../src/lib/errors.ts';
const source={title:'DEMO canonical source',sourceUrl:'https://drive.google.com/file/d/demo-source/view',declaredVersion:'2.0',driveRevision:'13',modifiedAt:'2026-10-05T10:00:00Z',checkedAt:'2026-10-05T14:00:00Z',sha256:'a'.repeat(64),text:'DEMO guide contents'};
beforeEach(()=>{vi.clearAllMocks();boundary.headers.mockResolvedValue(new Headers({cookie:'synthetic-ordinary-session'}));boundary.role.mockResolvedValue({actor:{role:'practitioner'},runtime:{}});boundary.source.mockResolvedValue(source);});
describe('one selected Community page',()=>{
 it('defaults absent, unknown, inherited and repeated selectors without guessing an administrative view',()=>{
  for(const value of [undefined,null,'constructor','__proto__','toString','settings',['budget','budget']])expect(communityView(value)).toBe('opportunities');
 });
 it.each(['en','he'] as const)('%s renders only the selected view and reads the canonical guide only for Writing rules',async locale=>{
  for(const view of ['opportunities','sources','budget','writing_rules']){
   const html=renderToStaticMarkup(await Page({params:Promise.resolve({locale}),searchParams:Promise.resolve({section:'community',communityView:view})}));
   expect(boundary.marketing).not.toHaveBeenCalled();expect(boundary.role).toHaveBeenCalledWith('synthetic-ordinary-session');
   if(view==='opportunities')expect(html).toContain('DEMO opportunities only');else expect(html).not.toContain('DEMO opportunities only');
   if(view==='sources'||view==='budget')expect(html).toContain(`DEMO ${view} settings only`);else expect(html).not.toContain('settings only');
   if(view==='writing_rules'){expect(html).toContain(source.text);expect(boundary.source).toHaveBeenCalledTimes(1);}else{expect(html).not.toContain(source.text);expect(boundary.source).not.toHaveBeenCalled();}
  }
 });
 it('denies unauthorized pages before any source/marketing read, and never presents a failed source as current',async()=>{
  boundary.role.mockRejectedValueOnce(new AppError('FORBIDDEN'));await expect(Page({params:Promise.resolve({locale:'en'}),searchParams:Promise.resolve({section:'community',communityView:'writing_rules'})})).rejects.toThrow('NOT_FOUND');expect(boundary.source).not.toHaveBeenCalled();expect(boundary.marketing).not.toHaveBeenCalled();
  boundary.source.mockRejectedValueOnce(Error('SOURCE_CHANGED'));const html=renderToStaticMarkup(await Page({params:Promise.resolve({locale:'en'}),searchParams:Promise.resolve({section:'community',communityView:'writing_rules'})}));expect(html).toContain('Source unavailable right now');expect(html).not.toContain(source.text);expect(html).not.toContain('Fresh source read verified');
 });
});
