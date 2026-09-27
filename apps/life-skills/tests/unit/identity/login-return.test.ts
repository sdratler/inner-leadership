import { expect, it } from 'vitest';
import { practitionerReturnPath } from '../../../src/features/identity/login-return.ts';

it('preserves only a bounded legacy lead ID on a practitioner People return link', () => {
  expect(practitionerReturnPath('he', 'clients', { section: 'prospects', leadId: 'LS-LEAD-synthetic-one' }))
    .toBe('/he/app/clients?section=prospects&leadId=LS-LEAD-synthetic-one');
  expect(practitionerReturnPath('en', 'clients', { leadId: 'javascript:alert(1)' }))
    .toBe('/en/app/clients');
});
