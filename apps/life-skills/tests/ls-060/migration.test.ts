import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';
const sql=readFileSync(new URL('../../migrations/0060_ls_manual_payments_credits_20260911.sql',import.meta.url),'utf8');
describe('LS-060 migration contract',()=>{
 it.each(['charges','payments','allocations','credit_blocks','credit_events','refunds','calendar_receipts','commands'])('creates append-aware %s storage',table=>expect(sql).toContain(`ls_payments.${table}`));
 it('pins four credits, ₪2,200, ₪550 and Product2.3 in constraints',()=>{expect(sql).toContain('credits_purchased=4');expect(sql).toContain('purchase_amount_minor=220000');expect(sql).toContain('value_minor=-55000');expect(sql).toContain("terms_version='Product2.3'");});
 it('has database guards against over-allocation and negative credit debt',()=>{expect(sql).toContain('invalid_allocation');expect(sql).toContain('invalid_credit_balance');expect(sql).toContain('current_balance+NEW.delta_credits<0');});
 it('makes credit events, receipts, payments and commands immutable',()=>{expect(sql).toContain('credit_event_immutable');expect(sql).toContain('calendar_receipt_immutable');expect(sql).toContain('payment_immutable');expect(sql).toContain('payment_command_immutable');});
 it('depends on calendar identifiers without modifying calendar tables',()=>{expect(sql).toContain('REFERENCES ls_calendar.appointments');expect(sql).toContain('REFERENCES ls_calendar.notices');expect(sql).not.toMatch(/(?:INSERT INTO|UPDATE|DELETE FROM|ALTER TABLE)\s+ls_(?:calendar|attendance)\./i);});
});
