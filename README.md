# Life Skills

Canonical repository for one bilingual private-practice application and its public acquisition site.

## Current product

Life Skills supports Rabbi Shloimie Dratler’s hands-on emotional-therapy practice for boys ages 8–12, with secondary adult-client support inside the same private application.

The active child offer is a 12-week program containing:

- 12 weekly 60-minute individual meetings;
- 24 project labs, two 90-minute labs each week;
- three parent-guidance meetings at the beginning, middle and end;
- practitioner-controlled goals, commitments and check-ins;
- forms and resources;
- monthly professional progress reporting;
- schedule, attendance and payment tracking.

Current child price: **₪13,500**, paid as **3 × ₪4,500**.

Cohorts start after four compatible paid boys and target a maximum of five. Initial location is Beit Shemesh; another city is not promised until fit, location, staffing, insurance and economics are confirmed.

Adult work is not publicly advertised. Current adult rate remains ₪450 per session.

## Accounts

- One practitioner account in the first release.
- One shared family account per minor case; no separate parent accounts.
- Optional practitioner-enabled child login.
- Adult client owns the adult account.
- Parent visibility is set per shareable item: private, title/completion, or full item.

## Product principles

- This is not a school or classroom platform.
- This is not a general messaging system.
- No self-booking or client cancellation button.
- No badges, points, streaks, trophies, levels, leaderboards, prizes, rankings, confetti or gamification.
- Child progress is practitioner-assessed and family-facing through four professional domains plus individualized contextual targets.
- Therapeutically relevant parent observations/updates live in the app; administrative reminders use WATI.
- Raw audio is deleted 30 days after transcript approval unless deliberately retained.
- AI output remains draft-only until practitioner approval.

## Current source of truth

Start here:
https://docs.google.com/document/d/1XZS-MzUtjc3T488lyrSbtDX0Yq5UCl7Wzh5uN_YOvMg/edit

Repository agent rules:
[`AGENTS.md`](AGENTS.md)

Drive source registry:
[`docs/DRIVE_SOURCES.md`](docs/DRIVE_SOURCES.md)

Build-control snapshot:
[`docs/BUILD_CONTROL.md`](docs/BUILD_CONTROL.md)

Product snapshot:
[`docs/PRODUCT_CONTRACT.md`](docs/PRODUCT_CONTRACT.md)

UI snapshot:
[`docs/UI_SYSTEM.md`](docs/UI_SYSTEM.md)

Merge-packet standard:
[`docs/MERGE_PACKET_STANDARD.md`](docs/MERGE_PACKET_STANDARD.md)

Live Build Control:
https://docs.google.com/spreadsheets/d/1Y_Vf_kipj7mAhhEnuj8F2L85v3KpOi_V9KfSrj4MZ4Y/edit

## Repository state

The verified legacy `main` head used to begin this planning branch was:

`ccca0251287f3aed04ca6677290abfdb888f229d`

Legacy `main` contains the earlier static marketing/GHL system. It has not been deleted or declared to be the new private application. The first active work item is `LS-000 — Repository & Foundation Convergence`, which must inspect all branches and deployment evidence, preserve useful legacy assets, and establish a verified application foundation branch before parallel feature work.

## Privacy

No real client names, identifiable minors, private family disclosures, assessments, recordings, transcripts, credentials, secrets, database rows or production tokens belong in Git, prompts, merge packets, screenshots or logs.

Current code may be public only while it contains code and non-sensitive documentation exclusively. Private repository visibility is strongly preferred before clinical application operation.
