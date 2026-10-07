import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach,expect,it,vi} from 'vitest';
const route=vi.hoisted(()=>({params:{locale:'en'} as {locale?:string}}));
vi.mock('next/navigation',()=>({useParams:()=>route.params}));
import NotFound from '../../../src/app/[locale]/not-found.tsx';
afterEach(()=>{route.params={locale:'en'};});
it.each(['en','he'] as const)('%s denial uses normal sign-in recovery, correct direction and no development/private destination',locale=>{
 route.params={locale};const html=renderToStaticMarkup(createElement(NotFound));
 expect(html).toContain(`lang="${locale}" dir="${locale==='he'?'rtl':'ltr'}"`);
 expect(html).toContain(locale==='he'?'העמוד אינו זמין':'Page unavailable');
 expect(html).toContain(`href="/${locale}/login"`);expect(html.match(/<a /g)).toHaveLength(1);
 for(const text of ['foundation','preview','/app/clients','/app/marketing','/family','caseId','role='])expect(html).not.toContain(text);
});
it('an unknown locale cannot supply a caller-controlled recovery URL',()=>{
 route.params={locale:'https://untrusted.invalid'};
 expect(renderToStaticMarkup(createElement(NotFound))).toContain('href="/en/login"');
});
