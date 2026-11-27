# Keys trip inquiry release

Implementation receipt and release instructions for the versioned December 6,
2026 Keys interest flow. Current business decisions, copy, assets and permissions
remain in the owning sources linked by [the Fishing source route](https://docs.google.com/document/d/1AwB6My_ZrXf09j5ZFXvu42UKW30kCnlWU7_sLDpFHIA/edit?tab=t.4omt1dj3ko64).
This file does not replace those sources or the existing integration owner.

## Surfaces

| Surface | Path | Authority |
| --- | --- | --- |
| Public trip and interest form | `/en/florida/keys` | Public HTML; Hebrew path redirects to English |
| Public challenge and submission | `/api/public/keys-interest` | Exact same-origin, cookie-bound challenge; collection flags |
| Private inquiry workspace | `/en/app/keys` | Existing session, practitioner role and exact configured owner |
| Private list/detail/followup API | `/api/private/keys-interest` | Fresh owner session; CSRF for writes |
| Private chat transport | `/api/private/keys-chat` | Exact signed POST; explicit expiring connection grant |

The existing public applications and append-only Fishing followup tables hold
these records. There is no new database or migration, no CRM enrollment, payment,
reservation, mail job, WhatsApp send or family account creation. Original inquiry
and consent snapshots are immutable. Contact/pickup corrections are new followup
versions with a reason, retaining the original submission. Child details and
consent cannot be rewritten through the followup tools.

The displayed totals count interest requests and requested child places, not
unique families, paid places or confirmed seats. Pickup preferences can overlap.

## Configuration

Public collection requires both `LS_KEYS_INTEREST_ENABLED=true` and the existing
public group-application release configuration. The ordinary identity runtime,
workspace encryption keys and actual `LS_PROVIDER_INDEX_OWNER_ACCOUNT_ID` must
already be configured. Closing public collection does not close existing owner
access: private management uses `LS_PRIVATE_APP_ENABLED` plus its normal owner
authorization. New submissions close after the trip date in America/New_York;
identical previously saved attempts still resolve through idempotent replay.

The chat connection is disabled by default. A separate owner-private Sites
Worker forwards signed operations without retaining family records. Its source
and deployment are managed in its own registered Sites repository. It uses no
browser session cookie or synthetic identity Actor.

Activate only after the actual authenticated Sites caller ID and verified email
have been read back through the installed plugin. Configure these values in the
existing backend and the private Site using native runtime secret/config tools:

- `LS_KEYS_CHAT_ENABLED`
- `LS_KEYS_CHAT_HMAC_KEY` (32–64 random bytes, base64url; secret)
- `LS_KEYS_CHAT_GRANT_ID`
- `LS_KEYS_CHAT_SITE_ID`
- `LS_KEYS_CHAT_OWNER_USER_ID`
- `LS_KEYS_CHAT_OWNER_EMAIL`
- `LS_KEYS_CHAT_NOT_BEFORE`
- `LS_KEYS_CHAT_EXPIRES_AT` (a positive period no longer than 31 days)

The Site additionally uses `LS_KEYS_CHAT_BACKEND_URL`, an HTTPS URL ending exactly
in `/api/private/keys-chat`, with no credentials, query or fragment. Do not put
secret values in Git, public HTML, tool arguments, logs or this receipt. Keep the
Site owner-private. Do not automatically bind whichever caller connects first.

The backend verifies HMAC, caller pins, timestamp, durable nonce and rate limits,
then rechecks the real active verified owner inside the database transaction.
Writes share the canonical followup transaction helper, expected version and
operation-id replay contract. The connector exposes bounded reads, pickup
summaries, and owner-requested followup/contact changes only.

## Verification and admission

Before live intake, complete the repository's current review/release procedure on
the exact candidate head. Preserve shared integration ownership and frozen CI
controls. Source tests and an isolated branch do not establish native deployment.

Useful focused commands:

```sh
npx vitest run tests/unit/keys-trip-contract.test.ts tests/unit/keys-trip-http.test.ts tests/unit/keys-connection-http.test.ts tests/unit/keys-proxy.test.ts tests/unit/keys-trip-runtime.test.ts
npx vitest run --config vitest.db.config.ts tests/database/keys-trip.pglite.test.ts tests/database/keys-connection.pglite.test.ts
```

Also run the existing shared followup/public-application regressions and required
application checks. The PGlite tests exercise actual encrypted relational reads,
writes, replay, owner revocation and correction history, but they are not proof
of a hosted production database save.

Inspect the actual public page and form at narrow/mobile and desktop sizes,
including invalid age, siblings, back/review retention, optional consent,
uncertain same-command retries, server failure and real receipt. Inspect private
save/readback, version conflicts, stale summaries, access expiry and unsaved
navigation. Keep visual acceptance open until these rendered checks are observed.

After approved deployment, verify a distinctly synthetic public inquiry through
the live transport, ordinary exact-owner reload and a reversible correction;
confirm originals remain unchanged and unauthorized access is denied. Do not
mark the form live merely because the page renders. Resolve synthetic data using
the existing test-data policy; do not introduce a production deletion bypass.

For chat, verify the installed connection with a real read and a reversible
synthetic followup/readback, plus identity denial, before calling chat editing
ready. A published connection landing page or advertised MCP URL is insufficient.

## Operational controls

Disable `LS_KEYS_INTEREST_ENABLED` to stop new public intake while retaining
private inquiry management. Disable `LS_KEYS_CHAT_ENABLED` or revoke/expire its
grant to stop the separate chat connection. Preserve recorded inquiry/consent
and followup history. Do not modify versioned historical contracts to advertise
a future trip: introduce a new version and keep the old decoder available.

Use the WhatsApp call-to-action (https://wa.me/13054278909) in the prepared
marketing copy until the actual public form has passed its live save/readback
check. Exact rental cost, mileage, cargo space, pickup route, bridge access and
minyan remain operational questions; they are not implied by collecting
nonbinding interest.
