# Inner Leadership — GHL Current State

Date: 2026-08-23
Status: CURRENT RECONCILIATION SNAPSHOT

## Canonical operating rule

- GHL is the live funnel/customer-journey system.
- GitHub is the canonical text/state record.
- Google Drive is the canonical binary creative library.
- No SMS.
- No WhatsApp automation.
- Do not publish until explicit owner approval.
- Search exact asset name before creating.
- Do not delete duplicates during active build.
- Do not touch One Time or BNA assets.

## Canonical GHL location

- Name: `Life Skills`
- Location ID: `9HQEubuu4WWG6xz09yB4`

Every operational prompt must first verify that the GHL URL contains:

`/v2/location/9HQEubuu4WWG6xz09yB4/`

### Legacy / wrong location

Earlier Inner Leadership build records and assets exist in:

- `pBSnOK2nkdxp6gf9Rg3o`

Treat every ID from that location as LEGACY / ORPHANED unless independently re-created and verified inside `9HQEubuu4WWG6xz09yB4`.

Do not delete the legacy assets, but do not reference them from the current build.

## Current-location reconciliation — verified 2026-08-23

### CRM foundation

Only the older SG foundation currently exists in the Life Skills location:

- existing non-IL pipeline: `SG-01 Self-Governance Enrollment` — `pVp04B8d4KjYZ36dytIp`
- existing custom fields: 16 fields, all using `contact.sg_*`; zero `contact.il_*` fields
- existing tags: 19 SG/generic tags; zero canonical `il |` tags

Therefore the canonical Inner Leadership CRM foundation is currently MISSING:

- `IL | 12-Week Program` pipeline
- 13 canonical IL stages
- 31 canonical IL tags
- 22 canonical `contact.il_*` fields

Do not substitute or rename the SG assets. They are separate.

### Workflows

Two draft workflow shells exist in the canonical location:

- W04 candidate, currently named `Qualification Started Workflow` — `d450fc35-530b-4143-a5c0-28b81850de7d`
- W05 candidate, currently named `IL Qualification Outcome` — `10d4cb09-cf3b-47ed-8e0a-d60aaeeb313f`

Both currently reference missing IL fields/tags/pipeline objects and are therefore not operational.

Required action after CRM foundation creation:

- rename W04 to `W04 | IL | Qualification Started`;
- rename W05 to `W05 | IL | Qualification Outcome`;
- repair their triggers, actions, branches, and opportunity-stage mapping using the newly verified current-location IDs;
- keep both draft/unpublished.

Workflow status:

- W01 New Lead Routing — NOT BUILT
- W02 Masterclass Registration — NOT BUILT
- W03 Masterclass Engagement — BLOCKED by missing real masterclass video
- W04 Qualification Started — DRAFT SHELL EXISTS; BROKEN UNTIL FOUNDATION EXISTS
- W05 Qualification Outcome — DRAFT SHELL EXISTS; BROKEN UNTIL FOUNDATION EXISTS
- W06 Consultation — NOT BUILT
- W07 Offer — NOT BUILT
- W08 Payment & Enrollment — NOT BUILT
- W09 Masterclass Nurture — NOT BUILT
- W10 Data Hygiene — NOT BUILT

### Funnel and forms

Current-location API reconciliation returned:

- total funnels: 0
- total forms: 0

Therefore all of the following are MISSING in `9HQEubuu4WWG6xz09yB4`:

- `IL | Public Funnel`
- ten HE/EN funnel steps
- `IL | HE | Masterclass Registration`
- `IL | EN | Masterclass Registration`
- `IL | HE | Qualification Fallback`
- `IL | EN | Qualification Fallback`
- `IL | Shared | Confidential Intake`

Legacy equivalents exist in `pBSnOK2nkdxp6gf9Rg3o`; do not use their IDs in the current build.

### Calendar

No exact calendar named `IL | Parent Consultation` exists in the canonical location.

Current non-canonical candidates in `9HQEubuu4WWG6xz09yB4`:

- `SG-01 Parent Consultation` — `NNYMfaDAlrtsxSQKvMPm`
- `Shloimie Dratler's Personal Calendar` — `P2DIOgdMZ4ci5PZype1I`

Leave both untouched.

Create one new canonical Personal Booking Calendar:

- exact name: `IL | Parent Consultation`
- owner: Rabbi Shloimie / Solomon Dratler, current-location user `uyhQVFp0ixFvGrKOKCrK`
- Zoom meeting location
- no Google/Outlook conflict calendar
- Look Busy off
- no SMS or WhatsApp notifications
- unpublished
- availability remains owner-review before publication
- consultation duration remains WORKING until owner approval; a technical draft value may be used only if GHL requires one to save

### Knowledge bases, bots, and widgets

Current reconciliation found:

- one unrelated/default KB: `Existing knowledge base` — `A3jlU85MYs5IORNw4Gjn`
- zero IL knowledge bases
- zero Conversation AI bots/agents
- widgets could not be listed through the available API and remain UNVERIFIED

Required final architecture:

- `IL | KB | Program | HE`
- `IL | KB | Program | EN`
- `IL | Bot | HE | Masterclass Concierge`
- `IL | Bot | EN | Masterclass Concierge`
- `IL | Bot | HE | Program Qualification`
- `IL | Bot | EN | Program Qualification`
- one Hebrew widget
- one English widget

All remain off/draft until final QA.

## Verified in canonical location — Media

GHL Media root:

- `IL | Inner Leadership` — `6a89f71a67bb7ac351890442`

Subfolders:

- `IL | 01 | Real Program Photos` — `6a89f72467ecc8731dc956b5`
- `IL | 02 | Founder` — `6a89f724cdd4b797a395f488`
- `IL | 03 | Curriculum Illustrations` — `6a89f72467ecc8731dc956bb`
- `IL | 04 | Outcome Icons` — `6a89f724ad59e6cfeda7c0e3`
- `IL | 05 | Masterclass` — `6a89f72467bb7ac351890513`
- `IL | 06 | Meta Ads` — `6a89f724898f05a675d53613`
- `IL | 07 | Landing Page` — `6a89f72567ecc8731dc956cd`
- `IL | 99 | Working / Unsorted` — `6a89f725898f05a675d536c6`

Verified Drive source assets:

- Hero electronics/soldering — `1XcTD9nOfdU-yNueSH0Byg663KGVWEFTu`
- Gallery drums/mastery — `17QEa4djLJ6wHXvqokG12CmeICYGFMm1y`
- Gallery group huddle/project — `13h-S8m3h8S5lHFsiq9h6777BWiCRxPbb`
- Gallery outdoor challenge — `15ds42eaLcSN5IXzaEvs5JDOUOtug45jI`
- Gallery Jewish build project — `1eoTKPR_yG6tlTDuCGqRF8ZihGzqVT92k`
- Founder portrait — `1YZ7CPk4U8ZAqT8BoHzHxKwrH4iloyOC1`

Naming note: available Drive files use `_APPROVED`; treat them as the current usable real-media set unless the owner supersedes them.

Missing creative:

- four curriculum module illustrations
- six outcome icons
- real masterclass recording

No stock substitutions.

## Verified in canonical location — Email

Email folder:

- `IL | Inner Leadership` — `6a8a0e75473a54c04100225d`

Hebrew template IDs:

- E00 — `6a8a0ebac3ca7ccb66b7fbb4`
- E01 — `6a8a0eba6b43001bee0641be`
- E02 — `6a8a0ebb17389f8e23f25bd9`
- E03 — `6a8a0ebb17389f8e23f25beb`
- E04 — `6a8a0ebc5111f4c7772fae7b`
- E05 — `6a8a0ebcbc3bac7221ce4f54`
- E06 — `6a8a0ebd17389f8e23f25bf9`
- E07 — `6a8a0ed3897d6716c6ede315`
- E08 — `6a8a0ed3473a54c041002600`
- E09 — `6a8a0ed4c3ca7ccb66b7fc70`
- E10 — `6a8a0ed4473a54c04100262e`
- E11 — `6a8a0ed5c95ab36931c80d26`
- E12 — `6a8a0ed6bc3bac7221ce5036`
- E13 — `6a8a0ed6bc3bac7221ce5043`

English template IDs:

- E00 — `6a8a0eef17389f8e23f25e29`
- E01 — `6a8a0ef0bc3bac7221ce5165`
- E02 — `6a8a0ef0473a54c041002763`
- E03 — `6a8a0ef1e4cb773834812978`
- E04 — `6a8a0ef15111f4c7772fb33e`
- E05 — `6a8a0ef2e4cb773834812992`
- E06 — `6a8a0ef2e4cb7738348129a2`
- E07 — `6a8a0f04bc3bac7221ce52a2`
- E08 — `6a8a0f05c95ab36931c80f2c`
- E09 — `6a8a0f05897d6716c6ede4de`
- E10 — `6a8a0f075111f4c7772fb40d`
- E11 — `6a8a0f078f831e07ce2de27a`
- E12 — `6a8a0f0817389f8e23f25f41`
- E13 — `6a8a0f086b43001bee0644f5`

Email-copy status:

- all 28 templates are shells;
- all 28 bodies require canonical copy insertion;
- all 14 Hebrew subjects require canonical subjects;
- current English subjects are placeholders and must be replaced.

Canonical copy source in this repository:

- `EMAIL_FUNNEL_EN_HE.md`

## Required canonical CRM architecture

Use `GHL_BUILD_SPEC.md` as the exact current build specification for the pipeline, stages, tags, fields, forms, bots, calendar, emails, pages, and workflows.

## Publication gate

Nothing is published until:

- canonical HE/EN copy is installed;
- approved media is installed;
- the real masterclass is uploaded and trackable;
- one Hebrew QA lead passes;
- one English QA lead passes;
- Zoom booking produces a working meeting link;
- stage/state consistency passes;
- zero SMS exists;
- owner explicitly approves publication.
