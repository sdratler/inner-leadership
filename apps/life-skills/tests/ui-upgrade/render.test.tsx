import {describe,it,expect,vi} from 'vitest';
import {renderToStaticMarkup} from 'react-dom/server';
import {WorkspaceShell} from '../../src/ui/workspace/workspace-shell.tsx';
import {SettingsIndex} from '../../src/ui/workspace/settings-index.tsx';
import {AccountSettings} from '../../src/ui/workspace/account-settings.tsx';
vi.mock('next/navigation',()=>({useSearchParams:()=>new URLSearchParams('caseId=00000000-0000-4000-8000-000000000001')}));
describe('UI upgrade server-rendered structure (not authenticated journey proof)',()=>{
 for(const locale of ['en','he'] as const)for(const role of ['parent','practitioner'] as const){
  it(`${locale}/${role}: exact logo, direction, breadcrumb, one content title`,()=>{
   const base=role==='parent'?'family':'app';
   const html=renderToStaticMarkup(<WorkspaceShell locale={locale} role={role} pathname={`/${locale}/${base}/settings/notifications`} caseId="00000000-0000-4000-8000-000000000001" languageHref={`/${locale==='he'?'en':'he'}/${base}/settings/notifications`}><main><h1>Content title</h1></main></WorkspaceShell>);
   expect(html).toContain('/intake-brand/life-skills-logo.png');expect(html).toContain(`dir="${locale==='he'?'rtl':'ltr'}"`);expect(html.match(/<h1/g)?.length).toBe(1);expect(html).toContain('lsu-breadcrumbs');expect(html).toContain('aria-haspopup="dialog"');expect(html).not.toContain('lsw-brand-mark');expect(html).toContain('?caseId=00000000-0000-4000-8000-000000000001');
  });
  it(`${locale}/${role}: settings hub is links, not a wall of editable fields`,()=>{
   const html=renderToStaticMarkup(<SettingsIndex locale={locale} role={role}/>);
   expect(html).toContain('/settings/account?caseId=');expect(html).not.toContain('<input');expect(html).not.toContain('<textarea');expect(html.match(/lsu-settings-card/g)?.length).toBe(role==='parent'?4:3);
  });
 }
 it('coordination remains a contextual link rather than a preference form',()=>{const html=renderToStaticMarkup(<AccountSettings locale="en" role="parent" section="coordination"/>);expect(html).toContain('/family/practice?caseId=00000000-0000-4000-8000-000000000001');expect(html).not.toContain('settings-language');expect(html).not.toContain('quiet-start');});
});
