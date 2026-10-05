import {expect,it,vi} from 'vitest';
const roleCheck=vi.hoisted(()=>vi.fn());
const redirect=vi.hoisted(()=>vi.fn((path:string)=>{throw new Error('REDIRECT '+path);}));
vi.mock('../../src/features/integration/page-session.ts',()=>({requireWorkspaceRoles:roleCheck}));
vi.mock('next/navigation',()=>({redirect,useRouter:()=>({replace:vi.fn()}),useSearchParams:()=>new URLSearchParams(),useParams:()=>({locale:'he'})}));
import {eligibleFormResponders} from '../../src/features/shared-items/workspace.tsx';
import {workspaceGroups,settingsItems,breadcrumbItems,primaryNavigation} from '../../src/ui/workspace/navigation-model.ts';
import ClientNotFound,{ClientAccessDenied} from '../../src/app/[locale]/client/not-found.tsx';
import ClientFormsPage from '../../src/app/[locale]/client/forms/page.tsx';
import ClientResourcesPage from '../../src/app/[locale]/client/resources/page.tsx';
import ClientReportsPage from '../../src/app/[locale]/client/reports/page.tsx';
import {ReportsPage} from '../../src/features/progress/reports-page.tsx';
import {AppError} from '../../src/lib/errors.ts';
import {SharedItemsWorkspace} from '../../src/features/shared-items/workspace.tsx';
const member=(id:string,role:'parent'|'adult_client'|'child',state='active',guardianRevokedAt:string|null=null)=>({accountId:id,displayName:'Synthetic '+id,email:id+'@example.invalid',role,state,guardianRevokedAt});
it('shows only active authorized parents for minor forms and the actual adult for adult forms, never a child responder',()=>{
 const members=[member('parent','parent'),member('child','child'),member('adult','adult_client'),member('revoked','parent','active','2026-09-01'),member('invited','parent','invited')];
 expect(eligibleFormResponders('minor',members).map(m=>m.accountId)).toEqual(['parent']);expect(eligibleFormResponders('adult',members).map(m=>m.accountId)).toEqual(['adult']);
});
it('places Form templates only in practitioner account Settings with a contextual breadcrumb, not global navigation',()=>{
 expect(settingsItems('practitioner').filter(item=>item.path==='app/settings/templates')).toHaveLength(1);
 for(const role of ['parent','client'] as const)expect(settingsItems(role).map(item=>item.key)).not.toContain('templates');
 expect(primaryNavigation.practitioner.map(item=>item.key)).not.toContain('templates');
 expect(breadcrumbItems('he','practitioner','/he/app/settings/templates').map(item=>item.label)).toEqual(['בית','הגדרות','תבניות טפסים']);
});
it('renders ordinary client denial with a same-locale recovery link and no form, role switch or preview bypass',()=>{
 expect(ClientNotFound().props.locale).toBe('he');const view=ClientAccessDenied({locale:'he'});expect(view.props.role).toBe('alert');expect(view.props.dir).toBe('rtl');
 const content=JSON.stringify(view);expect(content).toContain('העמוד אינו זמין');expect(content).toContain('/he/client');
 expect(content).not.toContain('/preview');expect(content).not.toContain('form');expect(content).not.toContain('practitioner');
});
it('makes adult materials/forms discoverable but keeps optional child and unknown client navigation fail-closed',()=>{
 expect(workspaceGroups('client','adult_client').flatMap(g=>g.items).map(item=>item.path)).toEqual(['client/forms','client/resources','client/reports']);
 expect(workspaceGroups('client','child')).toEqual([]);expect(workspaceGroups('client')).toEqual([]);
 expect(workspaceGroups('parent').flatMap(g=>g.items).map(item=>item.path)).toContain('family/forms');expect(workspaceGroups('practitioner')).toEqual([]);
});
for(const locale of ['en','he'] as const)it(`${locale}: shared reports require a real adult session and keep bounded login context`,async()=>{
 const caseId='123e4567-e89b-12d3-a456-426614174000',audienceId='223e4567-e89b-12d3-a456-426614174000';
 const props={params:Promise.resolve({locale}),searchParams:Promise.resolve({caseId,audienceId,role:'practitioner',section:'history'})};
 for(const code of ['FORBIDDEN','NOT_FOUND'] as const){roleCheck.mockRejectedValueOnce(new AppError(code));expect((await ClientReportsPage(props)).type).toBe(ClientAccessDenied);expect(roleCheck).toHaveBeenLastCalledWith(['adult_client']);}
 roleCheck.mockRejectedValueOnce(new AppError('UNAUTHENTICATED'));
 const next=`/${locale}/client/reports?caseId=${caseId}&audienceId=${audienceId}`;
 await expect(ClientReportsPage(props)).rejects.toThrow('REDIRECT '+`/${locale}/login?next=${encodeURIComponent(next)}`);
 const unavailable=new AppError('UNAVAILABLE');roleCheck.mockRejectedValueOnce(unavailable);await expect(ClientReportsPage(props)).rejects.toBe(unavailable);
 roleCheck.mockResolvedValueOnce({role:'adult_client'});const allowed=await ClientReportsPage(props);
 expect(allowed.type).toBe(ReportsPage);expect(allowed.props).toEqual({locale,role:'adult_client',caseId,audienceId});
 expect(breadcrumbItems(locale,'client',`/${locale}/client/reports`).at(-1)?.label).toBe(locale==='he'?'דוחות משותפים':'Shared reports');
});
for(const [name,page] of [['forms',ClientFormsPage],['resources',ClientResourcesPage]] as const)it(`${name}: rechecks the adult role and renders no adult workspace on a denial; an outage still throws`,async()=>{
 const props={params:Promise.resolve({locale:'en'}),searchParams:Promise.resolve({caseId:'123e4567-e89b-12d3-a456-426614174000'})};
 roleCheck.mockReset();roleCheck.mockRejectedValueOnce(new AppError('FORBIDDEN'));
 const denied=await page(props);expect(roleCheck).toHaveBeenLastCalledWith(['adult_client']);expect(denied.type).toBe(ClientAccessDenied);expect(denied.props).toEqual({locale:'en'});
 const unavailable=new AppError('UNAVAILABLE');roleCheck.mockRejectedValueOnce(unavailable);await expect(page(props)).rejects.toBe(unavailable);
 roleCheck.mockResolvedValueOnce({role:'adult_client'});const allowed=await page(props);expect(allowed.type).toBe(SharedItemsWorkspace);expect(allowed.props).toMatchObject({locale:'en',role:'adult_client',mode:name,initialCaseId:'123e4567-e89b-12d3-a456-426614174000'});
});
