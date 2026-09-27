import { expect, it } from 'vitest';
import { crmDueCivilDate } from '../../../src/features/prospects/due-date.ts';

it('normalizes only valid ISO and en_US formatted CRM follow-up dates', () => {
  expect(crmDueCivilDate('2026-09-27')).toBe('2026-09-27');
  expect(crmDueCivilDate('9/27/2026')).toBe('2026-09-27');
  expect(crmDueCivilDate(' 09/07/2026 ')).toBe('2026-09-07');
  for (const value of ['', '27/9/2026', '2/30/2026', '2026-02-30', '9/27/26', '45922', '2026-09-27T00:00:00Z'])
    expect(crmDueCivilDate(value)).toBeNull();
});
