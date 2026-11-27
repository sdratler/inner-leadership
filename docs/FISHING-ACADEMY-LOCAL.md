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
- Photo-led public landing and share metadata for `/{locale}/florida/trips`.
  RELEASE-03 uses the owner-supplied Bass Fishing Seminar photo. The local
  original and the publication receipt are private. The stripped export
  is served from `/trips/fishing-academy-bass-20261122.jpg`.

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

RELEASE-03 integrates the November handover in PR 252. The public landing uses
the owner-supplied November 22 Bass Fishing Seminar photograph. Both locales
retain the full scene and use accessible text for the Academy title and motto.

The application migration is `migrations/0153_ls_individual_fishing_trips.sql`.
Use `scripts/release-individual-trips.ts` with the existing Fishing service's
verified database connection, exact release identity and matching backup and
isolated restore proof. The operator supports the complete and selective prior
migration histories. It verifies the original Fishing owner, takes the shared
migration lock, and records only the trip migration. A repeat execution checks
the installed schema.

The existing Railway service holds the secrets. The feature's `env.example`
lists the names for public access, native registration, transactional mail,
read-only Stripe lookup and the private Site connection. The local checkout
needs only synthetic configuration for development and tests. Each mail and
invoice purpose binds its own provider to the original database pool and CA.

The private Fishing chat Site pairs with a current, authenticated owner
session. Approve or revoke its short-lived connection in the owner workspace.
Actual dates, transport and pickup arrangements belong to the owner when
creating a departure. A request for possible dates is free.

Release-03 receipts belong in the existing Fishing change log and continuation.
The project keeps the original photograph, account and recovery material, and
mobile acceptance evidence under ignored `.private/trips-20261127`. The QR and
screenshot handoff is under its `live` subfolder after public verification.
Check WhatsApp preview, tap-through and the device share sheet on a handset.

[Fishing change log](https://docs.google.com/document/d/1PExKb2PwAFAHlBtgmQ9RU-JdfTfQ-jTk41SpWetn7w8/edit?tab=t.smqvpaadni43) · [Fishing continuation](https://docs.google.com/document/d/1q-GDEaL9JmmVfy1meQrGvu3V4H2XNJ4jp2b17ZrP6bE/edit?tab=t.5ucllbuab4bn)
