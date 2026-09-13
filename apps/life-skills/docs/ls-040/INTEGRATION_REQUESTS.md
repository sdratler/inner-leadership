# LS-040 central integration requests

The packet worker intentionally did not edit shared-owner files. A central integrator must perform only these reviewed wiring steps after independently verifying the packet and current control gates:

1. Add `0040_ls_home_practice_20260911.sql` and its exact SHA-256 to `apps/life-skills/migrations/manifest.json`. Apply it only through the existing loopback disposable database gate first. Production migration remains separately approved.
2. Extend the shared proxy/private-mode routing policy to admit the four UI/API route families only when the accepted private application is enabled. Preserve the current fail-closed foundation behavior; do not expose clinical data in `foundation_preview`.
3. Add authorized Home/Practice/Check-ins navigation links and current case/audience context using the shared navigation owner. Do not make audience IDs browser-authoritative; the APIs recheck them server-side.
4. If a shared page shell is preferred, wrap the four supplied route pages without changing the route contract, Hebrew RTL/English LTR behavior, or safe empty/error states.
5. Connect neutral reminder effects to the I-014 consumer only after rechecking the recipient's live `practice_due` preference, account, case membership, audience and source validity. `reminder_candidate_account_ids` is not delivery authorization.
6. Add database integration coverage for empty apply, existing accepted baseline apply, checksum-ledger repeat/verify-only, concurrent `any_assignee`/`each_assignee` submissions and correction history. No database service was available in the isolated worker environment.

No shared interface change is requested. `PracticeVersionReader`, `CoordinationSnapshot`, `CompletionReportReference`, `NotificationEffectReference` and `DeliveryAuthorization` are consumed as frozen at accepted LS-025.
