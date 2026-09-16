export const CRM_FIELD_MAP_VERSION = 'ls-crm-admin-v1' as const;

export const CRM_ADMIN_FIELDS = [
  'Form sent',
  'Form submitted',
  'Payment link sent',
  'Payment method',
  'Payment status',
  'Payment allocation',
  'Booking status',
  'Message receipt',
  'Update provenance',
] as const;

export type CrmAdminField = typeof CRM_ADMIN_FIELDS[number];
export type StableLeadId = `LS-LEAD-${string}` | `LS-WAPI-${string}`;

export function parseStableLeadId(value: unknown): StableLeadId {
  if (typeof value !== 'string' || !/^LS-(?:LEAD|WAPI)-[A-Z0-9-]+$/.test(value)) throw new Error('stable_lead_id_required');
  return value as StableLeadId;
}

export function resolveCrmHeaders(headers: readonly string[]): Readonly<Record<CrmAdminField, number>> {
  const resolved = {} as Record<CrmAdminField, number>;
  for (const field of CRM_ADMIN_FIELDS) {
    const matches = headers.map((header, index) => ({ header: header.trim(), index })).filter(entry => entry.header === field);
    if (matches.length === 0) throw new Error(`missing_crm_header:${field}`);
    if (matches.length > 1) throw new Error(`ambiguous_crm_header:${field}`);
    resolved[field] = matches[0]!.index;
  }
  return resolved;
}

export function assertOwnedCrmFields(changes: Record<string, string>): asserts changes is Record<CrmAdminField, string> {
  for (const field of Object.keys(changes)) if (!(CRM_ADMIN_FIELDS as readonly string[]).includes(field)) throw new Error('unowned_crm_field');
}

/** Returns only owned cells; callers must merge this patch without replacing notes or private columns. */
export function buildAdministrativePatch(leadId: unknown, changes: Record<string, string>) {
  const stableLeadId = parseStableLeadId(leadId);
  assertOwnedCrmFields(changes);
  return { leadId: stableLeadId, fieldMapVersion: CRM_FIELD_MAP_VERSION, fields: { ...changes } };
}

