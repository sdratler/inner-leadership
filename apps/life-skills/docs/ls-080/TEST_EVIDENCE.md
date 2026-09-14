# LS-080 test evidence

Synthetic-only checks from the isolated accepted-base copy:

- `npm ci --ignore-scripts`: passed; 407 packages audited, zero vulnerabilities.
- `npm exec vitest run -- --config tests/ls-080/vitest.config.ts`: 5 files, 39 tests passed.
- `npm run typecheck`: passed, including Next route generation and strict TypeScript.
- `npm run lint`: passed with zero warnings.
- `npm test`: 8 files, 126 full accepted-base plus LS-080 tests passed.
- `npm run build`: production Next build passed; dynamic `/[locale]/updates` and `/api/updates` routes were emitted.
- `npm audit --audit-level=high`: passed with zero vulnerabilities.

Covered contracts include strict rejection of browser-supplied authority/evidentiary/clinical fields; server attribution; encrypted narratives; immutable version snapshots; parent/audience denial; review without evidentiary elevation; practitioner draft/published replies; family draft filtering; fail-closed adaptation; exact adaptation-port input; database immutability/provenance constraints; origin/CSRF/session/rate-limit boundaries; and the LS-050-compatible attribution-only reader.

Not run in the packet worker environment: PostgreSQL apply/repeat/verify-only/concurrency tests, authenticated browser/E2E tests, shared proxy/navigation integration, deployment, live migration, provider action, publication or release.
