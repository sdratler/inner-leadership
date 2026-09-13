# LS-040 test evidence

Executed in the isolated exact accepted-base workspace on 11 September 2026:

| Command | Result |
|---|---|
| `npm ci --ignore-scripts` | PASS; 406 packages added; 407 audited; 0 vulnerabilities |
| `npx vitest run --config tests/ls-040/vitest.config.ts` | PASS; 3 files, 57 tests |
| `npm test` | PASS; accepted baseline suite, 8 files, 126 tests |
| `npm run lint` | PASS; zero warnings |
| `npm run typecheck` | PASS; Next route type generation and `tsc --noEmit` |
| `npm run build` | PASS; production build and all four UI/API route families listed |

The scoped suite covers calendar validation, five statuses, unreported semantics, any/each close policy, assignee denial, reminder opt-out filtering, encrypted goal/instruction persistence, practitioner/parent boundaries, prospective-only coordination, idempotent check-ins, append-only migration declarations, route and migration inventory, and exclusions for gamification/provider/fixture data.

Not run: actual PostgreSQL migration/apply/repeat/concurrency because no disposable PostgreSQL or Docker runtime was present. That remains an explicit central integration request and must pass before integration acceptance.

