# W4 PR34 hooks repair — 2026-09-16

Scope: `LS-FIRST-PARENTS-20260916-01` P4B only. This is a local repair receipt for the existing PR34 branch; it neither merges nor deploys the private application.

## Baseline and repair

- Branch: `codex/app-ux-w4-20260914`
- Baseline: `1bbf1f0d66531de36c0da15d68243aafc32aa359`
- Affected source: `src/features/shared-items/workspace.tsx`
- Fixed the CI-blocking `react-hooks/set-state-in-effect` finding without disabling the rule. The item fetch now keeps response state keyed to its requested mode and authorized case. A case change renders loading until the matching response arrives, so an earlier case's protected resource/form data is not rendered for the newly selected case.
- No route, migration, provider, credential, Railway, database, or real-data change was made.

## Verification

- `npm ci --ignore-scripts --no-audit --no-fund`: passed after one transient Windows file-lock retry.
- `npm run lint`: passed with zero warnings.
- `npm run typecheck`: passed.
- `npm test`: 13 files / 241 tests passed.
- `npm run build`: passed.
- `npm run test:e2e:isolated-preview`: 4 passed: authenticated synthetic HE/EN parent and practitioner preview journeys at desktop and mobile widths; unauthenticated preview and private API boundaries remained closed.
- `npm run test:e2e:locked`: 1 passed: normal runtime keeps preview and private routes unavailable.
- `npx --no-install playwright test --config playwright.ui.config.ts`: 13 passed: HE/EN parent and practitioner synthetic gallery checks across 390, 768, and 1440 widths, including keyboard focus, mobile drawer, Back/context restoration, unsaved input, notification controls, modal recovery, RTL/LTR overflow, and closed protected routes.

The gallery evidence is synthetic UI evidence only. It does not claim an authenticated production parent record, live database access, deployment, or intake release.

## Release fence

The canonical private target remains Railway project `life-skills-sys034-staging-0907`, service `life-skills-private-staging`, with its dedicated PostgreSQL service. This repair has not crossed the existing merge, deployment, migration, restore, or real-data release gates.
