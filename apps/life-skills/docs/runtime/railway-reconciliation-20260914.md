# Railway runtime reconciliation — 2026-09-14

Decision: `D-LS-ISOLATED-RUNTIME-20260913-01`

This inventory is administrative only. It contains no database credentials, client rows or secret values. A display name alone is never sufficient to select a database.

## Canonical private-app destination

The dedicated target is Railway project `life-skills-sys034-staging-0907` (`3b756632-1f66-4f75-a016-eabc37aa0d67`), environment `production` (`dd91bd71-57cc-45e6-a75b-8c858491d7c7`). Its application service is `life-skills-private-staging` (`0267d061-f3ce-4a0a-82d4-ce133e4501e9`). Its PostgreSQL service is selected by service ID `354b5343-9e83-45a7-b764-09396f14ae29` within that exact project and environment, not by the `Postgres` display name.

The application source is `sdratler/inner-leadership`, root `/apps/life-skills`, branch `codex/ls070-private-app-integration-20260913`. The exact deployed commit, database binding readback, migration state and preview URL remain to be filled after the provider configuration completes.

## Preserved noncanonical projects

| Project | Exact identity | Current classification | Preservation rule |
| --- | --- | --- | --- |
| `inner-leadership-app` | project `3d60e1ad-11f0-4c96-bf3f-282e62acf475`; app `287e76dc-ea25-41bb-b801-16b50210f927`; database `9372b2b1-9114-4e8a-a462-814647965108` | Legacy/noncanonical app; source repository is `shloimie-beep/inner-leadership-app` | Do not stop, delete, migrate, import or repoint. Preserve its volume and data pending ownership, retention and backup decisions. |
| `inner-leadership` | project `13ba18bd-2e8f-4e4d-a2c5-78e4f32f1332`; service `ae1cf491-6bbb-4e49-b049-185e06da2e70` | Canonical public source-site runtime, not the private app; no PostgreSQL service observed in this project | Keep separate. Do not bind the private app to any database used by the public `/life-skills` website or its downstream host. |

## Cleanup preparation only

No destructive cleanup is authorized. Before any later retirement request, export provider configuration and deployment metadata, identify data ownership and retention obligations, take and verify a recoverable database backup where a database exists, confirm no domains or integrations route to the candidate, record rollback instructions, and obtain separate approval naming the exact project/service/volume targets. Until every step is satisfied, both noncanonical projects stay intact.
