import { describe, expect, it } from 'vitest';
import { CalendarClientError } from '../../../src/features/calendar/client.ts';
import { IdentityClientError } from '../../../src/features/identity/client.ts';
import { calendarLoadFailure } from '../../../src/features/calendar/error-state.ts';

describe('calendar read error state', () => {
 it('directs expired sessions to login and denied roles to an access error', () => {
  expect(calendarLoadFailure(new CalendarClientError('UNAUTHENTICATED'))).toBe('auth');
  expect(calendarLoadFailure(new IdentityClientError('UNAUTHENTICATED'))).toBe('auth');
  expect(calendarLoadFailure(new CalendarClientError('FORBIDDEN'))).toBe('forbidden');
 });
 it('keeps actual data failures retryable', () => {
  expect(calendarLoadFailure(new CalendarClientError('UNAVAILABLE'))).toBe('unavailable');
  expect(calendarLoadFailure(new Error('synthetic network outage'))).toBe('unavailable');
 });
});
