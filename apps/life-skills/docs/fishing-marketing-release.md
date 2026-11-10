# Fishing Marketing readback release

The authenticated Fishing owner view receives bounded, encrypted evidence from the existing Windows operator. It does not dispatch that operator or create contacts, tasks, posts or messages. The [local entry point](fishing-facebook-local.md) defaults to read-only status; live operation stays with the existing desktop operator and authorization.

Current intent is routed by `JLFA-OWNER-FULLSTACK-PACKAGE-20261110-01`, T12/T13/T15, in the existing Fishing sources and Continuation. Root retains shared auth, route, schema, migration and release ownership. This document describes implementation and release checks; it is not a new offer, cadence, asset or publication master.

## Versioned evidence through the existing bridge

- Schema v1 remains readable without rewriting its stored or pending payloads. The panel labels it as historical group-preparation evidence; its former limits do not describe the current campaign.
- Schema v2 projects the current local personal-profile campaign: per-group rules and eligible dates, no total daily cap, publisher/account/login evidence, the last run and confirmed publication, and the next planned Florida wake time. Pending approval, group decline and unknown submission remain distinct from browser-confirmed publication.
- The existing Python serializer selects v2 only when the existing private configuration explicitly sets `marketing_campaign_projection_enabled` to the boolean `true`. The default remains v1. This is a projection selector, not permission to publish or enable synchronization. Existing pending-body, retry, secret and acknowledgment behavior remains unchanged.
- The encrypted store, fixed-owner binding, workspace checks, fresh session/role validation, bridge secret and HMAC acknowledgment remain the same. V2 uses the existing 0147 JSON envelope; it adds no endpoint, sender, table, migration or timer.
- Missing reads show unavailable or waiting with a real reload link and no invented zero counts. Old updates can mean an offline computer or delayed sync. A saved profile is not verified login; previous publication is not proof that the worker is currently running. Hosted controls cannot wake, start or resume the desktop worker.
- Current captions and exact video metadata come from the existing checked local creative. V2 does not substitute an image for that video. Manual fallback exposes selectable approved text and actual group/rules links without bypassing uncertain-submission or account holds.

## Existing release boundary

1. The integrator and existing reviewer consume the exact candidate and validation receipts. Deploy the reviewed app with synchronization off. Verify the deployed schema stage and required prior releases; do not assume a local database test is provider evidence.
2. If 0147 has not been admitted, retain the existing guarded schema procedure: fresh backup and verified isolated restore, protected proof tied to the exact deployment/commit/source/manifest/database/ledger, `release-fishing-marketing-schema.ts --preflight`, separately authorized apply with `LS_FISHING_MARKETING_SCHEMA_APPLY_APPROVED=true`, then `--verify-only`. That operator applies only 0147 and does not enable the feature. An already-admitted stage must be verified rather than blindly reapplied.
3. Configure the same dedicated `LS_FISHING_MARKETING_BRIDGE_SECRET` securely in the receiver and existing Windows sender, with the exact existing owner ID. Enable the receiver only after its schema readback, then the existing sender. Select current-campaign projection only after both sides support v2. Preserve any immutable pending v1 body until its original acknowledgment/reconciliation completes. Feature and sync flags do not activate Facebook publishing.
4. Verify authenticated owner reload of actual current data, unauthorized direct-read denial, replay/stale/conflict handling, group links, freshness and unavailable states. Keep isolated PGlite and component previews separate from mounted owner and provider/live evidence. The shared owner mount remains visible when sync is disabled; actual store reads remain gated.

Disabling `LS_FISHING_MARKETING_ENABLED` and `LS_FISHING_MARKETING_SYNC_ENABLED` stops new synchronization while retaining the existing encrypted snapshot. The panel reports unavailable rather than implying that the retained data is current. Restoring a database over later inquiries is not an automatic rollback. Publishing holds and reconciliation remain with the existing operator independently of these flags.

This slice does not activate a retired Israeli feed or add BNA, parent, practice or demo management to ordinary Fishing Marketing. The underlying historical PR213/schema provenance remains intact. Runtime timer verification, live posting and ordinary owner acceptance require their own receipts in the existing task.
