/** Public connection metadata only. No credential, native principal or grant. */
export const TRIP_SITE_ID = 'appgprj_6b08bf93c85881919b92b2b1a9aa80a8';
export const TRIP_SITE_COMMAND_TYPES = ['departure.save', 'waitlist.save', 'departure.attendance'] as const;
export const TRIP_SITE_CALLER_PATTERN = /^site_[A-Za-z0-9_-]{43}$/;
export function isTripSiteCaller(value: unknown): value is string { return typeof value === 'string' && TRIP_SITE_CALLER_PATTERN.test(value); }
export function tripSiteCallerFromHash(hash:string):string|null {
  if(!hash.startsWith('#'))return null;
  const values=new URLSearchParams(hash.slice(1)),caller=values.get('chatCaller');
  return [...values.keys()].length===1&&isTripSiteCaller(caller)?caller:null;
}
export function tripSiteOwnerLoginHref(locale: 'en' | 'he', caller: string | null): string {
  const query = new URLSearchParams({ next: `/${locale}/trips/owner` });
  if (isTripSiteCaller(caller)) query.set('chatCaller', caller);
  return `/${locale}/login?${query}`;
}
export function tripSiteOwnerReturn(locale: 'en' | 'he', role: string, destination: string | null, caller: unknown): string | null {
  return role === 'practitioner' && destination === `/${locale}/trips/owner` && isTripSiteCaller(caller)
    ? destination + '#chatCaller=' + caller : destination;
}
