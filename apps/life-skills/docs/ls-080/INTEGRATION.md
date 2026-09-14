# LS-080 central integration requests

## Preconditions and order

1. Verify the outer packet digest, every `CHECKSUMS.sha256` entry, the winning claim/fence, source epoch, fresh prepare audit, accepted base `f465161b761452c5d46aefe27671203e6f5784f1`, and accepted app tree `f996f9550479b9bf9bfbba725aa94f204cd611c6`.
2. Integrate LS-040 before LS-080. LS-080 reads the exact `ls_practice.practice_assignments` / `practice_assignment_versions` contract and frozen I-013 semantics.
3. Apply only the LS-080 complete files. The central migration owner adds the verified `0080_ls_context_updates_20260911.sql` digest to `migrations/manifest.json`; this packet does not edit that shared manifest.
4. Wire `PracticeAdaptationPort.createDraftFromReport` to LS-040's practitioner-only revision operation. The adapter must create a new draft for the referenced assignment/version, honor the supplied idempotency key, and return no published version. Never reinterpret adaptation as approval or publication.
5. After LS-050 and LS-080 are both accepted, inject `new DatabaseParentReportReader(identity.store)` from `src/features/updates/sources.ts` as LS-050 `progressRuntime({ parentReports })`. Its shape intentionally matches `progress/sources.ts`: `workspaceId`, `caseId`, `audienceId`, `authorAccountId`, `submittedAt`, `reportId`, `sourceType: 'parent_report'` only.
6. A central shared-route owner may add `/updates` and `/api/updates` to the private proxy policy and navigation/current-case wiring. Do not make browser case/audience IDs authoritative; the API rechecks both.
7. Run the full checks and authorized disposable PostgreSQL empty/apply/repeat/verify-only plus concurrent idempotency/immutability tests. Then run authenticated parent/practitioner English/Hebrew browser flows.

## Shared changes requested, not made

- One checksum-pinned `0080_*` entry in `migrations/manifest.json`.
- Private proxy admission and navigation/current-case context.
- LS-040 adaptation-port construction and injection into `ls080Runtime`; retain the current unavailable default until then.
- LS-080 `DatabaseParentReportReader` injection into LS-050 `progressRuntime`.

No package/lock/global interface/provider/client-data file change is required. Main merge, deployment, production migration, provider actions, publication, release and owner acceptance remain separately approved gates.

