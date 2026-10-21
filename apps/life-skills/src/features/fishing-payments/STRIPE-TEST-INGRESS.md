Stripe test receipt ingress
==========================

This slice mounts `/api/webhooks/stripe/test` in the existing application. It
reuses the existing PostgreSQL database and the native `ls_fishing_payments.inbox`
key/DTO/commit protocol. It does not process payments, update balances, grant
enrollment or change Founder/campaign state. HTTP 200 means receipt commit only.

The original SDK23/endive verifier and bounded raw-byte HTTP boundary are
retained. The new minimal inbox capability extracts the same insert/digest
conflict transaction from the unreleased full payment module; it does not bring
that module's offer, processing or money capabilities into the website release.

Server composition requires all of:

* Exact gate origin/path and `isolated_preview`, with both test gates enabled.
* `LS_STRIPE_TEST_API_KEY`, a protected test credential. Two guarded GETs verify
  the selected `LS_STRIPE_TEST_ACCOUNT_ID` and actual balance `livemode=false`.
  Live keys, other accounts, redirects, non-GET operations and retries are denied.
* `LS_STRIPE_TEST_WEBHOOK_SECRET`, the destination-specific signing secret.
* `LS_STRIPE_TEST_DATABASE_URL`, a separate restricted connection to the existing
  database using `ls_stripe_test_receiver`, with the existing verified TLS CA.
* `LS_STRIPE_TEST_ADMISSION_ID`, a server/operator receipt reference. This marker
  alone is insufficient: actual provider and database checks must succeed.

The DB loader rejects superuser/CREATEROLE/CREATEDB/BYPASSRLS/membership, schema
creation, receipt UPDATE/DELETE and access to core identity/payment/calendar/
control schemas. It checks the native inbox columns, composite primary key,
schema version, forced row security and the exact test merchant policy. Ingress
gets only schema USAGE plus inbox SELECT/INSERT. It cannot receive an Actor or
claim a paid family.

`stripe-test-inbox.sql` is the exact scoped installation input. It is deliberately
separate from the broad migrator: this deployment does not apply the outstanding
132–134 migrations or alter/relabel the general migration ledger. The installer
must assert the exact existing Railway app/database, source hash and schema
absence, apply only this storage plus the merchant-bound receiver role/policy in
one transaction, and return a minimal receipt. Future full payment-schema
adoption must verify and retain this existing inbox rather than blindly CREATE
it or discard its records. No general schema-completion claim is made.

Secrets are installed only in the exact existing Railway service's protected
configuration. No key, password, connection string, signature or raw provider
event belongs in source, logs, receipts or chat. Gate flags stay off until the
account, role/schema and signing secret are verified. The exact public URL may
be returned as working only after HTTPS/provider delivery and durable readback.

Tests: retained transport/signature/gate cases, guarded account-verifier cases,
unchanged proxy regression cases, the nine-case restricted Postgres receipt
suite, and five exact-operator/full-loader cases using real local verified TLS.
These prove catalog text-array decoding, exact merchant policy checks, signed
receipt commit/replay and refusal to repair an existing schema. Local fixture
redirection of the private database hostname is explicit; it is not a Railway
or external provider delivery proof. The first native file is opt-in via `LS_STRIPE_INBOX_NATIVE_ALLOW=PAY_SCOPED`
and an exact disposable loopback target. Local synthetic passes are separate
from real Stripe sandbox delivery and from later native balance allocation.
The loader suite additionally requires `LS_STRIPE_LOADER_NATIVE_ALLOW=PAY_SCOPED`,
an owned local TLS fixture and the exact reviewed private operator source.
