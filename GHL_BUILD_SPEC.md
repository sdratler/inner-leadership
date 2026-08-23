# Inner Leadership — Canonical GHL Build Specification

Version: 1.0
Date: 2026-08-23
Status: CURRENT BUILD SPEC

This file defines the desired GHL architecture. Live IDs and implementation status belong in `GHL_CURRENT_STATE.md`. Operating authority and update rules belong in `GHL_SOURCE_OF_TRUTH.md`.

## 1. Location and permanent guardrails

Build only in:

- GHL location: `Life Skills`
- Location ID: `9HQEubuu4WWG6xz09yB4`

Every browser session must verify that the URL contains:

`/v2/location/9HQEubuu4WWG6xz09yB4/`

Permanent rules:

- no SMS;
- no WhatsApp automation;
- no publishing without explicit owner approval;
- no deletion during the active build;
- do not touch One Time or BNA assets;
- do not substitute SG-prefixed objects for IL-prefixed objects;
- search exact name before creating;
- use GHL AI Builder / natural-language builder whenever available;
- keep every new asset draft/unpublished until final QA;
- never use IDs from legacy location `pBSnOK2nkdxp6gf9Rg3o`.

## 2. Canonical offer facts

- Brand: Inner Leadership / הנהגה מבפנים
- Offer: 12-week hands-on self-governance program
- Ages: 7–13
- Location: Beit Shemesh
- Languages: Hebrew and English
- Delivery: one weekly private 50–60 minute session, two weekly 90-minute applied project labs, three parent strategy sessions
- Founding investment: 10,800 NIS, paid as 3 × 3,600 NIS
- Two compatible paid boys can open the first lab
- Five-boy founding target
- Ten-boy current cap

## 3. Pipeline

Create exactly one pipeline:

`IL | 12-Week Program`

Stages in this exact order:

1. `New Lead`
2. `Masterclass Registered`
3. `Masterclass Engaged`
4. `Qualification In Progress`
5. `Qualified`
6. `Human Review`
7. `Consultation Booked`
8. `Consultation Attended`
9. `Offer / Decision`
10. `First Payment Received`
11. `Enrolled — Cohort Assigned`
12. `Nurture / Next Cohort`
13. `Not Fit / Closed`

Do not create a reduced five-stage pipeline.

## 4. Tags

Create the following 31 tags exactly.

### Language

- `il | language | hebrew`
- `il | language | english`

### Bot state

- `il | bot state | pre-masterclass`
- `il | bot state | post-masterclass`

### Source

- `il | source | facebook`
- `il | source | instagram`
- `il | source | google`
- `il | source | website`
- `il | source | referral`
- `il | source | direct`
- `il | source | other`

### Interest

- `il | interest | masterclass`
- `il | interest | 12-week program`

### Masterclass

- `il | masterclass | registered`
- `il | masterclass | engaged`
- `il | masterclass | completed`

### Qualification

- `il | qualification | in progress`
- `il | qualification | qualified`
- `il | qualification | human review`
- `il | qualification | nurture`
- `il | qualification | not fit`

### Consultation

- `il | consultation | booked`
- `il | consultation | attended`
- `il | consultation | no show`
- `il | consultation | cancelled`

### Offer, payment, and program

- `il | offer | made`
- `il | payment | first payment received`
- `il | program | enrolled`
- `il | program | completed`
- `il | program | withdrawn`
- `il | cohort | founding cohort`

## 5. Contact custom fields

Create exactly 22 fields using the `contact.il_*` key family. Never create `inner_leadership_*` keys and never rename the existing `contact.sg_*` fields.

| Display name | Canonical key | Type | Canonical options / use |
|---|---|---|---|
| IL Funnel State | `contact.il_funnel_state` | RADIO | New Lead; Masterclass Registered; Masterclass Engaged; Qualification In Progress; Qualified; Human Review; Consultation Booked; Consultation Attended; Offer / Decision; First Payment Received; Enrolled — Cohort Assigned; Nurture / Next Cohort; Not Fit / Closed |
| IL Preferred Language | `contact.il_preferred_language` | RADIO | Hebrew; English |
| IL Son Age | `contact.il_son_age` | RADIO | 7; 8; 9; 10; 11; 12; 13; Other / Needs Review |
| IL City | `contact.il_city` | TEXT | Free text |
| IL Current Framework | `contact.il_current_framework` | LARGE_TEXT | Current school/learning framework |
| IL Primary Goal | `contact.il_primary_goal` | LARGE_TEXT | Main desired change/outcome |
| IL Social Group Context | `contact.il_social_group_context` | LARGE_TEXT | Current group/social context |
| IL Project Interest | `contact.il_project_interest` | LARGE_TEXT | Interests in building, woodworking, cooking, movement, etc. |
| IL Travel to Beit Shemesh | `contact.il_travel_to_beit_shemesh` | RADIO | Yes; No; Unsure |
| IL Maximum Travel Time | `contact.il_maximum_travel_time` | RADIO | Up to 30 minutes; 31–45 minutes; 46–60 minutes; 61–90 minutes; More than 90 minutes; Unsure |
| IL Weekly Schedule Fit | `contact.il_weekly_schedule_fit` | RADIO | Yes; Depends on final schedule; No |
| IL Parent Session Commitment | `contact.il_parent_session_commitment` | RADIO | Yes; Needs discussion; No |
| IL Financial Fit | `contact.il_financial_fit` | RADIO | Yes; Needs discussion; No |
| IL Qualification Status | `contact.il_qualification_status` | RADIO | Not Started; In Progress; Qualified; Human Review; Nurture; Not Fit |
| IL Qualification Summary | `contact.il_qualification_summary` | LARGE_TEXT | Bot/human summary of practical fit |
| IL Next Action | `contact.il_next_action` | RADIO | Watch Masterclass; Complete Qualification; Human Review; Book Consultation; Attend Consultation; Offer Decision; Complete First Payment; Complete Intake; Nurture; Closed |
| IL Ad Market | `contact.il_ad_market` | RADIO | Modi'in Corridor; Rehovot Corridor; Shoham / Affluent East-Central; Jerusalem Corridor; Gush Etzion; Beit Shemesh Local; Other |
| IL Masterclass Engagement Pct | `contact.il_masterclass_engagement_pct` | NUMERICAL | 0–100 |
| IL Masterclass Engaged At | `contact.il_masterclass_engaged_at` | DATE | Date engagement threshold was reached |
| IL Cohort | `contact.il_cohort` | TEXT | Actual assigned cohort only; never invent |
| IL Program Cycle | `contact.il_program_cycle` | TEXT | Actual program cycle only; never invent |
| IL Source Detail | `contact.il_source_detail` | TEXT | Campaign/ad/referral detail |

## 6. Funnel

Create exactly one standard funnel:

`IL | Public Funnel`

Ten steps in this exact order:

1. `IL | HE | Landing`
2. `IL | HE | Masterclass Registration`
3. `IL | HE | Masterclass Watch`
4. `IL | HE | Qualification`
5. `IL | HE | Thank You`
6. `IL | EN | Landing`
7. `IL | EN | Masterclass Registration`
8. `IL | EN | Masterclass Watch`
9. `IL | EN | Qualification`
10. `IL | EN | Thank You`

All pages remain draft. Use GHL AI page builder where available. Do not publish a domain or paths until final QA and explicit approval.

Canonical page copy must come from the current bilingual website-copy source, not from the older static-site pages in the repository.

## 7. Forms

Create exactly five forms:

1. `IL | HE | Masterclass Registration`
2. `IL | EN | Masterclass Registration`
3. `IL | HE | Qualification Fallback`
4. `IL | EN | Qualification Fallback`
5. `IL | Shared | Confidential Intake`

### Masterclass registration forms

Collect only:

- parent name using standard contact name fields;
- email;
- phone;
- `IL Son Age`;
- `IL City`;
- `IL Primary Goal`;
- `IL Preferred Language`;
- hidden attribution/source detail where available.

Apply the appropriate language and masterclass-interest state. Keep registration low-friction.

### Qualification fallback forms

Collect/map:

- `IL Current Framework`;
- `IL Primary Goal`;
- `IL Social Group Context`;
- `IL Project Interest`;
- `IL Travel to Beit Shemesh`;
- `IL Maximum Travel Time`;
- `IL Weekly Schedule Fit`;
- `IL Parent Session Commitment`;
- `IL Financial Fit`.

Do not collect detailed clinical history.

### Confidential intake

Create the shell and keep it private/draft. It is for accepted clients only. Detailed medical, safety, emergency, allergy, confidentiality, and consent information belongs here later, after the legal/operations review—not in public forms or bots.

## 8. Knowledge bases

Create exactly two:

- `IL | KB | Program | HE`
- `IL | KB | Program | EN`

Each KB must contain the same factual program architecture in its language:

- offer facts;
- four curriculum modules;
- program structure;
- parent sessions;
- location and price;
- masterclass and qualification process;
- consultation and manual fit decision;
- not a school replacement;
- no diagnosis claims;
- practical FAQ and fit boundaries.

## 9. Bots and widgets

Create exactly four bots:

1. `IL | Bot | HE | Masterclass Concierge`
2. `IL | Bot | EN | Masterclass Concierge`
3. `IL | Bot | HE | Program Qualification`
4. `IL | Bot | EN | Program Qualification`

Create exactly two widgets:

- `IL | Widget | Hebrew`
- `IL | Widget | English`

All bots and widgets remain OFF/DRAFT.

### Concierge bots

- answer program/masterclass questions;
- help the visitor register or watch;
- remain low-friction;
- do not conduct full post-masterclass qualification prematurely;
- use the corresponding language KB.

### Qualification bots

Collect the qualification fields listed above. They may recommend one of four operational outcomes:

- Qualified;
- Human Review;
- Nurture;
- Not Fit.

They may not diagnose, promise enrollment, or make the final offer decision.

Widget routing uses language plus pre-/post-masterclass state. Exact GHL implementation may use bot-state tags, workflow routing, or the supported Conversation AI routing mechanism, but the result must preserve exactly two public widgets and four bots.

## 10. Calendar

Create exactly one canonical calendar:

`IL | Parent Consultation`

Requirements:

- Personal Booking Calendar;
- assigned to current-location owner `uyhQVFp0ixFvGrKOKCrK` (Rabbi Shloimie / Solomon Dratler);
- Zoom meeting location;
- no Google Calendar;
- no Outlook Calendar;
- no external conflict calendar;
- Look Busy OFF;
- SMS OFF;
- WhatsApp OFF;
- no native reminder sequence; W06 owns email communication;
- unpublished.

Working technical draft if GHL requires values in order to save:

- 25-minute consultation;
- 30-minute interval;
- one appointment per slot;
- auto-confirm on;
- recurring off.

These timing values and final availability remain owner-review items before publication. Do not expose unapproved availability publicly.

## 11. Email library

Folder:

`IL | Inner Leadership`

Required: E00–E13 in Hebrew and English, 28 total.

Existing IDs are maintained in `GHL_CURRENT_STATE.md`.

Canonical subjects and bodies come only from:

`EMAIL_FUNNEL_EN_HE.md`

Do not paraphrase, improve, or replace that copy in GHL without an explicit copy decision. Preserve link placeholders until canonical page/calendar/payment URLs exist.

No SMS templates.

## 12. Workflows

Create ten workflows, all draft/unpublished.

### W01 — `W01 | IL | New Lead Routing`

Purpose:

- normalize language, source, interest, and initial funnel state;
- create or update one opportunity in `IL | 12-Week Program`;
- initial stage `New Lead` when no later state already exists;
- never create duplicate active opportunities;
- preserve deliberate later/manual states.

### W02 — `W02 | IL | Masterclass Registration`

Triggers:

- HE or EN masterclass registration form submission.

Actions:

- apply language, source/interest, registered, and pre-masterclass state;
- update one opportunity to `Masterclass Registered`;
- set funnel state and next action to watch the masterclass;
- send corresponding E00 immediately;
- after approximately 20–24 hours, send E01 only when engagement state is absent;
- stop the reminder branch when the contact advances.

### W03 — `W03 | IL | Masterclass Engagement`

Blocked until the real trackable GHL-hosted masterclass video exists.

At approximately 5% watched by a known contact:

- record engagement percentage/date;
- apply engaged and post-masterclass state;
- update stage to `Masterclass Engaged`;
- make qualification available;
- send E08 only when qualification is not already complete.

Do not require 50% completion.

### W04 — `W04 | IL | Qualification Started`

Trigger when qualification begins through the supported bot/form state.

Actions:

- set `IL Qualification Status` to `In Progress`;
- apply `il | qualification | in progress`;
- set funnel state to `Qualification In Progress`;
- set next action to `Complete Qualification`;
- update one opportunity to `Qualification In Progress`.

A draft shell currently exists and must be renamed/repaired after the foundation IDs exist.

### W05 — `W05 | IL | Qualification Outcome`

Trigger when `IL Qualification Status` becomes Qualified, Human Review, Nurture, or Not Fit.

Branches:

- Qualified → qualified tag, stage `Qualified`, next action `Book Consultation`; send E09 after the defined delay if no consultation is booked.
- Human Review → human-review tag and stage `Human Review`; no automated rejection/offer.
- Nurture → nurture tag and stage `Nurture / Next Cohort`.
- Not Fit → not-fit tag and stage `Not Fit / Closed`; no manipulative follow-up.

A draft shell currently exists and must be renamed/repaired after the foundation IDs exist.

### W06 — `W06 | IL | Consultation`

Scoped only to `IL | Parent Consultation`.

- booked → booked tag/stage, state/next action, E10 reminder 24 hours before by language;
- attended → attended tag/stage;
- no show → no-show tag and E11 by language;
- cancelled → cancelled tag;
- email only;
- no duplicate opportunity.

### W07 — `W07 | IL | Offer`

Trigger only when the human explicitly applies `il | offer | made` or an equivalent deliberate manual offer action.

- stage `Offer / Decision`;
- set funnel state/next action;
- send E12 by language.

Never trigger automatically merely because a consultation was attended.

### W08 — `W08 | IL | Payment & Enrollment`

- first-payment tag → stage `First Payment Received`, state/next action, send E13 by language;
- enrolled tag/manual assignment → stage `Enrolled — Cohort Assigned`;
- populate cohort/program-cycle only with real values;
- Green Invoice/webhook automation remains deferred.

### W09 — `W09 | IL | Masterclass Nurture`

For registered leads who have not advanced:

- Day 2: E02;
- Day 4: E03;
- Day 6: E04;
- Day 8: E05;
- Day 10: E06;
- Day 12: E07.

Exit when qualification advances, consultation is booked, an offer decision occurs, first payment/enrollment occurs, or Not Fit/Closed is deliberately assigned.

### W10 — `W10 | IL | Data Hygiene`

Narrow, event-driven consistency only:

- keep language field/tag consistent;
- keep qualification/consultation/payment stage and state consistent;
- guard against duplicate active IL opportunities;
- correct clear bot-state conflicts using the newest valid state;
- add a review note rather than delete uncertain duplicates;
- exclude One Time and BNA assets/contacts;
- never overwrite deliberate human-review or fit decisions;
- never delete contacts, opportunities, stages, tags, or fields.

## 13. Media

Canonical binary source: Google Drive, `Inner Leadership — Canonical Library`.

Verified usable real assets and their IDs are maintained in `GHL_CURRENT_STATE.md`.

Required production media:

- real soldering/electronics hero;
- four real-work gallery photos;
- real founder portrait;
- four matching curriculum illustrations;
- six matching outcome icons;
- real masterclass video.

No stock substitutions. Drive originals are never overwritten.

## 14. Completion-report contract

Every GHL worker must return:

1. confirmed location ID;
2. exact asset names and IDs;
3. CREATED / UPDATED / VERIFIED / BLOCKED status;
4. settings configured;
5. field/tag/stage mappings;
6. dependencies or blockers;
7. duplicate candidates left untouched;
8. exact manual clicks still required;
9. confirmation nothing was published;
10. confirmation zero SMS and zero WhatsApp automation were added.

## 15. Publication gate

Nothing may be published until:

- final HE/EN copy is installed;
- approved media is installed;
- real masterclass video is uploaded and trackable;
- Zoom booking produces a working meeting link;
- one Hebrew end-to-end lead passes;
- one English end-to-end lead passes;
- stage/state consistency passes;
- zero SMS exists;
- owner explicitly approves publication.
