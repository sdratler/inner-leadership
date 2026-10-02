import {describe,expect,it,vi} from 'vitest';
vi.mock('server-only',()=>({}));
import {readCommunityDrafts,saveCommunityDraft} from '../../../src/features/community-reply/drafts-bridge.ts';
const owner='9fe575fe-fba2-4a4b-a136-bb28560b13f2',id='412302a8-3694-4718-9a3b-e5de1a78de6e',env={LS_COMMUNITY_SCOUT_BRIDGE_SECRET:'s'.repeat(43)};
const source=(id:string)=>({id,sha256:'a'.repeat(64),driveRevision:'5',declaredVersion:'2.0',modifiedAt:'2026-10-02T10:00:00Z',checkedAt:'2026-10-02T10:01:00Z'});
export const draft={draftId:id,question:'DEMO public question about a morning routine.',originalUrl:null,draft:'DEMO edited public community reply.',revision:2,editedAt:'2026-10-02T10:02:00Z',expiresAt:'2026-11-01T10:01:00Z',copyAllowed:true,reviewFlags:[],generated:{operationId:id,reply:'DEMO original public community reply.',copyAllowed:true,reviewFlags:[],suggestedRule:'',ruleScope:'',originalUrl:null,provenance:{guide:{...source('174-EqMG0QIH5rCuRgn2xYYPMX-XWJZNn'),includedCommunityRuleIds:[]},playbook:source('12C3QM4F6RZdpeWRvReN2x2BB7GzBnSqvfhjMg1PKwC0'),policyVersion:'synthetic',generatedAt:'2026-10-02T10:01:00Z',model:'synthetic',usage:{inputTokens:2,outputTokens:3}}}};
describe('existing Scout owned-draft bridge',()=>{
 it('passes only the trusted session identity to the one registered endpoint; reads historical provenance without a fresh-source claim',async()=>{
  const fetcher=vi.fn().mockResolvedValue(Response.json({ok:true,data:{drafts:[draft],limit:20}}));
  await expect(readCommunityDrafts(owner,id,fetcher,env)).resolves.toEqual({drafts:[draft],limit:20});
  const [url,options]=fetcher.mock.calls[0]!;expect(url).toBe(`https://community-scout-production.up.railway.app/internal/life-skills/drafts?ownerId=${owner}&draftId=${id}`);expect(options.method).toBe('GET');expect(options.cache).toBe('no-store');expect(options.redirect).toBe('error');
 });
 it('requires an exact edit receipt and preserves conflict/not-found instead of silently falling back',async()=>{
  const command={operationId:owner,draftId:id,expectedRevision:1,draft:draft.draft};const fetcher=vi.fn().mockResolvedValueOnce(Response.json({ok:true,data:draft})).mockResolvedValueOnce(new Response('',{status:409})).mockResolvedValueOnce(new Response('',{status:404}));
  await expect(saveCommunityDraft(owner,command,fetcher,env)).resolves.toEqual(draft);
  expect(JSON.parse(fetcher.mock.calls[0]![1].body)).toEqual({...command,ownerId:owner});
  await expect(saveCommunityDraft(owner,command,fetcher,env)).rejects.toMatchObject({code:'CONFLICT'});await expect(readCommunityDrafts(owner,id,fetcher,env)).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 it('rejects changed input/source/permission fields, duplicates and false save receipts',async()=>{
  const bad=[{...draft,draftId:owner},{...draft,originalUrl:'https://untrusted.invalid/'},{...draft,copyAllowed:true,reviewFlags:['UNREVIEWED']},{...draft,generated:{...draft.generated,provenance:{...draft.generated.provenance,guide:{...draft.generated.provenance.guide,includedCommunityRuleIds:undefined}}}}];
  for(const value of bad)await expect(readCommunityDrafts(owner,id,vi.fn().mockResolvedValue(Response.json({ok:true,data:{drafts:[value],limit:20}})),env)).rejects.toMatchObject({code:'UNAVAILABLE'});
  await expect(readCommunityDrafts(owner,undefined,vi.fn().mockResolvedValue(Response.json({ok:true,data:{drafts:[draft,draft],limit:20}})),env)).rejects.toMatchObject({code:'UNAVAILABLE'});
  await expect(saveCommunityDraft(owner,{operationId:owner,draftId:id,expectedRevision:2,draft:draft.draft},vi.fn().mockResolvedValue(Response.json({ok:true,data:draft})),env)).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
 it('does not call a provider with missing credentials/identity and bounds the returned envelope',async()=>{
  const fetcher=vi.fn();await expect(readCommunityDrafts(owner,undefined,fetcher,{})).rejects.toMatchObject({code:'UNAVAILABLE'});await expect(readCommunityDrafts('constructor',undefined,fetcher,env)).rejects.toMatchObject({code:'UNAVAILABLE'});expect(fetcher).not.toHaveBeenCalled();
  await expect(readCommunityDrafts(owner,undefined,vi.fn().mockResolvedValue(new Response('x'.repeat(1_000_001))),env)).rejects.toMatchObject({code:'UNAVAILABLE'});
 });
});
