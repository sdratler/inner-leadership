# Life Skills private-app foundation
An isolated, closed-by-default Next.js/TypeScript foundation. No public-site changes, real accounts, login handler, case database, clinical records or live service are included.

## Local integration
Node 22.12+ (below 25) and npm are required. Commands run inside this directory, never at the repository root. The first dependency install and lockfile creation belong to the authorized Codex integrator. Subsequent runs must use the committed package-lock.json and `npm ci`.

```sh
npm install
npm run verify
```

For a local visual preview, set `LS_APP_MODE=foundation_preview` and `LS_APP_ORIGIN=http://127.0.0.1:3001`, then run `npm run dev`. Preview mode rejects non-loopback origins. It has no database access. Private API and application paths remain unavailable in either mode. The default `foundation_locked` returns 503 for user pages. `/api/health` is liveness only; it does not assert database, authentication or deployment readiness. `/robots.txt` disallows indexing.

The separately authorized hosted synthetic preview uses `LS_APP_MODE=isolated_preview`, an HTTPS `LS_APP_ORIGIN` and an uncommitted 32–128 character `LS_PREVIEW_ACCESS_KEY`. It exposes only `/he/preview` and `/en/preview` behind HTTP Basic authentication (`preview` plus the secret key). Private APIs remain unavailable, health and robots stay public, and no client data is used. Run `npm run test:e2e:isolated-preview` before publishing a preview revision.

The preview routes are `/he/foundation` and `/en/foundation`; `?view=practitioner` selects the practitioner layout, otherwise the parent layout. All copy is explicitly foundation-only. Error, empty, loading and not-found states are supplied. Review images in the packet are not screenshots of a built Next application.

## Boundaries
`src/lib` contains locale, exact integer-agora money, explicit-offset instant, errors, visibility, audit and security primitives. `src/db` supplies the metadata schema and forward-only migration tooling. `src/ui` supplies shared tokens, simple components and the preview. Feature registration is initially empty. Account/case ownership and audience projections must be integrated and verified in LS-010/LS-025; the default adapters here never grant access. UI expansion belongs to LS-020. No consumer feature should be built against these unintegrated files.

Do not add business fees, scheduling policies, secret values or client data to this README or provenance file. `docs/current-sources.json` points to the CURRENT authorities without mirroring their business content.

## Database
Separate runtime and migration URLs are supported. Remote connections require certificate validation; URL SSL query overrides are rejected. The supplied migration CLI is limited to disposable loopback databases ending `_test` or `_dev`. The first SQL migration contains only technical foundation metadata; no clients or account tables. Run migrations explicitly, never during a web request or framework build. Read packet MIGRATIONS/README.md before running them.

## Canonical Railway target

Under `D-LS-ISOLATED-RUNTIME-20260913-01`, every private-app worker must use Railway project `life-skills-sys034-staging-0907` (`3b756632-1f66-4f75-a016-eabc37aa0d67`), environment `production` (`dd91bd71-57cc-45e6-a75b-8c858491d7c7`), application service `life-skills-private-staging` (`0267d061-f3ce-4a0a-82d4-ce133e4501e9`) and database service ID `354b5343-9e83-45a7-b764-09396f14ae29`. The database is selected by exact service/project/environment identity and bound as `LS_DATABASE_URL=${{Postgres.DATABASE_URL}}`; never infer it from the `Postgres` display name.

The non-secret deployment record is [`deployment/railway-target.json`](deployment/railway-target.json); reconciliation and preservation details are in [`docs/runtime/railway-reconciliation-20260914.md`](docs/runtime/railway-reconciliation-20260914.md). The Railway project `inner-leadership-app` remains preserved legacy/noncanonical. The Railway project `inner-leadership` is a separate public-site runtime. Neither is an alternate private-app destination, and the public `/life-skills` website database must never be used here.

## Verification
`npm run verify` runs lint, full framework-generated type checking, Vitest unit tests and a production build. `npm run test:db` requires a fresh disposable loopback database in `LS_TEST_DATABASE_URL`. `npm run test:e2e` builds and tests preview mode; `npm run test:e2e:locked` separately tests locked production mode. No failing or skipped required suite is a verification pass.

No production/staging deployment, public DNS change, external provider activation, recording, AI processing or real data is authorized by this foundation packet. Root static publishing must not expose this directory.
