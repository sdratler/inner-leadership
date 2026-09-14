# LS-040 security and privacy evidence

- Server actor: accepted opaque session cookie resolved by the identity runtime; request JSON cannot select an actor or workspace.
- Practitioner mutations: goal/commitment/instruction publication and occurrence scheduling require the practitioner assigned to the case.
- Parent mutations: coordination and check-ins require an active parent account, active case guardianship, explicit published-audience membership and explicit assignment in the pinned coordination version.
- Privacy boundary: coordination never changes the assignment's fixed audience. Adding a guardian later does not add them to a historical audience.
- Data at rest: customized instructions and goal/commitment titles use authenticated encryption from the accepted identity keyring; packet fixtures are synthetic.
- History: published instruction versions, coordination versions and completion reports are append-only. Corrections reference the immediately preceding report and use a new row.
- Concurrency: the occurrence is locked during completion; database uniqueness covers occurrence/actor/revision and actor/idempotency key; close time is written once.
- Reminders: the stored list is only a candidate set and is a subset of assignees. Delivery must recheck live opt-in and I-014 authorization.
- Logging: application errors return code-only envelopes; the feature action ledger stores only actor/request/action/time metadata; request bodies, clinical values and exceptions are not logged.
- Deliberate exclusions: no child account, uploads, proof, scores, gamification, automatic penalties, client identities, production credentials or provider calls.

