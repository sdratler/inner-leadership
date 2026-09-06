import type { Locale } from '../../lib/locale.ts';
export type { Locale };
export type WorkspaceRole = 'parent' | 'practitioner';
export const parentDestinations = ['home','practice','feedback','schedule'] as const;
export const practitionerDestinations = ['calendar','clients','feedback','practice','forms','payments'] as const;
export type Destination = typeof parentDestinations[number] | typeof practitionerDestinations[number];
/** A presentation projection, never a permission grant or a route registry. Missing routes are visibly unavailable. */
export type Destinations = Partial<Record<Destination, string>>;
export function localHref(value: string): string {
  if (/[\\\u0000-\u0020\u007f]/.test(value) || /%0[ad]/i.test(value) || value.startsWith('//') || !(value.startsWith('/') || /^#[A-Za-z][\w-]*$/.test(value))) throw new TypeError('Local navigation target required');
  return value;
}
export function tabStep(index: number, key: string, length: number, rtl: boolean): number {
  if (!Number.isInteger(length) || length < 1 || index < 0 || index >= length) throw new RangeError('Invalid tab state');
  if (key === 'Home') return 0;
  if (key === 'End') return length-1;
  if (key === 'ArrowRight') return (index+(rtl ? -1 : 1)+length)%length;
  if (key === 'ArrowLeft') return (index+(rtl ? 1 : -1)+length)%length;
  return index;
}
export function isTimeOfDay(value: string): boolean { return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value); }
export interface PageSlice<T> { items: readonly T[]; page: number; totalPages: number; previousHref?:string|undefined; nextHref?: string }
export function checkedPage<T>(page: PageSlice<T>): PageSlice<T> {
  if (page.items.length > 50 || !Number.isInteger(page.page) || !Number.isInteger(page.totalPages) || page.page<1 || page.totalPages<1 || page.page>page.totalPages) throw new RangeError('Page must contain at most 50 items and valid bounds');
  return page;
}
/** Selection validation is for form usability only. The domain must reauthorize every mutation. */
export function validParentSelection(selected: readonly string[], available: readonly string[]): boolean {
  return selected.length>0 && new Set(selected).size===selected.length && selected.every(id=>available.includes(id));
}
