# LS-050 integration requests and order

## Preconditions

1. Verify the target `apps/life-skills` tree is `f996f9550479b9bf9bfbba725aa94f204cd611c6`, or independently review/rebase every packet destination.
2. Verify the LS-050 ZIP and every checksum before applying it.
3. Apply only the indexed `FULL_FILES` and the single `0050_*` migration. Do not infer package, lock, environment, proxy, interface, provider or deployment edits.

## Dependency order

1. Integrate the already prepared LS-030 calendar packet first. LS-050's `DatabaseAttendanceReader` consumes its exact `ls_calendar.appointments` and `ls_attendance.records` schema read-only. Source packet SHA-256: `9574b65da1441d0a48c48c70ac8c01956e4ece9d32fd3083626cd03404d408e5`.
2. Apply LS-050 full files and `migrations/0050_forms_resources_qualitative_reviews_20260911.sql`.
3. Central migration owner adds the verified `0030_*` and `0050_*` entries to `migrations/manifest.json` in numeric order. This packet intentionally does not edit the shared manifest.
4. When LS-040 is integrated, pass its frozen I-013 `PracticeVersionReader` to `progressRuntime`.
5. When LS-080 is integrated, pass its case/audience-authorized `ParentReportReader` to `progressRuntime`. The adapter must preserve author and submitted time and must not translate `reviewed` into witnessed/verified.
6. Central UI owner may add the three locale routes to shared practitioner/family navigation and supply the selected authorized case. The route surfaces exist but this packet does not edit global navigation.
7. Run ephemeral PostgreSQL migration/idempotency tests before acceptance, followed by authenticated practitioner/parent browser tests. No shared or production database migration is authorized by this packet.

## Fail-closed behavior

- When `LS_CALENDAR_ENABLED` is not exactly `true`, the attendance adapter is unavailable.
- A review containing practice-version or parent-report IDs cannot be created until the corresponding adapters are supplied.
- A no-report review may be drafted only when its narrative contains no parent-reported example; `informationLimits` is always required.
- Only a published `family_full` audience can receive a narrative review.

## Shared changes requested, not made

- One checksum-pinned `0050_*` entry in `migrations/manifest.json`.
- Global shell links/selected-case context for Forms, Resources and Progress.
- LS-040/LS-080 reader injection after those lanes are independently accepted.
- No package or lockfile change is required.
