# Fishing practice record — bounded local candidate

This candidate extends the existing owner-only Groups/Fishing draft. It is not a learning platform, enrollment, attendance, trip authorization, ranking, billing, or provider workflow.

## Record boundary

- A record belongs to one workspace, existing draft group, and existing **current proposed placement**. The placement supplies the verified synthetic learner identity; the record does not create a client, case, enrollment, or participant.
- The six module keys come directly from the owner request: knots; rod rigging; sinkers, weights, leaders, and hooks; field casting; fighting-a-fish practice; equipment selection.
- Module criteria are visibly `unset`. Module order, scoring, pass/graduation rules, and trip eligibility are not modeled.
- Absence of a revision means `no evidence yet`, never failure. A practitioner may append either `practice observed` or a correction to `no evidence yet`, with an optional encrypted note.
- Every correction is a new immutable revision linked to its predecessor. History retains who recorded each revision and when.
- Trip review is rendered separately as `not decided`; it is not writable in this slice and cannot be inferred from practice evidence.

## Access and isolation

- The existing `/api/private/group-placement` perimeter remains the only route.
- Ordinary practitioner session, exact canonical origin, CSRF, workspace lock, fresh-account, and practitioner checks run before every mutation.
- Reads and writes are workspace-scoped. A write is rejected unless the draft group exists and the proposed placement belongs to it and has not been moved away.
- Private notes are encrypted with a record-specific AAD before storage. List responses expose only the authorized learner label and the bounded observation fields.

## Idempotency and correction

- A caller supplies a UUID `operationId` and the current revision ID, or `null` when no evidence exists.
- The request digest binds workspace, draft group, proposed placement, module, evidence state, note, and expected revision.
- Repeating the same operation returns the same saved revision. Reusing an operation ID with changed content conflicts.
- A stale expected revision conflicts; one immutable predecessor can have only one successor.

## Effect fence

The migration creates only two append-only `ls_group_admin` tables and indexes. It does not touch appointments, attendance, cases, engagements, payments, credits, messaging, providers, or public surfaces. Production migration, activation, merge, and deployment remain separate gates.
