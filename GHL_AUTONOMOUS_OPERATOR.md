# Inner Leadership — GHL Autonomous Operator

Status: **CURRENT**  
Date: 2026-08-23  
Acquisition architecture: **Google-first direct qualification**

This file mirrors the continuation protocol in:

- Drive: `Inner Leadership — GHL Canonical Source of Truth`
- Drive document ID: `1NE-Pf4YzEnjFTtFxQad_Cy21_as7DbsEb_mTsqScV-0`
- GitHub: `ACQUISITION_PIVOT_2026-08-23.md`
- GitHub: `GHL_CURRENT_STATE.md`
- GitHub: `GHL_BUILD_SPEC.md`

## Current architecture

The active customer journey is:

**Google Search → price-transparent landing page → direct practical qualification → parent consultation → manual offer → first payment → enrollment**

The long masterclass, Masterclass Registration/Watch steps, 5% engagement threshold and masterclass-specific nurture are deferred. Preserve existing objects but never route current leads through them.

## Owner command

`KEEP GOING`

When the owner says “keep going,” “continue,” or invokes the Inner Leadership operator skill, the GHL AI must:

1. Read the current Drive control document and GitHub acquisition pivot. Fresh live GHL readback and the newest explicit decision override old chat memory.
2. Verify the active URL contains `/v2/location/9HQEubuu4WWG6xz09yB4/`.
3. Identify the assigned direct-funnel workstream and its last verified checkpoint. Do not restart or run a broad audit.
4. Inspect only the relevant asset family using exact-name checks.
5. Execute the next ready draft task whose dependencies are satisfied, save it draft/off, verify readback, and continue within the same workstream.
6. Prioritize the minimum Hebrew Search route: HE Landing → HE Direct Qualification → HE Thank You / Booking → consultation lifecycle.
7. Show 10,800 NIS / 3 × 3,600 NIS before qualification submission.
8. Keep existing masterclass stages, tags, fields, pages and media dormant. Do not delete or use them in the active route.
9. Never use legacy-location IDs or SG, One Time, BNA, adult-assessment or double-underscore clinical objects.
10. Never delete, publish, send, expose public availability, incur a paid action, connect an external account or add SMS/WhatsApp without explicit owner approval.
11. Treat draft/non-destructive creation and repair already specified in `GHL_BUILD_SPEC.md` as pre-authorized.
12. Recheck parallel dependencies once before declaring `BLOCKED_BY_PARALLEL_ASSET`.
13. At completion or blocker, append one `Life Skills GHL Build Run` record and verify the Drive ledger writeback.
14. Return exact IDs and a `CREATED / UPDATED / VERIFIED / BLOCKED` delta.

## Current workstream order

1. Read back and repair the existing Life Skills `IL | Public Funnel` candidate.
2. Complete HE Landing, HE Direct Qualification and HE Thank You.
3. Patch the existing 28 email records from `EMAIL_FUNNEL_EN_HE.md` V3.
4. Build W01–W03; repair W04/W05; build W09/W10.
5. Bind and QA the canonical consultation calendar; build W06–W08.
6. Run one complete Hebrew test lead with Google-like URL parameters.
7. Stop for owner approval before publication, workflow activation, public availability or spend.
8. Add English, Meta and optional AI components after the Hebrew direct route works.

## Real owner-approval gates

Stop before:

- publishing or turning an asset live;
- exposing calendar availability;
- deleting or merging assets;
- sending customer email or another external communication;
- adding SMS or WhatsApp;
- connecting or reauthorizing Google, Zoom, Meta, payment, phone or another external account;
- spending money or activating a paid feature;
- changing offer facts, price, public availability, legal wording or another unresolved business decision;
- choosing between materially different architectures.

Do not stop for routine draft creation or repair already defined in the canonical specification.

## One-line continuation command

> Read Drive document `Inner Leadership — GHL Canonical Source of Truth` (`1NE-Pf4YzEnjFTtFxQad_Cy21_as7DbsEb_mTsqScV-0`) and GitHub `ACQUISITION_PIVOT_2026-08-23.md`; verify Life Skills location `9HQEubuu4WWG6xz09yB4`; resume the active Google-first direct-funnel workstream from its last verified checkpoint; complete every next ready draft task without restarting, re-auditing or using any masterclass gate; and stop only at a real owner-approval gate or true external blocker.

## Recommended HighLevel implementation

### Ask AI Skill

Create or update a Skill named `IL Build Operator` with slash command `/il-build`. Its instructions must contain this protocol and direct the operator to read the Drive control document and acquisition pivot every run.

### Ask AI Scheduled Task

Use scheduled Ask AI only for recurring read-only reconciliation, blocker checks and next-action planning. It must not silently change the architecture or publish assets.

### Managed Agent

A published Managed Agent may perform tested supported CRM/API actions after explicit approval. Do not use it for unresolved decisions or customer-facing publication. Page-builder, form-builder, widget and workflow-canvas work remains interactive unless the exact write action has been proven reliable.

### Parallel threads

Use independent Ask AI threads for:

- Prompt A — funnel/forms;
- Prompt B — 28 email templates;
- Prompt C — W01–W05/W09;
- Prompt D — calendar/W06–W08/W10.

Each thread invokes `/il-build`, owns only its assigned asset family and writes back its exact completion report.
