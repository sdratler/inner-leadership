# Inner Leadership — GHL Autonomous Operator

Status: CURRENT
Date: 2026-08-23

This file mirrors the autonomous continuation protocol in the Google Drive control document:

- `Inner Leadership — GHL Canonical Source of Truth`
- Drive document ID: `1NE-Pf4YzEnjFTtFxQad_Cy21_as7DbsEb_mTsqScV-0`

## Owner command

`KEEP GOING`

When the owner says “keep going,” “continue,” or invokes the Inner Leadership operator skill, the GHL AI must:

1. Read the canonical Drive control document and use fresh live GHL readback rather than old chat memory.
2. Verify the active URL contains `/v2/location/9HQEubuu4WWG6xz09yB4/`.
3. Identify the active workstream and last completed action. Do not restart or run another broad audit.
4. Inspect only the relevant asset family using exact-name checks.
5. Execute the next incomplete task whose dependencies are satisfied; save draft/off; verify readback; continue within the same workstream.
6. Continue until the workstream is complete or a real owner-action blocker exists.
7. Never use legacy-location IDs or SG, One Time, BNA, adult-assessment, or double-underscore clinical objects for the boys funnel.
8. Never delete, publish, send, expose public availability, incur a paid action, connect an external account, or add SMS/WhatsApp without explicit owner approval.
9. Treat draft/non-destructive creation and repair already specified in the control document as pre-authorized.
10. Recheck parallel dependencies once before declaring `BLOCKED_BY_PARALLEL_ASSET`.
11. Return exact IDs and a `CREATED / UPDATED / VERIFIED / BLOCKED` delta.

## Real owner-approval gates

Stop before:

- publishing or turning an asset live;
- deleting or merging assets;
- sending email or another external communication;
- adding SMS or WhatsApp;
- connecting or reauthorizing Google, Zoom, Meta, payment, phone, or another external account;
- spending money or activating a paid feature;
- changing offer facts, price, public availability, legal wording, or another unresolved business decision;
- choosing between materially different architectures.

Do not stop for routine draft creation or repair already defined in the canonical specification.

## One-line continuation command

> Read “Inner Leadership — GHL Canonical Source of Truth” (Drive document `1NE-Pf4YzEnjFTtFxQad_Cy21_as7DbsEb_mTsqScV-0`), verify Life Skills location `9HQEubuu4WWG6xz09yB4`, resume the active workstream from its last verified checkpoint, complete every next ready draft task without restarting or re-auditing, and stop only at a real owner-approval gate or true external blocker.

## Recommended HighLevel implementation

### Ask AI Skill

Create a Skill named `IL Build Operator` with slash command `/il-build`. Its stable instructions should contain this protocol and direct the operator to read the Drive control document on every run.

### Ask AI Scheduled Task

Use a scheduled Ask AI task only for recurring read-only reconciliation, blocker checks, and next-action planning. It may report the next `READY` task and run history; it must not silently change the architecture or publish assets.

### Managed Agent

A published Managed Agent may perform scheduled supported CRM/API actions after testing. Do not use it for unresolved decisions or customer-facing publication. UI-heavy page-builder, form-builder, widget, and workflow-canvas work remains interactive unless the exact write action is proven reliable.

### Multi-threading

Use separate Ask AI threads for independent workstreams, all invoking `/il-build`. Each thread owns one asset family and returns a completion report. The central coordinator updates the canonical registry after each report.
