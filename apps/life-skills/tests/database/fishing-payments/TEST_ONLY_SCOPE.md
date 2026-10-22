# Control824 / Change838 — test-only follow-up to accepted ce9

Base: ce9a623efa5f84283bd479c031f60e961a6603fc. All nine production
fishing-payments source/doc/SQL files and shared contract remain unchanged.
Existing lifecycle.native.test.ts retains its complete19 bodies byte-for-byte
(SHA25658310870cec5903d20e9695ce24b66d9390b638bddaebf9c37f10d80214144c3).
The existing database fixture and unit fixture are unchanged. Closed P2 stays
closed; this is not a production correction or a second billing implementation.

## MAIN-owned native execution list

- tests/database/fishing-payments/process-recovery.native.test.ts: two cases,
  hosted invoice and approved refund UNKNOWN recovery across a separate Node
  process, using current native Actor/session and production store/service/binder.
- tests/database/fishing-payments/temporal-dues.native.test.ts: two parameterized
  cases, explicit January/February/March month-end plus spring DST, and explicit
  October/November/December month-end plus fall DST, followed by the fourth date.

No helper DDL/native execution is authorized or performed. MAIN uses its existing
805 fresh loopback PostgreSQL recipe, unchanged pinned candidate SQL38a77b1f...,
exact61-byte ls_calendar_test_rm_pay_<32hex>_test namespace, source/runner guards
and final server stop. New files are authored/type-checked/linted until MAIN runs
them. The old19 native acceptance and earlier failed fixtures remain distinct.

## Separate-process scope

The parent first creates a real native operation and unique dispatch fence, with
the synthetic merchant losing its response after recording the simulated effect.
An actual new Node process has a different PID and fresh JS memory. It retries
both the original native command and a new command against that same native
operation through FishingPaymentService. Its synthetic provider.create must not
run. A mismatched readback must fail; explicit matching readback must confirm the
operation. Native paid/refunded amounts must remain unchanged until the parent
ingests a verified synthetic signed receipt through the actual inbox/service.

Only NODE_ENV=test and defined SystemRoot/WINDIR/TEMP/TMP values enter the child
environment. DSN, temporary password, Actor/session digest and exact synthetic
proof/readback travel only on stdin. No shell, argv secret, inherited provider
credential, raw stderr echo or network provider exists. windowsHide, output/input
bounds, query/connection deadlines, pool.end and bounded process termination are
explicit. The child verifies actual database/host/port before service work and
uses current native session checks; fixture proof ports remain explicitly
synthetic, narrowly tied to the same offer/household actors and learner.

## Temporal scope and positive controls

The explicit dates are synthetic accepted agreements, not a new due-date policy.
Only the injected application Clock advances. Each later due and fourth boundary
uses a new independent native session on the same active account. Production
freshActor supplies a positive successful read before the tested action. The old
revoked/expired session is a separate negative control, never the reason a fourth
due is considered rejected. Earlier dues must actually have verified synthetic
settlements; later65,000-cent dues must still succeed after offer expiry. At the
fourth date, the active parent can read the paid195,000 purchase but cannot create
a nonexistent fourth due or recollect a paid one. Native invoice-operation count
and synthetic create-call count remain three; no new purchase/renewal is created.

Passing these cases establishes only the exact native service/Clock and process
boundaries tested. It does NOT establish an actual scheduled job, deployed
session issuance/login, real guardian/capacity integration, provider-side hosted
link expiry, Stripe sandbox/test-clock behavior, merchant acceptance, bank
settlement, enrollment, live funds or notifications. If the current frozen
production code fails, preserve RED and return a private proposal to MAIN;
do not alter production, pricing, schema, assertions or authentication to pass.
