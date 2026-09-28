/** Explicit server-side safety bounds, shared by CRM reads and task consumers.
 * Exceeding them is an unavailable result, never a truncated successful sync. */
export const MAX_NATIVE_CONTACTS=10000;
export const MAX_OPERATIONAL_PROSPECTS=10000;
