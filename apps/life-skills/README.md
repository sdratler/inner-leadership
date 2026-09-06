# Life Skills private-app foundation
An isolated, closed-by-default Next.js/TypeScript foundation. No public-site changes, real accounts, login handler, case database, clinical records or live service are included.

## Local integration
Node 22.12+ (below 25) and npm are required. Commands run inside this directory, never at the repository root. The first dependency install and lockfile creation belong to the authorized Codex integrator. Subsequent runs must use the committed package-lock.json and `npm ci`.

```sh
npm install
npm run verify
```

For a local visual preview, set `LS_APP_MODE=foundation_preview` and `LS_APP_ORIGIN=http://127.0.0.1:3001`, then run `npm run dev`. Preview mode rejects non-loopback origins. It has no database access. Private API and application paths remain unavailable in either mode. The default `foundation_locked` returns 503 for user pages. `/api/health` is liveness only; it does not assert database, authentication or deployment readiness. `/robots.txt` disallows indexing.

The preview routes are `/he/foundation` and `/en/foundation`; `?view=practitioner` selects the practitioner layout, otherwise the parent layout. All copy is explicitly foundation-only. Error, empty, loading and not-found states are supplied. Review images in the packet are not screenshots of a built Next application.

## Boundaries
`src/lib` contains locale, exact integer-agora money, explicit-offset instant, errors, visibility, audit and security primitives. `src/db` supplies the metadata schema and forward-only migration tooling. `src/ui` supplies shared tokens, simple components and the preview. Feature registration is initially empty. Account/case ownership and audience projections must be integrated and verified in LS-010/LS-025; the default adapters here never grant access. UI expansion belongs to LS-020. No consumer feature should be built against these unintegrated files.

Do not add business fees, scheduling policies, secret values or client data to this README or provenance file. `docs/current-sources.json` points to the CURRENT authorities without mirroring their business content.

## Database
Separate runtime and migration URLs are supported. Remote connections require certificate validation; URL SSL query overrides are rejected. The supplied migration CLI is limited to disposable loopback databases ending `_test` or `_dev`. The first SQL migration contains only technical foundation metadata; no clients or account tables. Run migrations explicitly, never during a web request or framework build. Read packet MIGRATIONS/README.md before running them.

## Verification
`npm run verify` runs lint, full framework-generated type checking, Vitest unit tests and a production build. `npm run test:db` requires a fresh disposable loopback database in `LS_TEST_DATABASE_URL`. `npm run test:e2e` builds and tests preview mode; `npm run test:e2e:locked` separately tests locked production mode. No failing or skipped required suite is a verification pass.

No production/staging deployment, public DNS change, external provider activation, recording, AI processing or real data is authorized by this foundation packet. Root static publishing must not expose this directory.
