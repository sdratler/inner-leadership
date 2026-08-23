# Inner Leadership — GHL Audit Reconciliation

Date: 2026-08-23  
Status: **CURRENT AUDIT INTERPRETATION**  
Canonical location: `Life Skills` — `9HQEubuu4WWG6xz09yB4`  
Legacy location: `pBSnOK2nkdxp6gf9Rg3o` — read-only / do not use

This record preserves the accepted audit facts and applies the 2026-08-23 acquisition pivot. It does not replace `GHL_CURRENT_STATE.md`.

## 1. Acquisition override

The current active route is:

**Google Search → price-transparent landing page → direct practical qualification → parent consultation → manual offer → first payment → enrollment**

The following prior requirements are now superseded:

- Meta-first launch;
- long masterclass as the value event;
- Masterclass Registration/Watch as required public steps;
- 5% video-engagement gating;
- masterclass-specific nurture;
- four bots/two widgets as publication blockers;
- real long-masterclass recording as a publication blocker.

Existing masterclass pipeline stages, tags, fields, pages, media folders and scripts remain preserved as dormant/history. No deletion is authorized.

## 2. Accepted current facts

### CRM foundation

The canonical Life Skills location contains the complete required child-program CRM foundation:

- pipeline `IL | 12-Week Program` — `viW1VdaNcQKm1umo67du`;
- all 13 canonical stages;
- all 31 canonical child-program `il |` tags;
- all 22 canonical `contact.il_*` fields.

Additional IL-prefixed adult/assessment assets and double-underscore clinical fields exist. They are protected extras and must not be used in the 12-week boys funnel without an explicit later decision.

### Dormant CRM objects

Preserve but do not use on the active route:

- stage `Masterclass Registered` — `a5204d3c-5136-4b41-b07d-bd1b84638d16`;
- stage `Masterclass Engaged` — `afd27be9-3d94-495f-a600-4388ef98331a`;
- masterclass interest/state/engagement tags;
- `IL Masterclass Engagement Pct` and `IL Masterclass Engaged At` fields.

The active stage path begins at New Lead and moves directly to Qualification In Progress.

### Workflows

Canonical Life Skills shells:

- W04 shell `Qualification Started Workflow` — `d450fc35-530b-4143-a5c0-28b81850de7d` — draft; rename/repair required.
- W05 shell `IL Qualification Outcome` — `10d4cb09-cf3b-47ed-8e0a-d60aaeeb313f` — draft; rename/repair required.

Legacy W01/W02 exist only in the legacy location and their IDs must never be reused.

Required current direct-funnel workflows:

- W01 New Lead Routing;
- W02 Direct Qualification Intake;
- W03 Fast Lead Response;
- W04 Qualification Started;
- W05 Qualification Outcome;
- W06 Consultation;
- W07 Offer;
- W08 Payment & Enrollment;
- W09 Direct Program Nurture;
- W10 Data Hygiene.

There is no current W03 video-engagement workflow requirement.

### Calendar

Canonical calendar:

- `IL | Parent Consultation` — `KIUGS5BkjlpF5F8ryvg8`;
- 25-minute working draft, 30-minute interval;
- owner `uyhQVFp0ixFvGrKOKCrK`;
- slug `il-parent-consultation`;
- no public open hours;
- no Google/Outlook conflict calendar;
- no SMS/WhatsApp/native reminder sequence.

A Zoom account appears connected at the location level, while calendar binding/test booking remains unresolved. Treat this as a binding/QA issue. Do not reauthorize without owner approval.

### Funnel and forms

A direct UI audit displayed an `IL | Public Funnel` candidate in Life Skills, contradicting an earlier API zero-result. Current accepted state:

- candidate present in UI;
- exact funnel ID unverified;
- existing step IDs and form embedding unverified;
- no duplicate may be created before exact readback.

Desired active public steps:

1. HE Landing;
2. HE Qualification;
3. HE Thank You;
4. EN Landing;
5. EN Qualification;
6. EN Thank You.

Any existing Masterclass Registration/Watch steps remain draft, disconnected and preserved.

Desired active forms:

- HE Direct Qualification;
- EN Direct Qualification;
- Shared Confidential Intake.

### Email

Life Skills contains 28 E00–E13 template records in Hebrew and English. On 2026-08-23, all 28 were verified against the then-current masterclass-first copy.

The acquisition pivot makes that installed copy operationally stale. Current status:

- 28 record IDs: VERIFIED;
- V3 direct-funnel canonical copy in GitHub: CURRENT;
- live GHL subject/body patch: NOT YET VERIFIED;
- workflow attachment: NOT YET VERIFIED;
- no template should send until direct links and QA are complete.

Do not recreate the templates. Patch the existing IDs from `EMAIL_FUNNEL_EN_HE.md` V3.

### Bots, knowledge bases and widgets

Canonical Life Skills direct UI:

- Conversation AI agents: zero;
- Voice AI agents: zero;
- Chat Widgets: zero;
- one unrelated Knowledge Base `Existing knowledge base` — `A3jlU85MYs5IORNw4Gjn`.

This is not a launch defect. Public bots/widgets are deferred and must not delay the Hebrew Search route. The unrelated KB remains untouched.

### Media

Canonical GHL media folder scaffold exists. Approved real assets remain in Drive.

For the first Hebrew Search launch, missing long-masterclass media, curriculum illustrations and outcome icons are not blockers. The optional 5–6-minute overview may be added later without gating qualification.

## 3. Audit conclusions that remain rejected

### Truncated custom-field absence claims

Earlier API responses were truncated. Claims that canonical fields were missing are invalidated by the later 22/22 readback.

### Inflated tag/field counts as canonical architecture

Totals that include adult/assessment extras do not change the canonical boys-program count of 31 tags and 22 fields.

### Google Drive conclusively nonfunctional

Connection metadata and functional navigation conflicted. Test the actual Drive picker/KB import before reauthorizing.

### Zoom conclusively expired

Location-level connection evidence and calendar-level binding evidence conflicted. Treat this as unresolved binding/QA, not proof of expiration.

### Missing phone, WhatsApp or Google Calendar as blockers

Their absence is intentional:

- no SMS;
- no WhatsApp automation;
- no Google/Outlook conflict calendar.

### Funnel absent in Life Skills

Direct UI evidence supersedes the earlier zero-result API call. Read back the candidate; do not create a duplicate.

## 4. Current execution order

1. Read back the Life Skills `IL | Public Funnel`, all steps, forms, paths and IDs.
2. Complete the active Hebrew route: Landing → Direct Qualification → Thank You / Booking.
3. Preserve/disconnect old masterclass steps.
4. Build or repair HE Direct Qualification with price before submission.
5. Patch the existing 28 email templates to V3 direct copy.
6. Build W01–W03; repair W04/W05; build W09/W10.
7. Bind/test the canonical consultation calendar and build W06–W08.
8. Install/test Google conversion tracking.
9. Run one complete Hebrew test lead with Google-like parameters.
10. Stop for explicit owner approval before publication, public calendar availability, external sends or spend.
11. Add English, Meta and optional AI components after the Hebrew route works.

## 5. Current blockers

Real blockers to the first Hebrew Search publication are limited to:

- exact funnel/form readback and completion;
- price-transparent Hebrew page installation;
- direct qualification routing;
- current lifecycle email patch and link resolution;
- calendar/Zoom test booking;
- Google conversion QA;
- privacy/terms and owner-approved public details;
- explicit owner approval to publish and spend.

The long masterclass, masterclass thumbnail, Meta campaign, bots, widgets and full illustration/icon set are not blockers.

## 6. Safety state

- Nothing was deleted by the strategy update.
- Nothing was published by the strategy update.
- No external email was sent.
- No SMS or WhatsApp automation was created.
- No ad spend was authorized.
