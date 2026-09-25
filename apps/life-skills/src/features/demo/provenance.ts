import type { SqlSession } from '../identity/store.ts';
import { one } from '../identity/store.ts';

type DemoBatch = { batchId: string };

/** A display name is never proof that a record is synthetic. */
export async function demoAccountBatch(tx: SqlSession, workspaceId: string, accountId: string): Promise<string | null> {
  const row = await one<DemoBatch>(tx,
    'SELECT batch_id AS "batchId" FROM ls_demo.accounts WHERE workspace_id=$1 AND account_id=$2',
    [workspaceId, accountId]);
  return row?.batchId ?? null;
}

export async function demoCaseBatch(tx: SqlSession, workspaceId: string, caseId: string): Promise<string | null> {
  const row = await one<DemoBatch>(tx,
    'SELECT batch_id AS "batchId" FROM ls_demo.cases WHERE workspace_id=$1 AND case_id=$2',
    [workspaceId, caseId]);
  return row?.batchId ?? null;
}

/** New external-effect adapters must call this again immediately before dispatch. */
export async function realCaseEffectAllowed(tx: SqlSession, workspaceId: string, caseId: string): Promise<boolean> {
  return (await demoCaseBatch(tx, workspaceId, caseId)) === null;
}
