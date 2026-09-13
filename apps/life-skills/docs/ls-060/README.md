# LS-060 manual payments and appointment credits

This feature implements the Product 2.3 child-payment contract in integer ILS minor units: ₪550 per individual child appointment and a manually created, prepaid four-credit block at ₪2,200. Charges carry an explicit administrative due date; cash/bank-transfer payments and allocations are separate durable records, with outstanding and unallocated balances derived from allocations. A block becomes usable only after its exact charge is fully allocated; nothing creates a renewal, twelve-session debt, card transaction or provider call.

Credit balance is derived exclusively from append-only `purchase`, `consume`, `restore` and `refund` events. Purchase adds four. An attended individual appointment, no-show or notice received less than 24 elapsed hours before the original start consumes one, unless LS-030 records a practitioner exception. Timely notice records a durable preservation receipt without a balance mutation. A later exception restores only the block previously consumed. Joint-parent check-ins never consume a second credit. Refund adjustments are explicit, practitioner-only, bounded by the remaining block balance and recorded with an encrypted administrative reason.

## Calendar boundary

`applyCalendarCreditEffect` consumes only LS-030's frozen `CreditEffectReference` from the database-only calendar relay. It verifies event and appointment identity, case, terms version, current calendar facts and a durable digest before changing credits. It never edits attendance, notices, exceptions or appointments. Delivery retries are idempotent. A collision or insufficient credit fails closed and leaves the calendar event pending for operator review.

## Access and privacy

The API rechecks the server session and current case membership on every operation. Parents may read their authorized minor-case payment history and balance. Only the owning practitioner may create charges, record payments, allocate them or post refund adjustments. Private references and refund reasons are encrypted at rest and excluded from all read models. Tests and packet evidence contain synthetic identifiers only.

## Integration requests

1. Install LS-030 migration `0030` before `0060`.
2. Add `0060_ls_manual_payments_credits_20260911.sql` to the shared migration manifest through the centralized integrator.
3. Wire `applyCalendarCreditEffect` into LS-030 `drainCalendarEvents(..., 'credit_effect', ...)` inside the shared database transaction. Do not add a second scheduler.
4. Enable `LS_PAYMENTS_ENABLED=true` only in an approved private-app environment with the existing identity configuration.
5. Add navigation only through the shared LS-070 composition lane.
6. Run migration/database and authenticated browser tests in an approved ephemeral environment before merge. Shared database migration, main merge, deployment and any provider action retain separate approvals.
