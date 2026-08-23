# Inner Leadership — GHL Audit Reconciliation

Date: 2026-08-23
Status: CURRENT AUDIT INTERPRETATION
Canonical location: `Life Skills` — `9HQEubuu4WWG6xz09yB4`
Legacy location: `pBSnOK2nkdxp6gf9Rg3o` — read-only / do not use

This record reconciles the parallel API/UI audit reports. It does not replace `GHL_CURRENT_STATE.md`; it records which audit conclusions are accepted, rejected, or still require direct readback.

## 1. Accepted current facts

### CRM foundation

The canonical Life Skills location contains the complete required child-program CRM foundation:

- pipeline `IL | 12-Week Program` — `viW1VdaNcQKm1umo67du`;
- all 13 canonical stages;
- all 31 canonical child-program `il |` tags;
- all 22 canonical `contact.il_*` fields.

The successful creation/readback report supersedes earlier partial reports that said only 15 fields existed or that the foundation was missing.

Additional IL-prefixed assets also exist in Life Skills, including assessment/adult-client tags and double-underscore clinical fields. These are not part of the 12-week boys-program architecture. Leave them untouched and do not use them in the child funnel unless an explicit later decision says otherwise.

### Workflows

Canonical Life Skills:

- W04 shell `Qualification Started Workflow` — `d450fc35-530b-4143-a5c0-28b81850de7d` — draft; rename/repair required.
- W05 shell `IL Qualification Outcome` — `10d4cb09-cf3b-47ed-8e0a-d60aaeeb313f` — draft; rename/repair required.
- W01, W02, W03, W06, W07, W08, W09, W10 are not verified operational in Life Skills.

Legacy location:

- W01 `W01 | IL | New Lead Routing` — `08c44c45-dd8c-4007-8cb3-166d94032730` — draft.
- W02 `W02 | IL | Masterclass Registration` — `1004490b-e654-44ab-9cd6-113250fe9460` — draft.

Do not reference legacy workflow IDs or migrate them blindly: their field/tag/stage IDs belong to the legacy location. Rebuild/remap in Life Skills.

### Calendar

Canonical calendar:

- `IL | Parent Consultation` — `KIUGS5BkjlpF5F8ryvg8`;
- 25-minute working draft, 30-minute interval;
- owner `uyhQVFp0ixFvGrKOKCrK`;
- no public open hours;
- no Google/Outlook conflict calendar;
- no SMS/WhatsApp/native reminder sequence;
- slug `il-parent-consultation`.

A Zoom account appears connected at the location level, but the calendar still reports `isZoomAdded=false`. Treat Zoom as **connection present, calendar binding/QA unresolved**. Re-select/authorize Zoom if necessary and prove it with one test booking before publication.

### Media

Canonical GHL media folder scaffold exists, but native GHL storage contains no IL files. The six approved real assets remain in Drive and are the intended source. Four curriculum illustrations, six outcome icons, and the real masterclass recording remain missing.

### Email

Both locations contain 28 E00–E13 templates. In Life Skills the 28 templates are plain-text records with preview URLs. That proves records/content objects exist, but does not prove that subjects/bodies match the canonical lifecycle copy.

Therefore email status is:

- 28 canonical-location template records: VERIFIED;
- exact subject/body correctness: UNVERIFIED;
- workflow attachment: UNVERIFIED;
- do not overwrite until individual template content is read and compared with `EMAIL_FUNNEL_EN_HE.md`.

### Bots, knowledge bases, and widgets

Direct UI evidence supersedes the earlier API-only absence claim:

Canonical Life Skills direct UI:

- Conversation AI agents: zero;
- Voice AI agents: zero;
- Knowledge Bases: one unrelated `Existing knowledge base` — `A3jlU85MYs5IORNw4Gjn`;
- Chat Widgets: zero;
- Sites UI displayed an `IL | Public Funnel` candidate; exact funnel ID, steps and forms still require readback before any creation.

Legacy location direct UI:

- 9 Conversation AI agents;
- 6 Knowledge Bases;
- 2 Inner Leadership widgets;
- `IL | Public Funnel` with 10 steps.

Exact legacy bot/KB/widget inventory and IDs must be captured before using them as a reference. Do not create or migrate from the legacy location without that mapping.

## 2. Audit conclusions not accepted as final

### Truncated custom-field absence claims

The API audit response was truncated. Claims that `contact.il_primary_goal`, `contact.il_project_interest`, `contact.il_preferred_language`, or the final seven fields were absent are invalidated by the later successful 22/22 creation and readback report.

### `41 tags` / `25+ fields` as the canonical boys-program count

Those totals include unrelated IL-prefixed adult/assessment assets. The canonical boys-program set remains exactly 31 tags and 22 fields. Extras are protected and out of scope, not canonical funnel dependencies.

### Google Drive is completely nonfunctional

An API metadata flag reported `isExpired=true`, while another workstream successfully navigated and read the connected Drive source. Treat the connection as contradictory/needs functional UI test, not conclusively dead. Test the GHL media picker or KB Drive import. Reauthorize only if the actual UI operation fails.

### Zoom token conclusively expired

The location-level Zoom connection returned active account details, while the calendar binding remained false. Treat this as a calendar-binding/QA issue, not proof that the account connection itself is dead.

### No phone/WhatsApp/Google Calendar as critical blockers

These are intentional architecture choices:

- no SMS;
- no WhatsApp automation;
- no Google/Outlook conflict calendar.

Their absence is compliant, not a launch defect.

### Funnel absent in Life Skills

Earlier API calls returned zero funnels, but the later direct UI audit displayed `IL | Public Funnel` in Life Skills. Current status is **UI candidate present; exact ID and ten-step/form completeness unverified**. Do not create a duplicate until exact UI/API readback is complete.

## 3. Current execution order

1. Read back the Life Skills `IL | Public Funnel`, its ten steps, all embedded forms and exact IDs. Complete it rather than creating a duplicate.
2. Individually read the 28 Life Skills email templates and compare to `EMAIL_FUNNEL_EN_HE.md`; update only mismatches.
3. Capture the complete legacy 9-agent / 6-KB / 2-widget inventory and exact mappings; then recreate only the canonical 2 KBs, 4 bots and 2 widgets in Life Skills.
4. Repair W04/W05 in Life Skills.
5. Build W01/W02 fresh in Life Skills using canonical IDs; use legacy only as a logic reference.
6. Build W06/W07/W08/W09/W10 in Life Skills. W03 remains blocked by the real masterclass recording.
7. Functionally test Drive access and Zoom booking instead of relying on metadata flags.
8. Keep everything draft/off; no deletes; no SMS; no WhatsApp; no publication.
