import {academyR2Copy} from '../../src/features/group-application/academy-r2-copy.ts';
import {afterEach,describe,expect,it,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {TRIP390_OFFER} from '../../src/features/group-application/academy-trip390-contract.ts';
const route=vi.hoisted(()=>({mode:'legacy' as 'legacy'|'bna',campaign:vi.fn(async()=>null)}));
vi.mock('server-only',()=>({}));
vi.mock('../../src/features/group-application/academy-campaign-server.ts',()=>({academyCampaignSnapshot:route.campaign}));
vi.mock('../../src/features/group-application/academy-routing-server.ts',()=>({academyRouteMode:async()=>route.mode}));
import Landing,{generateMetadata as landingMeta} from '../../src/app/[locale]/florida/page.tsx';
import Apply,{generateMetadata as applyMeta} from '../../src/app/[locale]/florida/apply/page.tsx';
import Pricing,{generateMetadata as pricingMeta} from '../../src/app/[locale]/florida/pricing/page.tsx';
import Stage,{generateMetadata as stageMeta} from '../../src/app/[locale]/florida/stages/[stage]/page.tsx';

afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();route.mode='legacy';});
describe('Trip390 current public routes',()=>{
 for(const mode of ['legacy','bna'] as const)for(const locale of ['en','he'] as const)it(`mounts the selected ${locale} form in ${mode} and redirects old sales aliases to exact current sections`,async()=>{
  vi.stubEnv('LS_GROUP_APPLICATION_REAL_DATA_RELEASE','true');vi.stubEnv('LS_ACADEMY_PUBLIC_OFFER',TRIP390_OFFER.version);route.mode=mode;
  const params=Promise.resolve({locale,stage:'foundation'});
  for(const page of [Landing,Apply]){
   const html=renderToStaticMarkup(await page({params}));
   expect(html).toContain('id="trip390-interest-title"');expect(html).toContain('name="postalCode"');expect(html).toContain(academyR2Copy[locale].faqs.find(item=>item.id==='cost')!.a);expect(html).toContain('id="cost"');expect(html).toContain('id="learn"');
   expect(html).not.toContain('data-academy-registration');expect(html).not.toContain('name="stageInterest"');
  }
  for(const metadata of [landingMeta,applyMeta,pricingMeta,stageMeta]){
   expect(await metadata({params})).toMatchObject({title:academyR2Copy[locale].exact.pageTitle,description:academyR2Copy[locale].exact.metaDescription});
  }
  for(const [page,anchor] of [[Pricing,'cost'],[Stage,'learn']] as const){
   await expect(page({params})).rejects.toMatchObject({digest:`NEXT_REDIRECT;replace;/${locale}/florida${mode==='bna'?'?section='+anchor:''}#${anchor};307;`});
  }
  expect(route.campaign).not.toHaveBeenCalled();
 });
 it('denies unknown selectors and stage slugs without loading a founder campaign',async()=>{
  vi.stubEnv('LS_GROUP_APPLICATION_REAL_DATA_RELEASE','true');
  vi.stubEnv('LS_ACADEMY_PUBLIC_OFFER','bad-config');
  const params=Promise.resolve({locale:'en',stage:'foundation'});
  for(const page of [Landing,Apply,Pricing,Stage])await expect(page({params})).rejects.toMatchObject({digest:'NEXT_HTTP_ERROR_FALLBACK;404'});
  vi.stubEnv('LS_ACADEMY_PUBLIC_OFFER',TRIP390_OFFER.version);
  await expect(Stage({params:Promise.resolve({locale:'en',stage:'unknown'})})).rejects.toMatchObject({digest:'NEXT_HTTP_ERROR_FALLBACK;404'});
  expect(route.campaign).not.toHaveBeenCalled();
 });
});
