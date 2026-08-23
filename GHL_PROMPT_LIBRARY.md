# Inner Leadership — GHL Prompt Library

Status: CURRENT
Wave: Foundation rebuild in canonical Life Skills location
Date: 2026-08-23

Before using any prompt, read:

1. `GHL_SOURCE_OF_TRUTH.md`
2. `GHL_CURRENT_STATE.md`
3. `GHL_BUILD_SPEC.md`

These four prompts are designed to run simultaneously in four separate GHL Ask AI/browser windows.

---

## Window A — CRM foundation + W04/W05 repair

```text
PROCEED NOW. This prompt is explicit approval to create the missing canonical Inner Leadership CRM foundation. Do not stop for another approval gate.

WORK ONLY IN:
Life Skills
Location ID: 9HQEubuu4WWG6xz09yB4

Before any write, verify the URL contains:
/v2/location/9HQEubuu4WWG6xz09yB4/

Read these files from GitHub main in sdratler/inner-leadership:
- GHL_SOURCE_OF_TRUTH.md
- GHL_CURRENT_STATE.md
- GHL_BUILD_SPEC.md

Those files are authoritative. Do not use the old pBS location or SG-prefixed assets as substitutes.

PERMANENT RULES:
- exact-name check before creating;
- no deletes;
- no publishing;
- no SMS;
- no WhatsApp automation;
- do not touch One Time or BNA;
- keep all workflows draft;
- use API/natural-language builder where possible.

TASK 1 — CREATE THE COMPLETE CRM FOUNDATION

The prior proposed reduced build of 10 fields, 4 tags, and 5 stages is NOT sufficient.

Create exactly what GHL_BUILD_SPEC.md defines:

A. One pipeline:
IL | 12-Week Program

B. All 13 stages, in the exact order in GHL_BUILD_SPEC.md.

C. All 31 exact `il |` tags in GHL_BUILD_SPEC.md.

D. All 22 exact `contact.il_*` custom fields, with the exact display names, types, keys, and option values in GHL_BUILD_SPEC.md.

Do not rename or alter:
- SG-01 Self-Governance Enrollment
- contact.sg_* fields
- sg-* tags

If an exact IL object already exists by the time you reach it, reuse it and record its ID rather than creating a duplicate.

TASK 2 — VERIFY THE FOUNDATION

After creation, fetch/read back:
- pipeline ID;
- all 13 stage IDs;
- all 31 tag IDs;
- all 22 field IDs and keys.

Confirm the counts are exactly 1 pipeline, 13 stages, 31 tags, and 22 fields.

TASK 3 — REPAIR THE TWO EXISTING DRAFT WORKFLOWS

Existing current-location shells:
- d450fc35-530b-4143-a5c0-28b81850de7d
- 10d4cb09-cf3b-47ed-8e0a-d60aaeeb313f

Repair the first and rename it exactly:
W04 | IL | Qualification Started

Use current-location objects only.
Trigger when IL Qualification Status becomes In Progress or the supported qualification-start state is applied.
Actions:
- add `il | qualification | in progress`;
- set IL Funnel State = Qualification In Progress;
- set IL Next Action = Complete Qualification;
- create/update ONE opportunity in IL | 12-Week Program at Qualification In Progress;
- never duplicate an active IL opportunity.

Repair the second and rename it exactly:
W05 | IL | Qualification Outcome

Trigger when IL Qualification Status updates.
Branches:
- Qualified → add qualified tag; stage Qualified; IL Funnel State = Qualified; IL Next Action = Book Consultation.
- Human Review → add human-review tag; stage Human Review; IL Funnel State = Human Review; IL Next Action = Human Review.
- Nurture → add nurture tag; stage Nurture / Next Cohort; IL Funnel State = Nurture / Next Cohort; IL Next Action = Nurture.
- Not Fit → add not-fit tag; stage Not Fit / Closed; IL Funnel State = Not Fit / Closed; IL Next Action = Closed.

Do not automatically offer enrollment. Human fit decision remains human.

Keep W04 and W05 draft/unpublished.

RETURN A CLEAN COMPLETION REPORT:
1. confirmed location ID;
2. pipeline name + ID;
3. all 13 stage names + IDs in order;
4. all 31 tag names + IDs;
5. all 22 field display names + keys + IDs + types;
6. W04 final name + ID + trigger/action summary;
7. W05 final name + ID + branch summary;
8. any exact failure/blocker;
9. duplicate candidates left untouched;
10. confirmation no SG object was altered;
11. confirmation nothing was published;
12. confirmation zero SMS/WhatsApp was added;
13. a concise delta grouped as CREATED / UPDATED / VERIFIED / BLOCKED.
```

---

## Window B — Calendar + W06/W07/W08/W10

```text
PROCEED NOW. Do not ask for another approval gate.

WORK ONLY IN:
Life Skills
Location ID: 9HQEubuu4WWG6xz09yB4

Verify URL contains:
/v2/location/9HQEubuu4WWG6xz09yB4/

Read from GitHub main:
- GHL_SOURCE_OF_TRUTH.md
- GHL_CURRENT_STATE.md
- GHL_BUILD_SPEC.md

Do not use legacy calendar IDs from pBSnOK2nkdxp6gf9Rg3o.
Do not modify these current-location noncanonical calendars:
- SG-01 Parent Consultation — NNYMfaDAlrtsxSQKvMPm
- Shloimie Dratler's Personal Calendar — P2DIOgdMZ4ci5PZype1I

No deletes. No publish. No SMS. No WhatsApp.

TASK 1 — CREATE THE CANONICAL CALENDAR

Exact-name check:
IL | Parent Consultation

If absent, create exactly one Personal Booking Calendar with:
- exact name: IL | Parent Consultation;
- owner: uyhQVFp0ixFvGrKOKCrK;
- slug: il-parent-consultation if available;
- Zoom meeting location;
- no Google Calendar;
- no Outlook Calendar;
- no external conflict calendar;
- Look Busy OFF;
- SMS OFF;
- WhatsApp OFF;
- no native email reminder sequence;
- unpublished.

Working technical draft values, used only so the draft can be saved:
- 25-minute duration;
- 30-minute interval;
- one appointment per slot;
- auto-confirm on;
- recurring off.

Do not expose unapproved availability. Leave availability unpublished/owner-review. If GHL technically requires an availability schedule, use the least-public draft/default setting and explicitly report it for owner review.

Verify Zoom OAuth in THIS location. If not connected, report the smallest exact manual click path; do not substitute a custom/empty meeting location.

TASK 2 — BUILD DEPENDENT WORKFLOWS IF FOUNDATION NOW EXISTS

After the calendar is created, exact-name check for the complete IL pipeline/tags/fields from GHL_BUILD_SPEC.md. Another parallel window is creating them.

If the complete foundation is present, build these four workflows as draft. If not yet present, finish the calendar and report BLOCKED_BY_FOUNDATION without guessing.

W06 | IL | Consultation
- scope every appointment trigger only to IL | Parent Consultation;
- booked: apply booked tag, stage Consultation Booked, matching funnel state/next action;
- wait until 24 hours before appointment and send E10 by preferred language;
- HE E10 ID: 6a8a0ed4473a54c04100262e;
- EN E10 ID: 6a8a0f075111f4c7772fb40d;
- attended: attended tag + Consultation Attended stage/state;
- no show: no-show tag + E11 by language;
- HE E11 ID: 6a8a0ed5c95ab36931c80d26;
- EN E11 ID: 6a8a0f078f831e07ce2de27a;
- cancelled: cancelled tag;
- email only;
- no duplicate opportunity.

W07 | IL | Offer
- trigger ONLY when a human explicitly applies `il | offer | made` or the deliberate manual offer state;
- never trigger merely from consultation attendance;
- stage Offer / Decision;
- set funnel state/next action;
- send E12 by language;
- HE E12 ID: 6a8a0ed6bc3bac7221ce5036;
- EN E12 ID: 6a8a0f0817389f8e23f25f41.

W08 | IL | Payment & Enrollment
- first-payment tag → stage/state First Payment Received and E13 by language;
- HE E13 ID: 6a8a0ed6bc3bac7221ce5043;
- EN E13 ID: 6a8a0f086b43001bee0644f5;
- enrolled tag/manual assignment → Enrolled — Cohort Assigned;
- populate cohort/program cycle only with actual values;
- no payment webhook; Green Invoice remains deferred.

W10 | IL | Data Hygiene
- event-driven consistency only;
- sync language field/tag;
- sync clear qualification/consultation/payment state and stage;
- guard against duplicate active IL opportunities;
- add a review note rather than delete uncertain duplicates;
- exclude One Time/BNA;
- never overwrite deliberate human-review/fit decisions;
- never delete anything.

RETURN:
1. location ID;
2. calendar name + ID + slug;
3. owner, duration, interval, location, Zoom status, availability state;
4. untouched calendar candidates;
5. W06/W07/W08/W10 names + IDs + status, or exact BLOCKED_BY_FOUNDATION;
6. exact manual clicks required;
7. confirmation nothing published;
8. confirmation zero SMS/WhatsApp;
9. CREATED / UPDATED / VERIFIED / BLOCKED delta.
```

---

## Window C — Funnel, forms, W01/W02

```text
PROCEED NOW. This prompt authorizes the missing draft funnel and forms in the canonical location.

WORK ONLY IN:
Life Skills
Location ID: 9HQEubuu4WWG6xz09yB4

Verify URL contains:
/v2/location/9HQEubuu4WWG6xz09yB4/

Read from GitHub main:
- GHL_SOURCE_OF_TRUTH.md
- GHL_CURRENT_STATE.md
- GHL_BUILD_SPEC.md
- WEBSITE_COPY_EN_HE.md

The repository's old generated static HTML is reference/archive and may contain old offer facts. Do not copy from it. Use WEBSITE_COPY_EN_HE.md and GHL_BUILD_SPEC.md.

No deletes. No publish. No SMS. No WhatsApp. No legacy IDs.
Use GHL AI page/form/workflow builder whenever possible.

TASK 1 — CREATE THE STANDARD FUNNEL

Exact-name check:
IL | Public Funnel

If absent, create exactly one standard funnel with these ten draft steps in order:
1. IL | HE | Landing
2. IL | HE | Masterclass Registration
3. IL | HE | Masterclass Watch
4. IL | HE | Qualification
5. IL | HE | Thank You
6. IL | EN | Landing
7. IL | EN | Masterclass Registration
8. IL | EN | Masterclass Watch
9. IL | EN | Qualification
10. IL | EN | Thank You

Use canonical HE/EN landing copy from WEBSITE_COPY_EN_HE.md.

Landing-page structure:
- hero;
- what the program is;
- who it is for;
- three delivery components;
- six outcomes;
- method;
- real-work gallery;
- four curriculum modules;
- parent strategy sessions;
- founder;
- program details/investment;
- FAQ;
- masterclass CTA.

Use the verified real Drive assets from GHL_CURRENT_STATE.md for hero/gallery/founder when the Drive picker is available.
Do not use stock substitutions.
The four curriculum illustrations and six icons are missing: keep those sections text-first or leave clean unfilled media slots in draft; do not insert random placeholders.
The masterclass video is missing: create the watch-page structure but do not insert a fake video.

TASK 2 — CREATE FIVE FORMS

Exact names:
- IL | HE | Masterclass Registration
- IL | EN | Masterclass Registration
- IL | HE | Qualification Fallback
- IL | EN | Qualification Fallback
- IL | Shared | Confidential Intake

Use the exact field mappings in GHL_BUILD_SPEC.md.

Registration forms collect only parent name, email, phone, son age, city, primary goal, preferred language, and hidden source detail where available.

Qualification forms collect the nine practical qualification fields from GHL_BUILD_SPEC.md. Do not collect detailed clinical history.

Confidential Intake is a private/draft shell only.

Wire HE and EN forms to the matching funnel steps and redirects. Keep all paths internal/draft until domain approval.

TASK 3 — BUILD W01/W02 IF FOUNDATION NOW EXISTS

After the funnel/forms are complete, exact-name check for the full current-location IL pipeline/tags/fields. Another parallel window is creating them.

If present, build:

W01 | IL | New Lead Routing
- normalize language/source/interest;
- create/update one IL opportunity;
- stage New Lead only when no later state already exists;
- never duplicate an active opportunity;
- preserve later/manual states.

W02 | IL | Masterclass Registration
- triggers: HE/EN registration form submissions;
- language, source/interest, registered, and pre-masterclass state;
- stage/state Masterclass Registered;
- next action Watch Masterclass;
- send E00 immediately by language;
- HE E00 ID: 6a8a0ebac3ca7ccb66b7fbb4;
- EN E00 ID: 6a8a0eef17389f8e23f25e29;
- wait approximately 20–24 hours;
- if engagement is absent, send E01 by language;
- HE E01 ID: 6a8a0eba6b43001bee0641be;
- EN E01 ID: 6a8a0ef0bc3bac7221ce5165;
- stop reminder branch when the lead advances.

If foundation is not yet present, do not guess; return BLOCKED_BY_FOUNDATION after completing the independent funnel/form work.

RETURN:
1. confirmed location;
2. funnel name + ID;
3. all ten step names + IDs;
4. five form names + IDs;
5. exact form-field mappings;
6. page/form redirect map;
7. media installed vs missing;
8. W01/W02 IDs or exact BLOCKED_BY_FOUNDATION;
9. manual clicks required;
10. confirmation nothing published;
11. confirmation zero SMS/WhatsApp;
12. CREATED / UPDATED / VERIFIED / BLOCKED delta.
```

---

## Window D — Email copy + KBs + bots + widgets

```text
PROCEED NOW. Do not re-audit the media library and do not ask for another approval gate.

WORK ONLY IN:
Life Skills
Location ID: 9HQEubuu4WWG6xz09yB4

Verify URL contains:
/v2/location/9HQEubuu4WWG6xz09yB4/

Read from GitHub main:
- GHL_SOURCE_OF_TRUTH.md
- GHL_CURRENT_STATE.md
- GHL_BUILD_SPEC.md
- EMAIL_FUNNEL_EN_HE.md
- WEBSITE_COPY_EN_HE.md

No deletes. No publish. No SMS. No WhatsApp. All bots/widgets off/draft.

TASK 1 — INSTALL CANONICAL COPY INTO THE 28 EXISTING EMAIL TEMPLATES

Email folder:
IL | Inner Leadership
ID: 6a8a0e75473a54c04100225d

The 28 HE/EN E00–E13 shells already exist. Do not recreate them.

Replace every placeholder/AI-generated subject and every blank body using EMAIL_FUNNEL_EN_HE.md exactly.

Rules:
- exact copy source only;
- do not paraphrase or improve;
- preserve all link placeholders;
- simple clean email formatting;
- do not attach templates to new workflows in this window;
- do not send test emails.

Verify all 28 template IDs against GHL_CURRENT_STATE.md and report COPY INSTALLED yes/no for each.

TASK 2 — CREATE TWO KNOWLEDGE BASES

Exact names:
- IL | KB | Program | HE
- IL | KB | Program | EN

Use GHL_BUILD_SPEC.md and WEBSITE_COPY_EN_HE.md as the factual source. Include:
- offer facts;
- four modules;
- delivery structure;
- parent sessions;
- location/price;
- masterclass/qualification/consultation flow;
- not a school replacement;
- no diagnosis claims;
- practical FAQ and fit boundaries.

Do not use the unrelated `Existing knowledge base` A3jlU85MYs5IORNw4Gjn.

TASK 3 — CREATE FOUR BOTS

Exact names:
- IL | Bot | HE | Masterclass Concierge
- IL | Bot | EN | Masterclass Concierge
- IL | Bot | HE | Program Qualification
- IL | Bot | EN | Program Qualification

Map each bot to its corresponding HE/EN KB.

Concierge bots:
- answer program/masterclass questions;
- help register/watch;
- low friction;
- no full qualification prematurely.

Qualification bots:
- collect the practical qualification information defined in GHL_BUILD_SPEC.md;
- recommend only Qualified, Human Review, Nurture, or Not Fit;
- do not diagnose;
- do not promise enrollment;
- final offer remains human.

Another window is creating the `contact.il_*` fields. Build the bots/prompts independently first. At the end, re-check whether the fields now exist and map them. If not, report FIELD_MAPPING_BLOCKED rather than inventing fields.

TASK 4 — CREATE/VERIFY TWO WIDGETS

Exact names:
- IL | Widget | Hebrew
- IL | Widget | English

Use exactly two public-language widgets and four bots. Configure the supported routing so language plus pre/post-masterclass state selects the proper concierge or qualification bot.

If widgets cannot be listed through API, verify through the browser UI before creating. Do not create duplicates.

Keep both widgets unpublished/off.

Do not build workflows in this window.
Do not re-audit media; the current media registry is already verified.

RETURN:
1. confirmed location;
2. email folder ID;
3. all 28 template IDs + canonical subject + COPY INSTALLED yes/no;
4. HE/EN KB names + IDs;
5. four bot names + IDs + KB mapping;
6. two widget names + IDs;
7. field mappings completed vs FIELD_MAPPING_BLOCKED;
8. duplicate candidates left untouched;
9. manual clicks required;
10. confirmation no email sent;
11. confirmation bots/widgets remain off/unpublished;
12. confirmation zero SMS/WhatsApp;
13. CREATED / UPDATED / VERIFIED / BLOCKED delta.
```
