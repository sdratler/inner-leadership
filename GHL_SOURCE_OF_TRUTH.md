# Inner Leadership — GHL Source of Truth

Status: **CURRENT**  
Date: 2026-08-23  
Acquisition version: **Google-first direct qualification**

## Authority

1. `ACQUISITION_PIVOT_2026-08-23.md` controls acquisition strategy.
2. Live GHL readback controls exact object existence, IDs and draft/published state.
3. `GHL_CURRENT_STATE.md` is the current verified registry.
4. `GHL_BUILD_SPEC.md` is the desired architecture.
5. `GHL_PROMPT_LIBRARY.md` contains the executable worker prompts.
6. GitHub `main` is the version-controlled mirror; the Drive GHL control document is the AI-readable operational copy.

## Canonical location

- GHL location name: `Life Skills`
- Location ID: `9HQEubuu4WWG6xz09yB4`
- Required URL fragment: `/v2/location/9HQEubuu4WWG6xz09yB4/`

Legacy location `pBSnOK2nkdxp6gf9Rg3o` is read-only. Never use its IDs in the Life Skills build.

## Canonical offer

**Inner Leadership / הנהגה מבפנים**

- practical emotional therapy for boys ages 7–13;
- Beit Shemesh;
- Hebrew and English;
- one weekly 50–60-minute individual therapeutic session;
- two weekly 90-minute therapeutic project labs;
- three parent-guidance sessions;
- 12 weeks;
- 10,800 NIS total, paid as 3 × 3,600 NIS;
- two compatible paid boys open the first lab;
- five-boy founding target;
- ten-boy cap.

## Current active funnel

**Google Search → landing page → direct practical qualification → parent consultation → offer → first payment → enrollment**

### Active public steps

- `IL | HE | Landing`
- `IL | HE | Qualification`
- `IL | HE | Thank You`
- `IL | EN | Landing`
- `IL | EN | Qualification`
- `IL | EN | Thank You`

### Active forms

- `IL | HE | Direct Qualification`
- `IL | EN | Direct Qualification`
- `IL | Shared | Confidential Intake`

### Active CTAs

- Hebrew: `בדקו אם התהליך מתאים לבן שלכם`
- Hebrew secondary: `צפו בהסבר קצר על התהליך`
- English: `Check whether the treatment fits your son`
- English secondary: `Watch the short program overview`

The exact investment must appear before the public qualification form.

## Video decision

- 30–45-second direct founder video: active creative.
- 5–6-minute program overview: optional landing-page asset.
- 35–40-minute masterclass: deferred/history.
- no video-engagement threshold;
- no watch gate;
- no masterclass requirement in the publication gate.

If old Masterclass Registration or Masterclass Watch steps exist, keep them draft and disconnected. Do not delete them during the speed launch.

## CRM preservation

The verified 13-stage pipeline, 31 canonical tags and 22 `contact.il_*` fields remain the CRM foundation.

Masterclass-specific stages, tags and fields are dormant. Do not delete, recreate or route active leads through them.

Active stage path:

`New Lead → Qualification In Progress → Qualified or Human Review → Consultation Booked → Consultation Attended → Offer / Decision → First Payment Received → Enrolled — Cohort Assigned`

Alternative outcomes:

- `Nurture / Next Cohort`
- `Not Fit / Closed`

## Workflows

- `W01 | IL | New Lead Routing`
- `W02 | IL | Direct Qualification Intake`
- `W03 | IL | Fast Lead Response`
- `W04 | IL | Qualification Started`
- `W05 | IL | Qualification Outcome`
- `W06 | IL | Consultation`
- `W07 | IL | Offer`
- `W08 | IL | Payment & Enrollment`
- `W09 | IL | Direct Program Nurture`
- `W10 | IL | Data Hygiene`

Everything stays draft/off until explicit publication approval.

## Email

Keep the existing 28 E00–E13 Hebrew/English template records and IDs. Replace masterclass-first subjects and bodies with `EMAIL_FUNNEL_EN_HE.md`. Do not recreate the templates.

## Bots, KBs and widgets

They are not launch blockers.

- zero public bots required for first launch;
- zero public chat widgets required for first launch;
- two language KBs may remain draft for later program FAQ use;
- old masterclass-concierge bot plans are deferred.

## Calendar

Use the existing canonical `IL | Parent Consultation` calendar. Zoom binding and one complete test booking must pass before publication. No Google/Outlook conflict calendar, no Look Busy, no SMS, no WhatsApp automation.

## Permanent rules

- exact-name check before creation;
- inspect and reuse the current-location asset before creating a duplicate;
- no deletion during active build;
- no publication without explicit owner approval;
- no email send during build/QA without explicit approval;
- no SMS;
- no WhatsApp automation;
- do not touch One Time, BNA, SG, adult-assessment or double-underscore clinical assets;
- no broad re-audit when a scoped readback is sufficient;
- no stock substitutions;
- no sensitive clinical history in public forms;
- every worker returns exact IDs and a `CREATED / UPDATED / VERIFIED / BLOCKED` delta;
- every worker writes its result to the canonical run ledger or reports `WRITEBACK_BLOCKED`.

## Publication gate

The first Hebrew Google route may publish after:

- current Hebrew copy installed;
- price shown before qualification;
- direct form and redirects tested;
- one contact and one opportunity created correctly;
- qualified/human-review routing tested;
- canonical calendar and Zoom booking tested;
- lifecycle emails linked and tested without masterclass placeholders;
- Google conversion action tested;
- privacy/terms present;
- zero SMS/WhatsApp;
- owner explicitly approves publication and ad spend.

English, Meta, bots, widgets, long-form video, curriculum illustrations and outcome icons are not blockers for the first Hebrew Search launch unless the owner explicitly makes them blockers.
