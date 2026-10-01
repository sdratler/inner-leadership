import {expect,it,vi} from 'vitest';
vi.mock('next/navigation',()=>({useRouter:()=>({replace:vi.fn()}),useSearchParams:()=>new URLSearchParams()}));
import {eligibleFormResponders} from '../../src/features/shared-items/workspace.tsx';
import {workspaceGroups} from '../../src/ui/workspace/navigation-model.ts';
const member=(id:string,role:'parent'|'adult_client'|'child',state='active',guardianRevokedAt:string|null=null)=>({accountId:id,displayName:'Synthetic '+id,email:id+'@example.invalid',role,state,guardianRevokedAt});
it('shows only active authorized parents for minor forms and the actual adult for adult forms, never a child responder',()=>{
 const members=[member('parent','parent'),member('child','child'),member('adult','adult_client'),member('revoked','parent','active','2026-09-01'),member('invited','parent','invited')];
 expect(eligibleFormResponders('minor',members).map(m=>m.accountId)).toEqual(['parent']);expect(eligibleFormResponders('adult',members).map(m=>m.accountId)).toEqual(['adult']);
});
it('makes adult materials/forms discoverable but keeps optional child and unknown client navigation fail-closed',()=>{
 expect(workspaceGroups('client','adult_client').flatMap(g=>g.items).map(item=>item.path)).toEqual(['client/forms','client/resources']);
 expect(workspaceGroups('client','child')).toEqual([]);expect(workspaceGroups('client')).toEqual([]);
 expect(workspaceGroups('parent').flatMap(g=>g.items).map(item=>item.path)).toContain('family/forms');expect(workspaceGroups('practitioner')).toEqual([]);
});
