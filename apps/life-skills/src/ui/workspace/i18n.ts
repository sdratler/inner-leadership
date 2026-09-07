import { instant,formatInstant as foundationFormatInstant } from '../../lib/time.ts';
import messages from './messages.json';
import type { Locale } from '../../lib/locale.ts';
export type MessageKey = keyof typeof messages.en;
export function uiCopy(locale: Locale) { return messages[locale]; }
export function formatInstant(value: string, locale: Locale): string {
  return foundationFormatInstant(instant(value),locale);
}
export function formatCount(value: number, locale: Locale): string {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError('Nonnegative integer required');
  return new Intl.NumberFormat(locale === 'he' ? 'he-IL' : 'en-IL').format(value);
}
