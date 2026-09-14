# LS-040 home-practice packet

This isolated packet implements the hierarchy `Goal → Commitment/Practice Assignment → Scheduled Occurrence → Check-In` on accepted application base `f465161b761452c5d46aefe27671203e6f5784f1`.

## Behaviour

- Practitioners create goals, commitments, draft assignments, immutable published instruction versions and occurrences.
- Authorized parents can read only an explicitly published audience, choose one or both authorized parents, select `any_assignee` or `each_assignee`, and name reminder candidates without changing the audience.
- Reminder candidates are only routing candidates. Delivery must independently recheck the parent's current I-014 preference and I-014 delivery authorization.
- Morning and evening are separate occurrence rows.
- A check-in is parent-authored and uses one of `done`, `partly_done`, `not_done`, `rescheduled`, or `not_applicable`. No row means unreported; it is never converted to `not_done`.
- Corrections append a new revision and preserve the old report. Idempotency and occurrence locking prevent duplicate completion or double closing.
- Published instructions, coordination snapshots and completion reports are protected as append-only database history.
- Clinical instructions, goal titles and commitment titles are encrypted at rest through the accepted identity keyring.

## Exclusions

There is no child actor, proof upload, point, grade, streak, badge, ranking, automatic penalty, provider action or real client fixture. This packet does not change the shared identity contracts, root schema, migration ledger, package files, navigation or provider configuration.

## Routes

- UI: `/{locale}/home-practice`, `/{locale}/goals`, `/{locale}/commitments`, `/{locale}/checkins`, where locale is `he` or `en`.
- API: `/api/home-practice`, `/api/goals`, `/api/commitments`, `/api/checkins`.

Every API read rechecks the current session, case membership and exact published audience. Mutations additionally require same-origin and session-bound CSRF validation.

