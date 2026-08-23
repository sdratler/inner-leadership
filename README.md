# Inner Leadership / הנהגה מבפנים

Inner Leadership is a **12-week hands-on self-governance program for boys ages 7–13** in Beit Shemesh.

Current delivery model:

- one private 50–60 minute coaching session each week;
- two 90-minute applied project labs each week;
- three parent strategy sessions during the twelve weeks;
- Hebrew and English;
- founding investment: **10,800 NIS**, paid in three installments of 3,600 NIS;
- two compatible paid boys can open the first lab;
- five-boy founding cohort target;
- ten-boy current cap.

## Current production architecture

**GHL is the production funnel and CRM.**

**GitHub is the canonical text/state record.**

**Google Drive is the canonical binary creative library.**

Current GHL implementation state and exact verified IDs are maintained in:

- [`GHL_CURRENT_STATE.md`](GHL_CURRENT_STATE.md)

Do not use older GHL IDs without checking that they belong to the current canonical Life Skills location.

## Static website in this repository

The repository contains a complete static website/funnel codebase:

- `index.html` — sales website
- `masterclass.html` — masterclass registration
- `watch.html` — watch page
- `apply.html` — application page
- `thank-you.html` — confirmation page
- `privacy.html`
- `terms.html`
- `404.html`

The generated static site is currently a **reference/archive**, not the active production funnel. Some generated page/source copy still reflects an older offer version and must not be treated as canonical until rebuilt from the current 7–13 program copy.

The page generator is:

- `scripts/build_pages.py`

If the static site is updated later, make copy changes in the generator and rebuild so generated HTML and source remain aligned.

## Current method

**Understand → Practice → Observe → Reflect → Retry**

The four current curriculum modules are:

1. Values, Identity, Purpose & Goals — *The Door Sign for My Future Home*
2. Communication — *The Conversation Bench*
3. Problem Solving — *The Bridge That Must Fail First*
4. Bodily Awareness — meditation, interoception, food, cooking, movement, strength and recovery

## Current funnel

Meta ad → short registration → free parent masterclass → approximately 5% video engagement → qualification → Zoom parent consultation → manual fit/offer decision → first payment → enrollment.

Operational rules:

- email only;
- no SMS;
- no WhatsApp automation;
- no publication without explicit owner approval;
- do not collect detailed clinical histories in public forms/bots;
- do not touch BNA or One Time assets during Inner Leadership builds.

## Local static-site development

```bash
npm run build
npm run check
npm run serve
```

Open `http://localhost:8080`.

The Netlify function infrastructure in this repository remains reference/future-code infrastructure unless explicitly reactivated. Do not place secret webhook URLs in browser code.

## Pre-launch gate

Before any public launch:

1. Install final Hebrew and English copy.
2. Install approved media.
3. Upload and QA the real masterclass recording.
4. Confirm one canonical Zoom consultation calendar in the current GHL location.
5. Run one complete Hebrew lead through the funnel.
6. Run one complete English lead through the funnel.
7. Confirm stage/state consistency and zero SMS actions.
8. Complete required legal/professional review.
9. Publish only after explicit owner approval.
