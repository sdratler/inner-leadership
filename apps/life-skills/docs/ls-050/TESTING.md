# LS-050 verification

Run from `apps/life-skills` after applying the packet:

```text
npm ci
npx vitest run --config tests/ls-050/vitest.config.ts --reporter=verbose
npm test
npm run typecheck
npm run lint
npm run build
npm audit --audit-level=high
```

The scoped suite covers schema strictness, absence of scoring inputs, exact resource types, traversal-safe references, four-week period boundaries, attribution, trusted attendance consumption, title-only audience redaction, encryption/immutability migration clauses, session/origin/CSRF behavior and service-level source snapshots.

Database execution was not available on the packet host. An integrator must run `0030_*` then `0050_*` twice in a disposable PostgreSQL database, verify the shared migration ledger, exercise database constraints/triggers, and destroy the database. Browser acceptance also waits for that ephemeral runtime and authenticated synthetic practitioner/parent fixtures.
