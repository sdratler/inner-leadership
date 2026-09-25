import { describe, expect, it } from 'vitest';
import { readPractitionerCalendar } from '../../../src/features/calendar/practitioner-load.ts';

describe('practitioner calendar source isolation', () => {
  const page = { items: [{ id: 'synthetic-appointment' }], nextCursor: null };

  it('shows authorized appointments when the client directory is unavailable', async () => {
    const result = await readPractitionerCalendar(
      async () => { throw new Error('CRM unavailable'); },
      async () => page,
    );
    expect(result).toEqual({ cases: [], casesUnavailable: true, page });
  });

  it('keeps a legitimately empty client list distinct from an unavailable one', async () => {
    const result = await readPractitionerCalendar(async () => [], async () => page);
    expect(result).toEqual({ cases: [], casesUnavailable: false, page });
  });

  it('never disguises a failed appointment read as an empty calendar', async () => {
    await expect(readPractitionerCalendar(async () => [], async () => { throw new Error('Calendar unavailable'); }))
      .rejects.toThrow('CALENDAR_UNAVAILABLE');
  });
});
