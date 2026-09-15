import { AsyncLocalStorage } from 'node:async_hooks';
import type { IdentityStore, SqlSession } from '../identity/store.ts';
import type { FirstSessionOrder, ReceiptAllocation, ReceiptStore, StoredReceipt } from '../payments/provider-types.ts';

/** Internal server store. The caller must bind a trusted workspace/account, never request-body values. */
export class SqlReceiptStore implements ReceiptStore {
  private readonly sessions = new AsyncLocalStorage<SqlSession>();
  private readonly database: IdentityStore;
  private readonly workspaceId: string;
  private readonly accountId: string;
  constructor(database: IdentityStore, workspaceId: string, accountId: string) {
    if (!workspaceId || !accountId) throw new Error('missing_provider_binding');
    this.database = database; this.workspaceId = workspaceId; this.accountId = accountId;
  }
  private tx(): SqlSession {
    const tx = this.sessions.getStore();
    if (!tx) throw new Error('receipt_transaction_required');
    return tx;
  }
  async withReceiptLock<T>(_eventKey: string, work: () => Promise<T>): Promise<T> {
    if (this.sessions.getStore()) throw new Error('nested_receipt_transaction');
    return this.database.transaction(async tx => {
      // One database row lock covers different event IDs, payments and sibling orders,
      // including separate receiver processes. A process-local Map is insufficient.
      const rows = await tx.query('SELECT id FROM ls_identity.workspaces WHERE id=$1 FOR UPDATE', [this.workspaceId]);
      if (rows.length !== 1) throw new Error('unknown_workspace');
      return this.sessions.run(tx, work);
    });
  }
  async findByEventKey(eventKey: string): Promise<StoredReceipt | undefined> {
    const rows = await this.tx().query<{receiptId:string;event:StoredReceipt['event'];receivedAt:Date|string;state:StoredReceipt['state'];allocations:ReceiptAllocation[]}>(
      'SELECT receipt_id AS "receiptId",event_json AS event,received_at AS "receivedAt",state,allocations_json AS allocations FROM ls_onboarding.provider_receipts WHERE workspace_id=$1 AND provider_account_id=$2 AND event_key=$3',
      [this.workspaceId,this.accountId,eventKey]);
    const row=rows[0]; return row ? {...row,receivedAt:new Date(row.receivedAt).toISOString()} : undefined;
  }
  async save(receipt: StoredReceipt): Promise<void> {
    if (receipt.event.providerAccountId!==this.accountId) throw new Error('wrong_provider_account');
    const rows=await this.tx().query(`INSERT INTO ls_onboarding.provider_receipts
      (workspace_id,provider_account_id,event_key,receipt_id,raw_digest,received_at,event_json,state,allocations_json)
      VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb)
      ON CONFLICT(workspace_id,provider_account_id,event_key) DO UPDATE
      SET state=EXCLUDED.state,allocations_json=EXCLUDED.allocations_json
      WHERE ls_onboarding.provider_receipts.raw_digest=EXCLUDED.raw_digest RETURNING event_key`,
      [this.workspaceId,this.accountId,receipt.event.eventKey,receipt.receiptId,receipt.event.rawDigest,receipt.receivedAt,JSON.stringify(receipt.event),receipt.state,JSON.stringify(receipt.allocations)]);
    if(rows.length!==1) throw new Error('event_identity_conflict');
  }
  async findOrder(orderId:string):Promise<FirstSessionOrder|undefined>{
    return (await this.tx().query<FirstSessionOrder>('SELECT order_id AS "orderId",case_id AS "caseId",child_id AS "childId",amount_minor AS "amountMinor",currency,purpose FROM ls_onboarding.first_session_orders WHERE workspace_id=$1 AND order_id=$2',[this.workspaceId,orderId]))[0];
  }
  async findAllocation(transactionId:string):Promise<ReceiptAllocation|undefined>{
    return (await this.tx().query<ReceiptAllocation>('SELECT transaction_id AS "transactionId",order_id AS "orderId",child_id AS "childId",amount_minor AS "amountMinor" FROM ls_onboarding.payment_allocations WHERE workspace_id=$1 AND provider_account_id=$2 AND transaction_id=$3',[this.workspaceId,this.accountId,transactionId]))[0];
  }
  async findOrderAllocation(orderId:string):Promise<ReceiptAllocation|undefined>{
    const row=(await this.tx().query<ReceiptAllocation & {accountId:string}>('SELECT provider_account_id AS "accountId",transaction_id AS "transactionId",order_id AS "orderId",child_id AS "childId",amount_minor AS "amountMinor" FROM ls_onboarding.payment_allocations WHERE workspace_id=$1 AND order_id=$2',[this.workspaceId,orderId]))[0];
    if(row && row.accountId!==this.accountId) throw new Error('other_provider_account_requires_review');
    if(!row) return undefined;
    const {accountId,...allocation}=row; return allocation;
  }
  async saveAllocation(a:ReceiptAllocation):Promise<void>{
    const rows=await this.tx().query(`INSERT INTO ls_onboarding.payment_allocations(workspace_id,provider_account_id,transaction_id,order_id,child_id,amount_minor)
      SELECT $1,$2,$3,order_id,child_id,amount_minor FROM ls_onboarding.first_session_orders
      WHERE workspace_id=$1 AND order_id=$4 AND child_id=$5 AND amount_minor=$6 AND currency='ILS' AND purpose='first_session'
      ON CONFLICT DO NOTHING RETURNING transaction_id`,[this.workspaceId,this.accountId,a.transactionId,a.orderId,a.childId,a.amountMinor]);
    if(rows.length!==1) throw new Error('allocation_conflict');
  }
  async recordRefund(transactionId:string):Promise<void>{
    await this.tx().query('INSERT INTO ls_onboarding.payment_reversals(workspace_id,provider_account_id,transaction_id) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',[this.workspaceId,this.accountId,transactionId]);
  }
  async hasRefundedTransaction(transactionId:string):Promise<boolean>{
    return (await this.tx().query('SELECT transaction_id FROM ls_onboarding.payment_reversals WHERE workspace_id=$1 AND provider_account_id=$2 AND transaction_id=$3',[this.workspaceId,this.accountId,transactionId])).length>0;
  }
  async recordStaffAllocationAudit(input:{eventKey:string;transactionId:string;orderId:string;actorId:string;auditRecordId:string}):Promise<void>{
    await this.tx().query('INSERT INTO ls_onboarding.staff_allocation_audits(workspace_id,provider_account_id,event_key,transaction_id,order_id,actor_id,audit_record_id) VALUES($1,$2,$3,$4,$5,$6,$7)',[this.workspaceId,this.accountId,input.eventKey,input.transactionId,input.orderId,input.actorId,input.auditRecordId]);
  }
}
