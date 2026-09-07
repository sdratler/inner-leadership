/** Fixed SQL statements and parameters only. Do not interpolate request values into SQL text. */
export interface SqlSession {
  query<T extends object = Record<string, unknown>>(statement: string, values?: readonly unknown[]): Promise<T[]>;
}
export interface IdentityStore {
  transaction<T>(work: (tx: SqlSession) => Promise<T>): Promise<T>;
}
export async function one<T extends object>(tx: SqlSession, statement: string, values: readonly unknown[] = []): Promise<T | null> {
  const rows = await tx.query<T>(statement, values);
  if (rows.length > 1) throw new Error("IDENTITY_CARDINALITY_ERROR");
  return rows[0] ?? null;
}
