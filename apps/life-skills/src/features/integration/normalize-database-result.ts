const POSTGRES_TIMESTAMPTZ_OID = 1184;

export interface DatabaseField {
  readonly name: string;
  readonly dataTypeID: number;
}

export function normalizeDatabaseRows(
  rows: readonly Record<string, unknown>[],
  fields: readonly DatabaseField[],
): Record<string, unknown>[] {
  const timestampFields = fields.filter(field => field.dataTypeID === POSTGRES_TIMESTAMPTZ_OID).map(field => field.name);
  if (timestampFields.length === 0) return rows.map(row => ({ ...row }));
  return rows.map(row => {
    const normalized = { ...row };
    for (const name of timestampFields) {
      const value = normalized[name];
      if (value === null || value instanceof Date) continue;
      if (typeof value !== "string") throw new Error("DATABASE_TIMESTAMP_INVALID");
      const timestamp = new Date(value);
      if (!Number.isFinite(timestamp.valueOf())) throw new Error("DATABASE_TIMESTAMP_INVALID");
      normalized[name] = timestamp;
    }
    return normalized;
  });
}
