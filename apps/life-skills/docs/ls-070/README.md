# LS-070 private application convergence

This integration reuses the LS-030 calendar packet and LS-040, LS-060, LS-080, and LS-050 producer packets in dependency order, with explicitly reviewed central repairs. It is based on main `9956e396dfb19d5ae6e3ce2a1136b107027679b7`; the review branch is `codex/ls070-private-app-integration-20260913`. This does not itself change main.

Central wiring is deliberately bounded:

- successful non-GET calendar commands commit before a separate database-only `credit_effect` drain; a delivery failure never falsely reports that the command rolled back;
- one immutable LS-070 receipt binds a reviewed report and idempotency key to one encrypted LS-040 draft;
- adaptation retries return the same draft for identical bytes and fail closed for divergent bytes, stale authorization, or another draft;
- the progress route injects the real calendar attendance, published-practice, and parent-report readers;
- the migration manifest and feature dependency order are centralized;
- practitioner and family dashboards are bilingual and guarded by both explicit private-mode routing and current session role checks.

`LS_PRIVATE_APP_ENABLED=true` is the reversible server-side opt-in for private UI and domain API routes. The existing environment parser still enforces loopback HTTP or external HTTPS. Feature-specific server authorization remains authoritative; navigation never grants access.

## Credit delivery and recovery

The isolated drain preserves sequence within each appointment and atomically commits each effect with its delivery mark. A failed event remains pending, rolls back its partial database work, and records a neutral 60-second retry cooldown. A failed batch cannot repeatedly starve later appointments. Historical failure summaries remain after recovery; `ls_calendar.events.delivered_at` is the completion fact.

If a queued consume is overtaken by a legitimate credit protection, a later durable calendar preservation must prove the correction before the consume is acknowledged without movement. A subsequent restore without a debit requires preceding consume and preserve receipts. No artificial debt, debit, restoration, or double application is created. Actual debits are restored to their original block. Refunds lock the concrete block using a valid PostgreSQL query.

Delivery is request-driven: **no scheduler is installed**. Merely recording funding does not drain pending events. Recovery requires a subsequent authorized calendar mutation, or an explicitly authorized database-only recovery run through the same store/drain. A successful command for an appointment permits an immediate retry for that appointment. Practitioner responses may expose a neutral delivery status; parent responses never expose workspace-wide queue state. The API's success response describes the committed calendar command, not a promise that every queued credit is delivered.

## Verification and release boundary

Real PostgreSQL regressions under `tests/database/calendar/integration-*.test.ts` cover manual funding/refunds, independent delivery, batch starvation, correction before and after debit, and the public update-to-practice adaptation retry path. Unit tests under `tests/unit/calendar` cover navigation and command/delivery acknowledgement with unchanged origin and CSRF gates. Feature-specific LS-040 through LS-080 suites remain runnable with their own Vitest configurations in addition to the standard repository checks.

All nine migrations extend the accepted 0010 application baseline; feature migrations have not been applied to a live database. Use a freshly migrated disposable database for this unmerged chain. Preserve older prototype databases as historical evidence rather than rewriting their migration ledger.

Review-branch publication, a pull request and secret-free repository CI are authorized. Main merge, deployment, live migration and live provider actions still require their separate approvals. No provider integration, real client data or child login is included. Before deployment, validate the full trusted-ingress contract: configuration-derived forwarding headers are not proof of inbound TLS.
