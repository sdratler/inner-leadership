# Life Skills private application

The existing application source is isolated under `apps/life-skills`. The current implementation target is **LS-REVAMP-20260922-01** following source reconciliation **LS-SOT-20260922-01**. The audited source and owner-selected six-character password correction are merged through protected PRs 37 and 38. The canonical private preview deployment and its limits are recorded in the [September 22 execution receipt](docs/runtime/w4-revamp-20260922.md).

## Current sources and execution
Read the original [START HERE](https://docs.google.com/document/d/1XZS-MzUtjc3T488lyrSbtDX0Yq5UCl7Wzh5uN_YOvMg/edit), [Product](https://docs.google.com/document/d/1kJug8ojFwdGgZoPUx8BJt9fLKBjGYvX0wwbtarGTIIg/edit), [Architecture](https://docs.google.com/document/d/1h-bnQ94uxuTrs8BPeDg-1uwZFcQEONdmYccd9Inacgw/edit), [UI](https://docs.google.com/document/d/1KokAca2V-UhCPj1czP28TQ4i5E2Wd1JKJFbuXfmAPu4/edit) and [complete current prompt](https://docs.google.com/document/d/1r8fN36liKyXcf9GVG1Cl25Yq9vjaYWD9A0YC1h3jn-E/edit). Use the [source reconciliation](../../docs/REVAMP-20260922-SOURCE-OF-TRUTH.md) for archive identity, current version routing and scope.

Use one writer in a new isolated candidate. Compare the actual local source once and preserve later edits. Reuse the prepared React components, session/permission logic, fixture data and tests; connect real authentication, persistence and routes. Do not substitute a fixture selector or static component gallery for working parent/adult/child access.

The exact start commands and full test inventory are in the verified package's `prompts/CODEX-MASTER.txt`, with path ownership in `contracts/FILE-OWNERSHIP.json`. Use the existing supported Node/runtime and locked dependencies. Do not use an initial `npm install` or a short historical default verification script as a substitute for that inventory. Do not rerun old transfer/UI/LS070 installers.

## Source and runtime truth
The old foundation descriptions (empty registry, no account logic, one technical migration) are historical, not a current inventory. `docs/current-sources.json` retains its original frozen source fingerprints as historical evidence; do not refresh them just to suppress a checker. The audit's separate source-register file does not install a checker or certify new fingerprints.

Synthetic preview routes show only what their actual source implements. They are not client login, database acceptance, provider readiness or production access. A health response is liveness only. Keep the application closed by default unless a specific local synthetic configuration is used. Real account/session, role and case checks remain server-enforced.

## Database and provider boundaries
Use existing encryption, identity and forward-only migrations. The prepared session SQL was reconciled as migration `0093`; migrations `0090` through `0095` are registered with checksums, were validated on fresh disposable PostgreSQL 17.11 databases, and were applied to the canonical private-preview PostgreSQL service after a verified encrypted local backup. The live ledger read-back contains all 15 registered migrations through `0095`. Preserve existing migration bytes, payment/credit/attendance rules and confidential records. No `.env`, real recordings or private case data belongs in Git or test fixtures.

The existing deployment record is [`deployment/railway-target.json`](deployment/railway-target.json); historical reconciliation is [`docs/runtime/railway-reconciliation-20260914.md`](docs/runtime/railway-reconciliation-20260914.md). The record identifies the exact private-preview project, environment, app service, database service, merged source commit and successful deployment. It contains no credentials and is not standing permission for another deployment. Never substitute the public website/BNA database for the private app or overwrite a newer live intake with an older main snapshot.

## Acceptance and effects
Run focused tests during integration and the complete actual convergence gate: lint, framework-generated/pinned type check, applicable unit suites, build, disposable migration/transaction tests and authenticated two-family HE/EN desktop/mobile journeys. Report skipped, blocked, failed and unrun checks honestly. Provider/device/backup/restore acceptance remains separate from source parsing and helper tests.

Default for future changes: `NO_PUSH_NO_MERGE_NO_DEPLOY_NO_PROVIDER_WRITE`. The September 22 private-preview release used the owner's separate authorization and is not reusable standing permission. No real sends, paid transcription/AI/Apify, social publishing or ad mutation was performed. A later release still needs exact owner authority, target verification, independent review and actual operational evidence.
