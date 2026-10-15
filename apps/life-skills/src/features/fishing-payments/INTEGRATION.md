# RM11 payment candidate — isolated, unmounted

Base cbc1dd9c581cae6773e6eb46326462bab2fbfbae. Frozen MAIN seam is
rm-fishing-contract-v1 / Git blob a3b957f87d941305b3a43214bc2c26a0de618998.
Intent: RM11 assigned01/02/04/08, Florida -10/-09/-08. USD only. No old ILS writes.

## MAIN integration requests

1. Register/review the unnumbered candidate-schema.sql separately. Helper does
   not apply DDL. All native queries use the existing IdentityStore, SqlSession,
   freshActor, parameter binder and driver normalization. The native test file
   requires an already-migrated fresh loopback database named exactly
   ls_calendar_test_rm_pay_<32hex>_test and refuses any other target.
2. Supply FishingAuthority from ports.ts: loadApprovedOffer returns the actual
   immutable server-owned offer, not request JSON; authorize reloads current
   guardian/payer/household relationships, capacity, operator/terms/policy proof
   in the provided transaction. Withdrawal facts use actual attendance, current
   reviewed terms and version. Reminder policy supplies approved timing, consent,
   parent destination, quiet state and current Content Voice copy revision.
   Missing proofs must deny/unavailable. Test fixtures are explicitly synthetic.
3. Mount existing ordinary authenticated family/operator routes, origin/CSRF,
   body/rate limits and session resolution. Browser commands contain opaque
   offer/purchase/due/operation IDs and command keys, never price or authority.
   Translate internal validation failures to safe existing HTTP error codes.
   Operator-only readPayment returns the frozen server DTO; familyView and
   familyHostedAction whitelist public family fields. Recheck on every read.
4. Provider execution is SYNTHETIC ONLY. No real/sandbox HTTP transport, SDK,
   environment reader, Stripe credentials, schedule, debit or message sender is
   supplied or admitted. A separately reviewed real adapter must use pinned SDK
   signature verification and verified intended merchant+mode+API version,
   per-offer/finite-due hosted invoices, correct object-chain readback and signed
   webhooks. It must enforce provider-side expiry/stale-link closure, not only UI
   hiding. No open-ended subscription. Future obligations are native indices1..3;
   MAIN's admitted existing job mechanism controls agreed due times.
5. Wire verified native receipt intake to an ordinary HTTPS raw-body endpoint
   only after separate activation. acceptSynthetic is an offline-test verifier,
   not a production replacement for Stripe SDK. Durable receipt commit precedes
   its200 return. Processing reads the provider outside transactions; driver
   returns current reconciled object-chain facts, not raw snapshot/status guesses.
   Use processSynthetic only in tests. Unmatched/failed readbacks leave inbox
   pending. No log contains raw bodies, contact details or keys.

## Financial invariants and open policies

Each immutable child line has one1750/1650/1550/1650 prepay or exactly3x650,
USD cents. Founder price only at stage1. Each next stage needs new approved
purchase. Typed Quote is never price authority. Same canonical transaction is
unique across Checkout/Intent/Invoice events; same event changed bytes conflicts.
Unknown operations survive reconstructing the app and cannot create again;
provider readback, not a new idempotency key, resolves them. A unique dispatch
outbox record fences concurrent create. Actual refund money is separate from
approval and provider operation outcome; original debt is never resurrected.

Founder campaigns require explicit approved policy/qualifying event. The row
lock counts reserved+claimed households, not children. Independent capacity
proof is MAIN-owned. Cancellation reuse, hold release, late sibling deadlines
and disputed founder state remain operator-policy gates; no automatic expiry or
slot recycling is implemented. Unknown3+ attended/installation exit and multi-
child prestart fee unit return POLICY_REQUIRED. Refunds need fresh reviewed
terms, current preview and operator approval; multi-transaction refund allocation
requires review. Reminder output is always draft/suppressed and never sent.

Accounting projection is read-only: cash payment facts, gross less refunds,
original unpaid dues and measured fees are distinct. Pending processor balances,
net after disputes, earned service, remaining delivery, personal income and
scenario values remain null until their actual authorized facts/profile exist.
The projection does not mutate the existing Finance Lab engine or Money Board.
It does not certify bank settlement, forecast demand, enrollment or safety.

## Verification scope

Unit boundaries and static EN/HE family markup are separate from native tests.
Native lifecycle.native.test.ts exercises real SQL transactions, fresh sessions,
command conflicts, durable inbox, cross-event money dedupe, partial/overpaid
truth, exact three dues, unknown dispatch reconstruction, operator refund,
stale draft suppression and concurrent household20/21. Provider and relationship
proofs are isolated synthetic fixtures. Reconstruction is NOT process-restart
proof; no such claim is made. No hosted/browser/provider/live acceptance follows.
The same existing reviewer must review the exact committed candidate. MAIN owns
root UI/routes, schema integration and all real activation/release gates.
