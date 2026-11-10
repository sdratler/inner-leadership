import { afterEach, expect, it, vi } from 'vitest';
import { formatFloridaLocalTime, resolveFloridaLocalTime } from '../../src/features/fishing-billing/florida-local-time.ts';
afterEach(() => vi.unstubAllEnvs());
it.each([
  ['2026-01-11T13:30', '2026-01-11T18:30:00.000Z'],
  ['2026-07-12T13:30', '2026-07-12T17:30:00.000Z'],
  ['2026-07-12T13:30:37.125', '2026-07-12T17:30:37.125Z'],
])('Florida owner input %s preserves its actual local time and precision', (local, instant) => {
  expect(resolveFloridaLocalTime(local)).toEqual({ state: 'ready', instant }); expect(formatFloridaLocalTime(instant)).toBe(local);
});
it('requires explicit correction for nonexistent or ambiguous Florida DST wall times', () => {
  expect(resolveFloridaLocalTime('2026-03-08T02:30')).toEqual({ state: 'nonexistent' });
  expect(resolveFloridaLocalTime('2026-11-01T01:30')).toEqual({ state: 'ambiguous' });
});
it('rejects malformed dates and calendar rollover rather than silently moving the lesson', () => {
  for (const value of ['', '2026-02-29T13:30', '2026-04-31T13:30', '2026-01-01T24:00', '0000-01-01T13:30', '2026-01-01T13:30Z', '2026-01-01T13:30:00.0001']) expect(resolveFloridaLocalTime(value)).toEqual({ state: 'invalid' });
  expect(resolveFloridaLocalTime('2028-02-29T13:30')).toEqual({ state: 'ready', instant: '2028-02-29T18:30:00.000Z' });
  expect(() => formatFloridaLocalTime('2026-01-01T13:30')).toThrow('INVALID_SAVED_INSTANT');
  expect(() => formatFloridaLocalTime('2026-02-30T13:30:00Z')).toThrow('INVALID_SAVED_INSTANT');
});
it('uses Florida date and time regardless of the host timezone', () => {
  for (const zone of ['Asia/Jerusalem', 'Pacific/Honolulu']) {
    vi.stubEnv('TZ', zone); expect(resolveFloridaLocalTime('2026-07-12T13:30')).toEqual({ state: 'ready', instant: '2026-07-12T17:30:00.000Z' });
    expect(formatFloridaLocalTime('2026-07-13T01:30:00Z')).toBe('2026-07-12T21:30');
  }
});
