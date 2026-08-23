# Inner Leadership — GHL Current State

Date: 2026-08-23  
Status: **CRM FOUNDATION VERIFIED; DIRECT FUNNEL PIVOT NOT YET APPLIED LIVE**

## Current strategic override

The active customer journey is now:

**Google Search → price-transparent landing page → direct qualification → parent consultation → offer → payment → enrollment**

The 35–40-minute masterclass, video-engagement gate, Masterclass Registration/Watch steps and masterclass nurture are DEFERRED. Existing objects are preserved but must not receive active traffic.

## Canonical location

- Name: `Life Skills`
- Location ID: `9HQEubuu4WWG6xz09yB4`
- Required URL: `/v2/location/9HQEubuu4WWG6xz09yB4/`

Legacy location `pBSnOK2nkdxp6gf9Rg3o` is read-only. Leave every legacy object untouched.

## Permanent rules

- no SMS;
- no WhatsApp automation;
- no publication without explicit owner approval;
- no broad re-audit;
- search exact name before creating;
- do not delete duplicates during active build;
- do not touch One Time, BNA, SG, adult-assessment or double-underscore clinical assets;
- keep draft/off until QA;
- Google Search is the first paid channel;
- public bots/widgets are not launch blockers.

## Pipeline — VERIFIED

Name: `IL | 12-Week Program`  
ID: `viW1VdaNcQKm1umo67du`

| Stage | ID | Current use |
|---|---|---|
| New Lead | `14c685f2-1159-4fd6-b590-6ca2ed0e66fe` | ACTIVE |
| Masterclass Registered | `a5204d3c-5136-4b41-b07d-bd1b84638d16` | DORMANT / PRESERVE |
| Masterclass Engaged | `afd27be9-3d94-495f-a600-4388ef98331a` | DORMANT / PRESERVE |
| Qualification In Progress | `e0d0f542-d3a9-4d68-b99b-a7fd4e37a7c7` | ACTIVE |
| Qualified | `9c8cae17-b7ea-40cc-b0d6-d0228df2a60b` | ACTIVE |
| Human Review | `25a60f89-52bd-4588-bb45-514f02bc09cb` | ACTIVE |
| Consultation Booked | `aa65d2ba-d7bb-4ff6-b8e1-b3019da74276` | ACTIVE |
| Consultation Attended | `a3b9c773-5599-4f2c-95fd-859ec4b41a62` | ACTIVE |
| Offer / Decision | `34c3a473-cbdf-4a5d-b825-fea7e46ff5db` | ACTIVE |
| First Payment Received | `5a512f7d-eb6b-4e97-97c5-cddfa7e2ac4a` | ACTIVE |
| Enrolled — Cohort Assigned | `c40c10ca-d96a-42b1-945d-1157096c875c` | ACTIVE |
| Nurture / Next Cohort | `9b4aaf79-7f6b-4156-ae0a-92e0524334a8` | ACTIVE |
| Not Fit / Closed | `2be778aa-3d2d-4607-9fb6-b6d22451f2c9` | ACTIVE |

Active path skips the two dormant masterclass stages.

## Tags — 31 / 31 VERIFIED

### Language

- `il | language | hebrew` — `Mbr17GB0at1TGOLkFMYR`
- `il | language | english` — `fI9XF5kVoSnXzD2LjRfb`

### Dormant bot state

- `il | bot state | pre-masterclass` — `boFYbMu1nbXC3KxVDAPC`
- `il | bot state | post-masterclass` — `CdWvRqmFIhgv0A4MG2Qf`

Do not use on the direct route.

### Source

- `il | source | facebook` — `zl0DDXbYtP6OGY8LrtPr`
- `il | source | instagram` — `p02yVGFrXzkuipmcwlxS`
- `il | source | google` — `97fzYeROXqyursEgXrM6`
- `il | source | website` — `tfSFxPCLWrfOpErw4PkD`
- `il | source | referral` — `G5B8VcF640nCDTO51WPI`
- `il | source | direct` — `ro8OgNtQXIPh1bdEwwSy`
- `il | source | other` — `NxvUJJof70f1M04BhXi4`

### Interest

- `il | interest | masterclass` — `Xtq9iDDYlaQB2yNuH4FR` — DORMANT
- `il | interest | 12-week program` — `ZB1ePAskTocQg9CyWMBr` — ACTIVE

### Masterclass — DORMANT

- `il | masterclass | registered` — `UuL80kKKIlN3YpoDd2dp`
- `il | masterclass | engaged` — `0EeyxQBWHc4ivGURYkoA`
- `il | masterclass | completed` — `sR6t3tATm23eF3CNspIn`

### Qualification

- `il | qualification | in progress` — `OGtQeEEUsT75QLCPo8Dc`
- `il | qualification | qualified` — `5SxmHVsJx5EHQrCAzH88`
- `il | qualification | human review` — `1uC43M7GSTFo4Du7edg1`
- `il | qualification | nurture` — `jE3vBDkrSljFBU8wclYn`
- `il | qualification | not fit` — `dTuoFRlEnotkKM0i989I`

### Consultation

- `il | consultation | booked` — `lweTKM4OQSnc79HKXbrQ`
- `il | consultation | attended` — `k5Q3DXNXNIp5u026JTSn`
- `il | consultation | no show` — `043Dr3nxOEAuZr15qCWX`
- `il | consultation | cancelled` — `7xhtwKXqulSMZ5koxYG8`

### Offer, payment and program

- `il | offer | made` — `Z5wNWlXYWRDDbrEHWzMJ`
- `il | payment | first payment received` — `smUwgbLDUezouE0ftNj1`
- `il | program | enrolled` — `Rf6WyN8vEaN4c94OklIV`
- `il | program | completed` — `WCpRzzGtD2nUmc2fcICC`
- `il | program | withdrawn` — `Obha362fQa3BM9SCdc48`
- `il | cohort | founding cohort` — `7ElWWhSbjwFjmaAsu8QY`

## Contact fields — 22 / 22 VERIFIED

| Display name | Key | ID | Type | Current use |
|---|---|---|---|---|
| IL Funnel State | `contact.il_funnel_state` | `Vu7lVrRuSCNXQQER0cJz` | RADIO | ACTIVE |
| IL Preferred Language | `contact.il_preferred_language` | `rXFtewuKhEx0ylKdUhEY` | RADIO | ACTIVE |
| IL Son Age | `contact.il_son_age` | `iHiMUhmaxoytgXm5obNY` | RADIO | ACTIVE |
| IL City | `contact.il_city` | `eqd4Ejjxh7Y2t0dGAtD9` | TEXT | ACTIVE |
| IL Current Framework | `contact.il_current_framework` | `NkuoX0skWlSphcSsZ4cC` | LARGE_TEXT | ACTIVE |
| IL Primary Goal | `contact.il_primary_goal` | `x7rEljmsPuazqQM8pGyq` | LARGE_TEXT | ACTIVE |
| IL Social Group Context | `contact.il_social_group_context` | `sSbp8KRInXX98t9rc6Y0` | LARGE_TEXT | ACTIVE |
| IL Project Interest | `contact.il_project_interest` | `zI5E63yZtgz6Gx0R5voF` | LARGE_TEXT | ACTIVE |
| IL Travel to Beit Shemesh | `contact.il_travel_to_beit_shemesh` | `87ukw54c3Y72iwDRqPsf` | RADIO | ACTIVE |
| IL Maximum Travel Time | `contact.il_maximum_travel_time` | `xvrf6JJUpMp33R9S0Lc7` | RADIO | ACTIVE |
| IL Weekly Schedule Fit | `contact.il_weekly_schedule_fit` | `9VS3cMPteknReqfBjxMR` | RADIO | ACTIVE |
| IL Parent Session Commitment | `contact.il_parent_session_commitment` | `fTqWiId0FZFBM70vmMx1` | RADIO | ACTIVE |
| IL Financial Fit | `contact.il_financial_fit` | `PaoiH8DNk5P557S0wjpb` | RADIO | ACTIVE |
| IL Qualification Status | `contact.il_qualification_status` | `nd7A6Y0qWitIHmWqdYdT` | RADIO | ACTIVE |
| IL Qualification Summary | `contact.il_qualification_summary` | `NlvJsaPvUUIvsJlMmMiZ` | LARGE_TEXT | ACTIVE |
| IL Next Action | `contact.il_next_action` | `hatxzo5BmR7biz9Bai7u` | RADIO | ACTIVE; do not use Watch Masterclass |
| IL Ad Market | `contact.il_ad_market` | `AdLv74GF1soQ6Sbe0dgu` | RADIO | ACTIVE |
| IL Masterclass Engagement Pct | `contact.il_masterclass_engagement_pct` | `SM2V3JzlJZE4Wk9bBW5j` | NUMERICAL | DORMANT |
| IL Masterclass Engaged At | `contact.il_masterclass_engaged_at` | `0V8kbuz2iYTLYDHlkZRN` | DATE | DORMANT |
| IL Cohort | `contact.il_cohort` | `YUnUxbsGTb4LHEttNB61` | TEXT | ACTIVE |
| IL Program Cycle | `contact.il_program_cycle` | `3gj4f35pL6rD20yn0lrE` | TEXT | ACTIVE |
| IL Source Detail | `contact.il_source_detail` | `02m8v6tw8XK5I7eK0E0o` | TEXT | ACTIVE |

Do not create a second field set.

## Workflows

### Existing current-location shells

- `Qualification Started Workflow` — `d450fc35-530b-4143-a5c0-28b81850de7d`
  - required final name: `W04 | IL | Qualification Started`
  - status: draft shell; repair required.
- `IL Qualification Outcome` — `10d4cb09-cf3b-47ed-8e0a-d60aaeeb313f`
  - required final name: `W05 | IL | Qualification Outcome`
  - status: draft shell; repair required.

### Required direct-funnel set

- W01 New Lead Routing — NOT VERIFIED OPERATIONAL.
- W02 Direct Qualification Intake — NOT BUILT/VERIFIED.
- W03 Fast Lead Response — NOT BUILT.
- W04 Qualification Started — DRAFT SHELL.
- W05 Qualification Outcome — DRAFT SHELL.
- W06 Consultation — NOT BUILT.
- W07 Offer — NOT BUILT.
- W08 Payment & Enrollment — NOT BUILT.
- W09 Direct Program Nurture — NOT BUILT.
- W10 Data Hygiene — NOT BUILT.

Legacy W01/W02 IDs must never be reused.

## Funnel and forms

Direct UI previously displayed a Life Skills `IL | Public Funnel` candidate, while an earlier API surface returned zero. Therefore:

- funnel candidate: PRESENT IN UI / EXACT ID UNVERIFIED;
- active step completeness: UNVERIFIED;
- form inventory: UNVERIFIED;
- next action: read back exact candidate before creating or duplicating.

### Desired active route

- HE Landing;
- HE Qualification;
- HE Thank You;
- EN Landing;
- EN Qualification;
- EN Thank You.

### Desired forms

- HE Direct Qualification;
- EN Direct Qualification;
- Shared Confidential Intake.

Any registration/watch pages remain DEFERRED and disconnected.

## Calendar — CREATED / DRAFT

- Name: `IL | Parent Consultation`
- ID: `KIUGS5BkjlpF5F8ryvg8`
- Slug: `il-parent-consultation`
- Owner user ID: `uyhQVFp0ixFvGrKOKCrK`
- Duration: 25 minutes working draft
- Interval: 30 minutes
- Appointments per slot: 1
- Auto-confirm: ON
- Recurring: OFF
- Meeting location type: `zoom_conference`
- Open hours: empty
- External conflict calendars: none
- Native SMS/WhatsApp/email reminders: OFF
- Published: NO

Blockers:

- Zoom binding/test booking unresolved;
- final availability requires owner review.

## Knowledge bases, bots and widgets

Current Life Skills direct UI evidence:

- Conversation AI agents: zero;
- Voice AI agents: zero;
- Chat Widgets: zero;
- one unrelated Knowledge Base: `Existing knowledge base` — `A3jlU85MYs5IORNw4Gjn`.

This is no longer a launch blocker. Do not recreate the old four-bot masterclass architecture. Optional HE/EN program KBs and assistants may be built after the direct route is live.

## Media — VERIFIED FOLDER SCAFFOLD

GHL root:

- `IL | Inner Leadership` — `6a89f71a67bb7ac351890442`

Subfolders:

- `IL | 01 | Real Program Photos` — `6a89f72467ecc8731dc956b5`
- `IL | 02 | Founder` — `6a89f724cdd4b797a395f488`
- `IL | 03 | Curriculum Illustrations` — `6a89f72467ecc8731dc956bb`
- `IL | 04 | Outcome Icons` — `6a89f724ad59e6cfeda7c0e3`
- `IL | 05 | Masterclass` — `6a89f72467bb7ac351890513` — retain; long-form deferred
- `IL | 06 | Meta Ads` — `6a89f724898f05a675d53613`
- `IL | 07 | Landing Page` — `6a89f72567ecc8731dc956cd`
- `IL | 99 | Working / Unsorted` — `6a89f725898f05a675d536c6`

Approved real media remains in Drive. Missing long-masterclass media is not a launch blocker. The optional 5–6-minute overview may be added later without gating.

## Email library — RECORDS VERIFIED; COPY NOW STALE

Folder:

- `IL | Inner Leadership`
- ID: `6a8a0e75473a54c04100225d`

All 28 E00–E13 Hebrew/English records exist. Masterclass-first copy was installed and verified on 2026-08-23, but the acquisition pivot makes E00, E01, E02, E03, E04 and E08 plus any masterclass links operationally stale. Patch all 28 against `EMAIL_FUNNEL_EN_HE.md`; do not recreate records.

### Hebrew IDs

- E00 `6a8a0ebac3ca7ccb66b7fbb4`
- E01 `6a8a0eba6b43001bee0641be`
- E02 `6a8a0ebb17389f8e23f25bd9`
- E03 `6a8a0ebb17389f8e23f25beb`
- E04 `6a8a0ebc5111f4c7772fae7b`
- E05 `6a8a0ebcbc3bac7221ce4f54`
- E06 `6a8a0ebd17389f8e23f25bf9`
- E07 `6a8a0ed3897d6716c6ede315`
- E08 `6a8a0ed3473a54c041002600`
- E09 `6a8a0ed4c3ca7ccb66b7fc70`
- E10 `6a8a0ed4473a54c04100262e`
- E11 `6a8a0ed5c95ab36931c80d26`
- E12 `6a8a0ed6bc3bac7221ce5036`
- E13 `6a8a0ed6bc3bac7221ce5043`

### English IDs

- E00 `6a8a0eef17389f8e23f25e29`
- E01 `6a8a0ef0bc3bac7221ce5165`
- E02 `6a8a0ef0473a54c041002763`
- E03 `6a8a0ef1e4cb773834812978`
- E04 `6a8a0ef15111f4c7772fb33e`
- E05 `6a8a0ef2e4cb773834812992`
- E06 `6a8a0ef2e4cb7738348129a2`
- E07 `6a8a0f04bc3bac7221ce52a2`
- E08 `6a8a0f05c95ab36931c80f2c`
- E09 `6a8a0f05897d6716c6ede4de`
- E10 `6a8a0f075111f4c7772fb40d`
- E11 `6a8a0f078f831e07ce2de27a`
- E12 `6a8a0f0817389f8e23f25f41`
- E13 `6a8a0f086b43001bee0644f5`

No template is attached or sent until links and direct workflows pass QA.

## Immediate execution order

1. Read back the Life Skills `IL | Public Funnel` candidate and its current steps/forms.
2. Transform the active route to HE Landing → HE Qualification → HE Thank You; leave old masterclass steps deferred.
3. Build/repair HE Direct Qualification with price shown before submission.
4. Patch the existing 28 email records to V3 direct copy.
5. Build W01/W02/W03 and repair W04/W05.
6. Bind/test the calendar and build W06/W09/W10.
7. Install Google conversion tracking and run one complete Hebrew test lead.
8. Obtain owner approval to publish the Hebrew route and spend.
9. Launch Search; add English/Meta/optional AI components after the direct route works.

## Publication status

- Nothing in the direct pivot has been published from this update.
- No GHL funnel/form/workflow live write has yet been verified.
- Zero SMS/WhatsApp remains canonical.
