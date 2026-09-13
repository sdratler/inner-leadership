# LS-050 — protected forms, resources and qualitative reviews

This packet implements the isolated LS-050 preparation lane on accepted app commit `f465161b761452c5d46aefe27671203e6f5784f1` (app tree `f996f9550479b9bf9bfbba725aa94f204cd611c6`). It consumes the frozen identity, visibility, audit, practice-reference and coordination contracts without changing their shared files.

## Delivered behavior

- Versioned HE/EN parent/adult form templates with strict definitions and no scoring configuration.
- Case-authorized assignments; each parent submits only their own assigned form.
- Encrypted, immutable answers; practitioner-only protected-response reads and an explicit reviewed state.
- One resource content type with the exact `audio | pdf | video | link | text | digital_form` vocabulary.
- Case/audience resource assignments with title-only versus full-detail projection and idempotent optional completion.
- Contextual targets and narrative four-calendar-week reviews.
- Review source snapshots for immutable practice versions and individually attributed parent reports.
- Real attended-child-session count read from the LS-030 tables through a read-only consumer adapter. It counts only `individual` appointments with `present`/`late` attendance inside exact Asia/Jerusalem period boundaries; it never reads credits to infer attendance.
- Responsive HE/EN route surfaces at `/{locale}/forms`, `/{locale}/resources` and `/{locale}/progress`.
- Protected API families under `/api/forms`, `/api/resources` and `/api/progress`.

## Deliberate exclusions

There are no grades, numeric domain ratings, ranks, composite growth values, gamification, invented improvement, automatic clinical conclusions, child accounts, calendar writes, credit behavior, provider calls, private fixtures, or deployment behavior. Progress publication is a practitioner action to an exact published `family_full` audience.

The route pages are bounded feature surfaces. Shared shell navigation and selected-case wiring belong to the coordinator/integrator and are requested, not edited here.
