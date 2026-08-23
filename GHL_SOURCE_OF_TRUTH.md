# Inner Leadership — GHL Source of Truth

Status: CURRENT
Date: 2026-08-23
Repository: `sdratler/inner-leadership`
Branch: `main`

## The rule

There is one authoritative control plane for the Inner Leadership GHL build:

**GitHub `main`, beginning with this file.**

GHL itself is authoritative for live runtime facts: what objects actually exist, their IDs, their settings, and whether they are draft or published. GitHub is authoritative for the intended architecture, verified registry, exact copy, prompt library, decisions, and change history.

Google Drive is authoritative only for binary creative assets.

Do not use chat history, browser tabs, old project folders, or legacy GHL sub-accounts as an independent source of truth.

## Locked marketing decision — 2026-08-23

The public category is resolved and no longer an open legal-language question:

- Brand: `Inner Leadership / הנהגה מבפנים`
- Hebrew category: `טיפול רגשי מעשי לבנים בגילאי 7–13`
- English category: `Practical Emotional Therapy for Boys Ages 7–13`
- Delivery: a focused 12-week therapeutic process combining weekly individual therapy, two applied therapeutic project labs each week, and three parent-guidance sessions

Do not revert the public positioning to “course,” “club,” “chug,” “curriculum,” or a generic life-skills program. The project method remains self-governance and intrinsic motivation; the service category is emotional treatment.

## Canonical systems

| Domain | Authority | Canonical location |
|---|---|---|
| Live CRM/funnel runtime | GHL | Life Skills, `9HQEubuu4WWG6xz09yB4` |
| Desired GHL architecture | GitHub | `GHL_BUILD_SPEC.md` on `main` |
| Verified GHL IDs and implementation status | GitHub mirror of GHL readback | `GHL_CURRENT_STATE.md` on `main` |
| Exact execution prompts | GitHub | `GHL_PROMPT_LIBRARY.md` on `main` |
| Email subjects and bodies | GitHub | `EMAIL_FUNNEL_EN_HE.md` on `main` |
| Website copy | GitHub | `WEBSITE_COPY_EN_HE.md` on `main` |
| Marketing positioning and founder video scripts | GitHub | `MARKETING_POSITIONING_AND_VIDEO_SCRIPTS.md` on `main` |
| Images, video, and other binaries | Google Drive | `Inner Leadership — Canonical Library` |

## Canonical GHL location

Every GHL task must verify the URL contains:

`/v2/location/9HQEubuu4WWG6xz09yB4/`

Canonical location:

- Name: `Life Skills`
- ID: `9HQEubuu4WWG6xz09yB4`

Legacy/wrong location:

- `pBSnOK2nkdxp6gf9Rg3o`

Never use an ID from the legacy location in the current build. Leave legacy assets untouched unless the owner explicitly authorizes cleanup later.

## Precedence when documents disagree

1. Explicit owner decision in the current conversation.
2. This file.
3. `MARKETING_POSITIONING_AND_VIDEO_SCRIPTS.md` for public category, ad/video framing, and creative hierarchy.
4. `GHL_BUILD_SPEC.md` for desired structure.
5. Fresh GHL readback recorded in `GHL_CURRENT_STATE.md` for actual state.
6. Exact canonical copy files such as `WEBSITE_COPY_EN_HE.md` and `EMAIL_FUNNEL_EN_HE.md`.
7. Other current project files.
8. Legacy records and archives.

A fresh GHL readback may prove that the live system differs from the spec. That does not silently change the spec. Record the discrepancy in `GHL_CURRENT_STATE.md`, then deliberately decide whether to change GHL or amend the spec.

## Update protocol after every GHL workstream

Every GHL worker must return:

1. confirmed location ID;
2. exact asset names;
3. exact IDs;
4. draft/published state;
5. settings changed;
6. dependencies or blockers;
7. duplicate candidates left untouched;
8. confirmation that no SMS/WhatsApp was added;
9. confirmation that nothing was published;
10. a concise delta: CREATED, UPDATED, VERIFIED, BLOCKED.

Then the central coordinator must:

1. compare the report with live GHL readback when available;
2. update `GHL_CURRENT_STATE.md` on `main`;
3. update `GHL_BUILD_SPEC.md` only when the intended architecture changes;
4. update `GHL_PROMPT_LIBRARY.md` when prompts or dependencies change;
5. commit the change before issuing dependent prompts.

No browser worker should independently rewrite the canonical GitHub files unless its sole assigned task is source-of-truth maintenance.

## Permanent operating constraints

- no SMS;
- no WhatsApp automation;
- no publication without explicit owner approval;
- no deletion during active build;
- no touching One Time or BNA assets;
- no use of SG-prefixed objects as substitutes for IL-prefixed objects;
- exact-name check before creation;
- GHL AI Builder/natural-language builder preferred whenever available;
- current copy and IDs must come from the canonical files, not from memory;
- public copy may describe the service as `טיפול רגשי מעשי`;
- paid Meta ads must not claim to know that the viewer's child has a diagnosis, medical condition, or medication history;
- no ad may tell parents to stop, reject, or alter medication; the masterclass may discuss the broader developmental picture without giving medical instructions.

## Current status

Read `GHL_CURRENT_STATE.md` before issuing or executing any GHL task.

Read `GHL_BUILD_SPEC.md` before creating missing architecture.

Read `GHL_PROMPT_LIBRARY.md` for the current parallel build prompts.
