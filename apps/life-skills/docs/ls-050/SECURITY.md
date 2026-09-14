# LS-050 privacy and security evidence

- All case access is rechecked server-side from the existing live session within feature transactions.
- All write/publish actions require a current practitioner except an assigned form submission or optional resource completion.
- Parent/adult writes are tied to the authenticated account; no client-supplied actor or workspace field exists.
- Audience membership is checked independently of case membership. Title-only resource audiences never receive descriptions or references.
- Form answers, contextual-target details and qualitative narratives use the existing authenticated-encryption keyring with record-specific associated data.
- Submitted answers, published form templates, published review narratives and published review references are immutable at the database boundary.
- HTTPS/storage references are bounded; storage traversal segments are rejected.
- Form submissions and resource completions are idempotent under the existing workspace serialization pattern.
- HTTP mutations require exact origin plus session-bound CSRF; all endpoints are rate-limited and return private no-store envelopes.
- Feature history contains only neutral action names, actor/request/workspace IDs and time. It never copies answers, narrative, title, case detail or resource reference.
- Tests use synthetic UUIDs and descriptions only. No real client identity, clinical history, credentials, contact data, recordings or provider data are present.
