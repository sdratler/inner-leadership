# Inner Leadership — GHL Worker Writeback

Status: CURRENT
Date: 2026-08-23

## Purpose

Disposable HighLevel Ask AI workers must persist their completion reports without editing the canonical master document directly.

## Drive Ledger

- Title: `Inner Leadership — GHL Worker Run Ledger`
- Spreadsheet ID: `1eSea9DH7l9MxJd0GPHGYB5RHV2wTwRAsnA_zDXPEhqM`
- Worksheet: `RUNS`
- Drive control folder: `00_CONTROL — GHL Source of Truth`
- Folder ID: `14HZPeXbcisTKVQikE990l512iB-QDLk6`

## Recommended Architecture

1. Ask AI creates one `IL Build Run` custom-object record at the end of every disposable worker run.
2. A single internal custom-object workflow triggers on `IL Build Run Created`.
3. The workflow appends one row to the Drive ledger using the Google Sheets action.
4. The worker verifies that writeback completed before declaring the run complete.
5. Previous rows are immutable: append only, never overwrite or delete.
6. The coordinator reconciles new ledger rows into the Drive master document and GitHub state mirror.

## Required Run Fields

- Run ID
- Timestamp in Asia/Jerusalem
- Location ID
- Workstream
- Worker Skill
- Status: COMPLETE / PARTIAL / BLOCKED / FAILED
- Started At
- Finished At
- Created summary
- Updated summary
- Verified summary
- Blocked summary
- Asset IDs
- Remaining dependencies
- Manual actions
- Published: NO unless explicitly authorized
- SMS / WhatsApp: ZERO for the boys funnel
- Drive Writeback Verified
- Full Report
- Source Chat / Thread

## Worker Completion Rule

A disposable worker may not declare completion until either:

- its `IL Build Run` record is created and the Drive ledger row is verified; or
- it reports `WRITEBACK_BLOCKED` with the exact cause.

## Safety

- Do not let workers edit `Inner Leadership — GHL Canonical Source of Truth` directly.
- Do not use legacy location `pBSnOK2nkdxp6gf9Rg3o`.
- Do not touch SG, One Time, BNA, adult-assessment, or double-underscore clinical assets.
- No deletion, publication, external sends, SMS, or WhatsApp.
- The internal ledger workflow may be published only after explicit owner approval because it must run automatically.
- The Google Sheets workflow action is a premium action and may incur a small per-execution charge.
