/** Explicit server-side safety bounds, shared by CRM reads and task consumers.
 * Exceeding them is an unavailable result, never a truncated successful sync. */
export const MAX_NATIVE_CONTACTS=10000;
export const MAX_OPERATIONAL_PROSPECTS=10000;
/** Calendar also contains practitioner-created tasks. Reserve a full additional
 * directory-sized capacity; CRM reconciliation must not consume their space. */
export const MAX_CALENDAR_TASKS=MAX_OPERATIONAL_PROSPECTS*2;
