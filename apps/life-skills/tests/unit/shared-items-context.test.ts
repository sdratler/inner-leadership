import {expect,it,vi} from 'vitest';
vi.mock('next/navigation',()=>({useRouter:()=>({replace:vi.fn()})}));
import {SharedItemsWorkspace} from '../../src/features/shared-items/workspace.tsx';
it('remounts the authorized roster and pending form/resource state on incoming case route changes',()=>{
 const props={locale:'en' as const,role:'practitioner' as const,mode:'forms' as const};
 const first=SharedItemsWorkspace({...props,initialCaseId:'first-authorized-case'}),second=SharedItemsWorkspace({...props,initialCaseId:'second-authorized-case'});
 expect(first.key).not.toBe(second.key);expect(first.props.initialCaseId).toBe('first-authorized-case');expect(second.props.initialCaseId).toBe('second-authorized-case');
});
it('never carries loaded staff context into another role or locale',()=>{
 const initialCaseId='synthetic-context',base=SharedItemsWorkspace({locale:'en',role:'practitioner',mode:'resources',initialCaseId});
 expect(SharedItemsWorkspace({locale:'he',role:'practitioner',mode:'resources',initialCaseId}).key).not.toBe(base.key);
 expect(SharedItemsWorkspace({locale:'en',role:'parent',mode:'resources',initialCaseId}).key).not.toBe(base.key);
});
