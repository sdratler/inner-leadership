# Fishing Academy local project

The Codex project and checkout are `C:\Users\sdrat\Fishing Academy`.
Run app commands from `apps/life-skills`. `inner-leadership` and `life-skills`
remain technical repository/package names; the active program is Fishing Academy.
This checkout does not grant access to BNA or retired Israeli customer records.

## November 27 implementation

Task `JLFA-TRIP-CALENDAR-CREDITS-BRAINSTORM-20261127-01 / HANDOVER-01`.
The downloaded original is `JLFA_Codex_Implementation_Handover_2026-11-27.md`,
SHA256 `fb5053cd610c248f2b948674fafa3d601ebd0831fa5ad7ad1d4264d314d493f4`.
Current sources also supplied DECISIONS-05 after that artifact was downloaded.
Source owners remain the current documents routed by `AGENTS.md`.

The bounded candidate lives in `apps/life-skills/src/features/individual-trips`:

- Free adult invitation/activation reusing native identity; explicit new Fishing
  household membership rather than an email match or administrative family row.
- EN/HE parent workspace at `/{locale}/trips`: children, all/any Sunday interest,
  separate Summer/Pesach years, offers and dollar credit.
- Exact-owner workspace at `/{locale}/trips/owner`: unique demand, departures,
  verified transport, nonpaying children, separate waiting list, offer delivery,
  cash receipts and reviewed reconciliation.
- Immutable child quotes, actual receipt allocations and conserved household
  credit. Open/uncollectible invoices fence seat release; only verified paid or
  void closure clears that invoice fence. Late/unknown funds never reclaim a seat.
- Encrypted native state chunks and durable operation receipts in the same SQL
  transaction; fresh adult/session/program membership checks before every replay.
- Transactional operational outbox and existing Gmail transport adapter, with
  request-bound jobs, terminal uncertainty and no historical queue drain.
- Signed, expiring owner-chat grants calling the same native services with exact
  caller, durable nonce and in-transaction grant/session revocation checks.
- Photo-led public landing component/initial metadata for
  `/{locale}/florida/trips`, held until the exact selected original is available.

The main Academy page, original inquiry and historical `/fish` seminar remain
their own routes. No legacy monthly offer, old consent, customer import or BNA
workflow was adopted by this candidate.

## Local verification

```powershell
Set-Location -LiteralPath 'C:\Users\sdrat\Fishing Academy\apps\life-skills'
npx vitest run individual-trips tests/unit/proxy.test.ts tests/unit/identity/login-return.test.ts tests/unit/seminar.test.ts
npm run typecheck
npm run lint
npm run build
```

The manual rendered harness is `tests/manual/individual-trips-browser.ts`. It
requires `NODE_ENV=test` and refuses ambient external database targets. A local
Next development process serves the real parent route/owner preview; only API
transport is routed to fresh native services in disposable PGlite. This proves
SQL persistence plus rendered interactions, rather than a deployed PostgreSQL
or real provider connection. Its private images/report are kept outside Git.

`evidence/individual-trips-20261127` records exact checks and remaining acceptance.

## Adoption and release

Existing integration/release ownership is preserved. The feature-local schema
proposal consists of `schema.sql`, `registration-schema.sql`, then
`mail-schema.sql`. They seed no customers or jobs. The shared integrator must
assign the additive migration/checksum and adopt it through the existing release
procedure; this package has not applied production DDL or edited the protected
migration/control manifest. PR244 also proposes a historical migration, so do
not copy its numbering or broadly merge its monthly-billing branch.

All feature flags default off. `env.example` in the feature folder documents
names only. Keep actual secrets in the existing provider configuration; do not
copy all Railway keys into a new project file or commit an environment file.
The runtime pins its Fishing workspace and exact owner account independently
of other program identities.

Registration/operational sending admissions currently remain `null`. They need
the existing release owner's exact purpose, origin and original database-target
binding before activation. Configured Gmail credentials alone grant no new send
purpose. The Stripe lookup port is read-only and requires a dedicated restricted
key, exact account/mode admission and invoice metadata binding:
`fishing_workspace_id`, `fishing_household_id`, `fishing_offer_id`,
`fishing_quote_id`. Runtime provider binding remains held; no real invoices or
charges were created during implementation.

The owner-chat server adapter is implemented and tested synthetically; the
previous stateless regular-chat Site is not thereby connected. Its actual
caller binding/read-edit-reread remains a separate acceptance step.

The public photo projection in `public-photo.ts` is deliberately unadmitted.
The source references `1000281043.jpg`; generated flyers and collages do not
replace those genuine original bytes. Bind the actual original, SHA256,
dimensions and source receipt before enabling public landing/image admission.
Then inspect the actual WhatsApp chat/Status preview and tap-through on a
physical phone. Browser metadata or emulation alone cannot establish that result.
