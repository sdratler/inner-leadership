# Inner Leadership — GHL Build Specification V2

Status: **CURRENT**  
Date: 2026-08-23  
Strategy: **Google-first direct qualification; long masterclass deferred**

## 1. Scope

Build the fastest safe bilingual customer journey for Inner Leadership in the canonical Life Skills location.

### Canonical location

- Name: `Life Skills`
- ID: `9HQEubuu4WWG6xz09yB4`
- Required URL fragment: `/v2/location/9HQEubuu4WWG6xz09yB4/`

Do not use legacy location `pBSnOK2nkdxp6gf9Rg3o`.

## 2. Offer facts

- Brand: Inner Leadership / הנהגה מבפנים.
- Public category: practical emotional therapy / טיפול רגשי מעשי.
- Boys ages 7–13.
- Beit Shemesh.
- Hebrew and English.
- 12 weeks.
- One weekly 50–60-minute individual therapeutic session.
- Two weekly 90-minute therapeutic project labs.
- Three parent-guidance sessions.
- Founding investment: 10,800 NIS total / 3 × 3,600 NIS.
- Two compatible paid boys open a lab.
- Five-boy founding target.
- Ten-boy cap.

## 3. Active acquisition route

### Primary

`Google Search → Landing → Direct Qualification → Thank You / Booking → Consultation → Offer → Payment → Enrollment`

### Secondary

- local referral and organic traffic use the same direct route;
- Meta later uses a 30–45-second direct founder video and the same route;
- the optional 5–6-minute overview is embedded on the landing page and is not gated.

### Deferred

- 35–40-minute masterclass;
- masterclass registration;
- watch threshold;
- masterclass nurture;
- masterclass-concierge bots.

Existing deferred objects remain draft and disconnected. Do not delete them.

## 4. Pipeline

Use the verified pipeline:

- Name: `IL | 12-Week Program`
- ID: `viW1VdaNcQKm1umo67du`

Do not recreate it.

### Active stage path

1. New Lead — `14c685f2-1159-4fd6-b590-6ca2ed0e66fe`
2. Qualification In Progress — `e0d0f542-d3a9-4d68-b99b-a7fd4e37a7c7`
3. Qualified — `9c8cae17-b7ea-40cc-b0d6-d0228df2a60b`
4. Human Review — `25a60f89-52bd-4588-bb45-514f02bc09cb`
5. Consultation Booked — `aa65d2ba-d7bb-4ff6-b8e1-b3019da74276`
6. Consultation Attended — `a3b9c773-5599-4f2c-95fd-859ec4b41a62`
7. Offer / Decision — `34c3a473-cbdf-4a5d-b825-fea7e46ff5db`
8. First Payment Received — `5a512f7d-eb6b-4e97-97c5-cddfa7e2ac4a`
9. Enrolled — Cohort Assigned — `c40c10ca-d96a-42b1-945d-1157096c875c`

Alternative outcomes:

- Nurture / Next Cohort — `9b4aaf79-7f6b-4156-ae0a-92e0524334a8`
- Not Fit / Closed — `2be778aa-3d2d-4607-9fb6-b6d22451f2c9`

Dormant stages:

- Masterclass Registered — `a5204d3c-5136-4b41-b07d-bd1b84638d16`
- Masterclass Engaged — `afd27be9-3d94-495f-a600-4388ef98331a`

Do not route new leads through dormant stages. Do not delete or rename them during the speed launch.

## 5. Tags and fields

Reuse the verified 31 canonical tags and 22 `contact.il_*` fields in `GHL_CURRENT_STATE.md`.

### Active tags

Use:

- language Hebrew / English;
- source Google / website / referral / direct / Facebook / Instagram as applicable;
- interest 12-week program;
- qualification in progress / qualified / human review / nurture / not fit;
- consultation booked / attended / no show / cancelled;
- offer made;
- first payment received;
- program enrolled / completed / withdrawn;
- founding cohort.

### Dormant tags and fields

Do not use:

- bot-state pre/post-masterclass;
- interest masterclass;
- masterclass registered/engaged/completed;
- masterclass engagement percentage/date.

Do not delete them.

## 6. Funnel

Use one existing/current-location funnel named:

`IL | Public Funnel`

Before creation, search exact name in the Life Skills Sites UI and read back its ID and steps. A candidate was previously visible. Never create a duplicate before that readback.

### Active steps

1. `IL | HE | Landing`
2. `IL | HE | Qualification`
3. `IL | HE | Thank You`
4. `IL | EN | Landing`
5. `IL | EN | Qualification`
6. `IL | EN | Thank You`

If the current funnel contains Masterclass Registration or Masterclass Watch steps:

- keep them draft;
- prefix their visible internal names with `DEFERRED |` only if safe and unambiguous;
- remove active links, navigation and redirects to them;
- do not delete them;
- report their IDs.

### Landing-page behavior

- primary CTA goes to the same-language direct qualification step;
- secondary CTA scrolls to or opens the optional program-overview video;
- price appears before the qualification CTA and again immediately before the form;
- no email gate before viewing the program overview;
- no masterclass CTA;
- preserve UTMs and GCLID where supported;
- Hebrew is fully RTL and mobile-first.

### Program-overview video

- placeholder is allowed for draft build;
- absence does not block the form or direct launch;
- once uploaded, embed without autoplay audio;
- no engagement workflow or threshold.

## 7. Forms

### A. `IL | HE | Direct Qualification`

Hebrew labels and RTL. Collect:

- full name;
- email;
- phone;
- preferred language;
- son age;
- city;
- current framework;
- primary goal;
- social/group context;
- project interest;
- travel to Beit Shemesh;
- maximum travel time;
- weekly schedule fit;
- parent-session commitment;
- financial fit after displaying 10,800 NIS / 3 × 3,600 NIS;
- hidden source detail and attribution values where supported.

### B. `IL | EN | Direct Qualification`

Same logical fields in English.

### C. `IL | Shared | Confidential Intake`

Post-payment only. It is not public and does not send confidential answers to advertising platforms.

### Form redirects

- qualification form → same-language Thank You;
- Thank You displays clear next step;
- qualified path offers the canonical calendar;
- human-review path confirms personal review and does not promise acceptance.

## 8. Qualification logic

Use current custom-field option values exactly as configured; do not invent duplicate fields.

### Clear fit

A lead may be routed Qualified when:

- age is within 7–13;
- travel is yes or practically workable;
- schedule is yes or workable;
- parent participation is accepted;
- financial structure is accepted;
- no answer creates an obvious safety/scope mismatch.

### Human review

Use Human Review for uncertainty, mixed answers or an age/structure issue that may still be discussable.

### Not fit

Do not auto-reject from ambiguous free text. Use Not Fit only for a clear hard mismatch or manual decision.

## 9. Calendar

Use existing:

- `IL | Parent Consultation`
- ID `KIUGS5BkjlpF5F8ryvg8`
- owner `uyhQVFp0ixFvGrKOKCrK`
- slug `il-parent-consultation`

Requirements:

- Zoom fixed location;
- no Google/Outlook conflict calendar;
- no Look Busy;
- no SMS;
- no WhatsApp automation;
- final availability owner-approved;
- one complete test booking proves the Zoom link.

## 10. Workflows

All workflows remain draft/off until final QA and owner approval.

### W01 — New Lead Routing

`W01 | IL | New Lead Routing`

- normalize language and source;
- add `interest | 12-week program`;
- set source detail and ad market when available;
- create/update one opportunity in New Lead;
- prevent duplicates;
- no customer email unless a completed form or explicit opt-in triggered the workflow.

### W02 — Direct Qualification Intake

`W02 | IL | Direct Qualification Intake`

Triggers:

- HE direct qualification submitted;
- EN direct qualification submitted.

Actions:

- apply language/source/program-interest tags;
- set funnel state and qualification status;
- move/create opportunity at Qualification In Progress;
- evaluate clear fit versus Human Review;
- send E00 in the correct language;
- create immediate internal review task/notification;
- preserve UTM/GCLID/source detail;
- never touch masterclass stages or tags.

### W03 — Fast Lead Response

`W03 | IL | Fast Lead Response`

- trigger on completed direct qualification from Google/website/referral;
- create an internal task to review promptly;
- notify the owner internally with parent name, city, age and nonclinical fit summary;
- never send SMS/WhatsApp;
- no diagnosis data in the notification;
- stop when booked, not fit or enrolled.

### W04 — Qualification Started

`W04 | IL | Qualification Started`

Use existing shell ID `d450fc35-530b-4143-a5c0-28b81850de7d`.

- rename/repair rather than recreate;
- use only if GHL can reliably detect a meaningful start event;
- set Qualification In Progress and the in-progress tag;
- do not make this a launch blocker if partial-form tracking is unavailable.

### W05 — Qualification Outcome

`W05 | IL | Qualification Outcome`

Use existing shell ID `10d4cb09-cf3b-47ed-8e0a-d60aaeeb313f`.

Branches:

- Qualified → Qualified stage/tag, next action Book Consultation, send E01/E09 according to timing;
- Human Review → Human Review stage/tag, send E08;
- Nurture → Nurture stage/tag;
- Not Fit → Not Fit stage/tag;
- always remove incompatible status tags.

### W06 — Consultation

`W06 | IL | Consultation`

- booking → Consultation Booked stage/tag;
- send confirmation/reminder using email only;
- attendance → Consultation Attended;
- cancellation/no-show → correct tag and E11/reschedule path;
- no SMS/WhatsApp.

### W07 — Offer

`W07 | IL | Offer`

- manual offer trigger;
- Offer / Decision stage;
- offer-made tag;
- send E12 with canonical payment/enrollment link;
- no automatic offer based only on form answers.

### W08 — Payment & Enrollment

`W08 | IL | Payment & Enrollment`

- first payment trigger;
- First Payment Received stage/tag;
- send E13;
- route to confidential intake;
- after required enrollment actions, move to Enrolled — Cohort Assigned and apply founding-cohort tag;
- payment automation may remain manual/deferred if no verified webhook exists.

### W09 — Direct Program Nurture

`W09 | IL | Direct Program Nurture`

- replaces Masterclass Nurture;
- sends E02–E07 to opted-in, not-booked/not-enrolled leads;
- links to the program page, qualification and calendar as appropriate;
- stop on booking, not fit, withdrawal or enrollment;
- no masterclass links.

### W10 — Data Hygiene

`W10 | IL | Data Hygiene`

- remove incompatible status tags;
- maintain one active IL opportunity per contact/program cycle;
- preserve source attribution;
- do not merge/delete records automatically;
- flag missing source/language/status for review.

## 11. Email templates

Keep all 28 existing records. Install exact V3 copy from `EMAIL_FUNNEL_EN_HE.md`.

Masterclass placeholders are prohibited in active templates. Required links:

- program page;
- direct qualification;
- calendar;
- meeting details;
- reschedule;
- payment/enrollment;
- confidential intake;
- schedule/details.

## 12. KBs, bots and widgets

### Phase 1 launch

- no public bot required;
- no public widget required;
- neither may block the Hebrew Search launch.

### Phase 2 optional

- `IL | KB | Program | HE`
- `IL | KB | Program | EN`
- optionally one HE and one EN program FAQ/qualification assistant;
- one HE and one EN widget only if later approved;
- all draft/off until separately tested.

Do not recreate the previous four-bot masterclass architecture.

## 13. Media

Required for first launch:

- real founder portrait;
- approved real program proof images;
- optional video placeholder or uploaded 5–6-minute overview.

Not launch blockers:

- long masterclass recording;
- masterclass thumbnail;
- full curriculum illustration set;
- full icon set;
- Meta creative.

No stock substitutions and no AI-generated founder identity.

## 14. Tracking

Capture and QA:

- UTM source/medium/campaign/content/term;
- GCLID when supported;
- `IL Source Detail`;
- `IL Ad Market`;
- direct qualification completion;
- consultation booking/attendance;
- offer;
- first payment;
- enrollment.

Do not pass free-text clinical or sensitive information to Google/Meta.

## 15. Publication sequence

### Minimum Hebrew Search launch

1. Read back and repair the current `IL | Public Funnel` candidate.
2. Complete HE Landing, Qualification and Thank You.
3. Build/verify HE Direct Qualification.
4. Install price-transparent copy.
5. Patch HE lifecycle templates.
6. Build/repair W01, W02, W03, W04, W05, W06, W09 and W10 as needed for the route.
7. Bind and test Zoom calendar.
8. Install and test Google conversion tracking.
9. Run one Hebrew test lead from click parameters through booking.
10. Confirm zero SMS/WhatsApp and nothing else published.
11. Obtain explicit owner approval.
12. Publish the Hebrew route and then activate Google Search.

English, Meta and optional AI components may follow without delaying the first Hebrew campaign.

## 16. Worker report

Every worker returns:

1. confirmed Life Skills location ID;
2. exact names and IDs;
3. `CREATED / UPDATED / VERIFIED / BLOCKED` delta;
4. draft/published state;
5. dependencies and blockers;
6. duplicate candidates left untouched;
7. manual actions required;
8. confirmation nothing was sent or published;
9. confirmation zero SMS/WhatsApp;
10. run-ledger writeback status.
