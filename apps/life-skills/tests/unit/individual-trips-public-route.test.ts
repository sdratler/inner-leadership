import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import Page,{generateMetadata} from '../../src/app/[locale]/florida/trips/page.tsx';
import { individualTripsRuntime } from '../../src/features/individual-trips/runtime.ts';
vi.mock('../../src/features/individual-trips/runtime.ts',()=>({individualTripsRuntime:vi.fn()}));
const request=(locale:'en'|'he')=>({params:Promise.resolve({locale})});
beforeEach(()=>{vi.stubEnv('LS_INDIVIDUAL_TRIPS_PUBLIC_ENABLED','true');vi.stubEnv('LS_APP_ORIGIN','https://life-skills.bneineviimacademy.org');vi.mocked(individualTripsRuntime).mockReset();});
afterEach(()=>vi.unstubAllEnvs());
it.each(['en','he'] as const)('uses the actual configured registration capability for the healthy %s page and preview',async locale=>{
 vi.mocked(individualTripsRuntime).mockResolvedValue({providerAvailability:{registration:'configured'}} as Awaited<ReturnType<typeof individualTripsRuntime>>);
 const page=await Page(request(locale)),markup=renderToStaticMarkup(page),metadata=await generateMetadata(request(locale));
 expect(page.props.signupOpen).toBe(true);expect(markup).toContain(`href="/${locale}/trips"`);
 expect(metadata.description).toMatch(locale==='en'?/for free/:/ללא עלות/);
});
it.each(['disabled','unavailable','throws'] as const)('keeps the public page open with contact actions when native signup is %s',async registration=>{
 if(registration==='throws')vi.mocked(individualTripsRuntime).mockRejectedValue(new Error('private configuration unavailable'));
 else vi.mocked(individualTripsRuntime).mockResolvedValue({providerAvailability:{registration}} as Awaited<ReturnType<typeof individualTripsRuntime>>);
 const page=await Page(request('en')),markup=renderToStaticMarkup(page),metadata=await generateMetadata(request('en'));
 expect(page.props.signupOpen).toBe(false);expect(markup).not.toContain('href="/en/trips"');expect(markup).toContain('Ask about dates on WhatsApp');
 expect(metadata.description).not.toContain('for free');expect(JSON.stringify(metadata)).not.toContain('private configuration');
});
it('does not initialize private runtime when the public release flag is closed',async()=>{
 vi.stubEnv('LS_INDIVIDUAL_TRIPS_PUBLIC_ENABLED','false');await expect(Page(request('en'))).rejects.toThrow();
 expect(individualTripsRuntime).not.toHaveBeenCalled();
});
