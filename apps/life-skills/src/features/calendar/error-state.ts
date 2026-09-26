import { IdentityClientError } from '../identity/client.ts';
import { CalendarClientError } from './client.ts';

export type CalendarLoadFailure = 'unavailable' | 'auth' | 'forbidden';

export function calendarLoadFailure(error: unknown): CalendarLoadFailure {
 const code = error instanceof CalendarClientError || error instanceof IdentityClientError ? error.code : null;
 return code === 'UNAUTHENTICATED' ? 'auth' : code === 'FORBIDDEN' ? 'forbidden' : 'unavailable';
}
