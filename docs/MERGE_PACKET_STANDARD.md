# Life Skills merge-packet standard — repository snapshot

**Drive authority:** https://docs.google.com/document/d/1NrlYux3I78nO7M9v1fKGl-UCKpkcZrOUtHSoV-BmLOE/edit

A GPT worker produces one bounded packet. It does not push, merge, deploy, or mark itself integrated.

## Required structure

```text
LS-###-SHORT-TITLE/
  MANIFEST.md
  FULL_FILES/
  MIGRATIONS/        # only when applicable
  TESTS/
  INTEGRATION.md
  ACCEPTANCE.md
```

## MANIFEST.md must state

- Work ID and title.
- Exact Product Contract version.
- Exact 40-character baseline SHA.
- Dependency heads/packet hashes used.
- Owned paths and forbidden paths.
- Complete file inventory.
- New dependencies requested.
- Migration IDs/order/idempotency notes.
- Environment-variable names only, never values.
- Tests run and results.
- Assumptions/limitations.
- Privacy declaration confirming fictional data only.
- Drive packet link and content hash when available.

## FULL_FILES

Provide complete UTF-8 files at repository-relative paths. Do not provide vague snippets. Shared-file modifications forbidden to the worker belong in `INTEGRATION.md` as exact wiring requests.

## Migrations

- Forward-only and uniquely named.
- Scoped to the feature owner.
- Safe on empty and initialized database.
- No destructive migration without a separate approved decision.
- Never contain real data.

## Tests

Include focused happy path, critical denial/privacy path, validation/error path, and migration behavior. Do not build a giant QA framework inside a feature packet.

## INTEGRATION.md

State exact central wiring required: package additions, route registration, nav item, migration registry, provider/env registration, shared type export. The integrator applies shared changes once after reconciling all packets.

## ACCEPTANCE.md

Describe one short real-user journey that demonstrates the feature, plus unauthorized behavior that must be denied.

## Build Control writeback

Worker may update only its own Work Graph row:
- `Claimed`
- `Code generating`
- `Packet ready`

Only the integrator may record:
- `Integrated`
- `Verified`
- `Deployed`
- `Owner accepted`

A packet is not an implementation claim. It becomes code truth only when its exact content is integrated into a recorded Git SHA.
