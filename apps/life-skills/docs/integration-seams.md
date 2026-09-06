# Foundation interfaces — not an LS-025 freeze
These complete implementation seams provide a starting point, not permission to skip the later identity/UI integration gate.

- SessionAdapter resolves an opaque token into a distinct account/workspace principal; token hashing and a durable revocation-backed store are the later identity owner's work. The default adapter returns UNAVAILABLE. Parent accounts must remain separate; no child login or shared-family credentials.
- CaseAuthorizer is a server-side injected authorization boundary. Its default rejects every operation. UUID branding and same-workspace checks do not establish membership or permission.
- Visibility is exactly private, family_title_completion, or family_full. This enum alone is not an audience projector. No operation publishes an existing private practitioner note, grants a new parent historical access, or exposes record fields.
- AtomicRateLimitStore must atomically count a request window in a shared durable store. Failure denies. An opaque HMAC key avoids raw actor identifiers in keys. This packet does not supply a production rate-limit backend.
- AuditSink receives only strictly validated event metadata, never bodies, names, histories, tokens or errors. There is no default console sink and no claim of durable production auditing.
- HTTP body parsing is stream-bounded and schema-checked, with a neutral error envelope. Permission checks and origin/CSRF enforcement remain mandatory in future mutation routes. No sensitive mutation endpoint exists in this packet.
- Feature registration is deterministic and rejects missing dependencies, cycles and duplicate keys. It contains no registered domain features. LS-025 must reconcile/freeze shared interfaces before feature consumers start.
- Money is an integer number of ILS minor units. Explicit-offset timestamps are normalized to UTC; calendar display uses Asia/Jerusalem. No billing, credit, attendance or cancellation policy is implemented by these generic helpers.
