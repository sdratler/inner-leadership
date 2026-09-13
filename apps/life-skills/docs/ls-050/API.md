# LS-050 protected API contract

All endpoints require the existing `__Host-ls-session` server session. Mutations additionally require exact same-origin verification and the existing session-bound `x-csrf-token`. Responses are `private, no-store`; account/workspace identity is never accepted from JSON or query parameters.

## Forms

- `GET /api/forms/templates?locale=he|en` — practitioner template inventory.
- `POST /api/forms/templates` — practitioner creates a strict versioned definition.
- `GET /api/forms/assignments?caseId=<uuid>` — practitioner sees the case; a parent/adult sees only their own assignments, including the assigned definition.
- `POST /api/forms/assignments` — practitioner assigns one published template to an eligible case account; optional post-submission audience must be a published `family_full` audience containing that account.
- `POST /api/forms/submissions` — assigned account submits strict answers with an idempotency key.
- `GET /api/forms/submissions?caseId=<uuid>&assignmentId=<uuid>` — practitioner-only protected answer read.
- `PATCH /api/forms/submissions/review` — practitioner marks a submission reviewed without changing its answers or author.

## Resources

- `POST /api/resources` — practitioner creates one resource with an encrypted HTTPS/storage/form/text reference.
- `POST /api/resources/assignments` — practitioner deliberately shares it with an exact published non-private audience.
- `GET /api/resources/assignments?caseId=<uuid>` — audience-authorized projection. `family_title_completion` receives only title/completion; `family_full` receives details/reference.
- `POST /api/resources/completions` — authorized non-practitioner records optional completion idempotently.

## Qualitative progress

- `POST /api/progress/targets` and `GET /api/progress/targets?caseId=<uuid>` — encrypted contextual descriptions, never scores.
- `POST /api/progress/reviews` — practitioner drafts one exact 28-day period. The request has no attendance-count field. The service obtains the count from the LS-030 consumer and verifies each practice/report reference through injected readers.
- `GET /api/progress/reviews?caseId=<uuid>` — practitioner sees drafts/published history; family sees only published reviews for its exact audience.
- `POST /api/progress/reviews/publish` — reauthorizes, refreshes the attended count, and immutably publishes.

Unknown paths, methods, duplicate query keys, unexpected JSON fields, wrong origins, missing CSRF, revoked sessions and unauthorized case/audience access fail closed.
