import { expect, it } from 'vitest';
import { practitionerReturnPath } from '../../../src/features/identity/login-return.ts';

it('preserves only a bounded legacy lead ID on a practitioner People return link', () => {
  expect(practitionerReturnPath('he', 'clients', { section: 'prospects', leadId: 'LS-LEAD-synthetic-one' }))
    .toBe('/he/app/clients?section=prospects&leadId=LS-LEAD-synthetic-one');
  expect(practitionerReturnPath('en', 'clients', { leadId: 'javascript:alert(1)' }))
    .toBe('/en/app/clients');
});
it('preserves an exact practitioner demo Calendar destination, not repeated or invalid mode',()=>{
 expect(practitionerReturnPath('he','calendar',{date:'2026-09-28',view:'month',mode:'demo'})).toBe('/he/app/calendar?date=2026-09-28&view=month&mode=demo');
 expect(practitionerReturnPath('en','calendar',{mode:['demo','live']})).toBe('/en/app/calendar');
 expect(practitionerReturnPath('en','calendar',{mode:'all'})).toBe('/en/app/calendar');
});
