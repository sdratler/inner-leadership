# Life Skills / כישורי חיים

This repository contains the bilingual Life Skills website source and the separate private-application code. Current business intent comes from the registered Drive contracts; this README is a navigation page, not another brand kit or offer specification.

## Start here

1. Read [AGENTS.md](AGENTS.md) and the [CURRENT source registry](https://docs.google.com/document/d/1XZS-MzUtjc3T488lyrSbtDX0Yq5UCl7Wzh5uN_YOvMg/edit).
2. Read [Build Control](https://docs.google.com/spreadsheets/d/1Y_Vf_kipj7mAhhEnuj8F2L85v3KpOi_V9KfSrj4MZ4Y/edit) and the [Operating Protocol](https://docs.google.com/document/d/1q-GDEaL9JmmVfy1meQrGvu3V4H2XNJ4jp2b17ZrP6bE/edit) for current ownership, dependencies and release instructions.
3. For any hero, logo, image or ad work, read [creative/README.md](creative/README.md). Resolve the exact registered assets before editing or generating anything.

The owner-requested project-wide workflow is in [PROJECT-WORKFLOW.md](docs/PROJECT-WORKFLOW.md), with the [source audit](docs/PROJECT-WORKFLOW-AUDIT-20260911.md), [project instructions](docs/PROJECT-INSTRUCTIONS-TO-PASTE.md), and [complete Codex execution handoff](docs/CODEX-COMPLETE-HANDOFF.md). The handoff covers four hero masters, the website release, 30 finished creatives, the operator/watchdog and lead-to-CRM verification. These documents distinguish prepared work from installed automation and completed outputs.

Use the same current source records and manifests when an owner correction arrives. An old prompt, a successful test, an OpenArt upload or a PR comment alone does not prove that a finished image is approved, integrated or live.

## The approved image is the visual master

The website hero must display the exact approved image bytes. Its visible headline, service, age, photograph, benefit icons and labels, shading, fade and curve are part of that image. Codex adds only the live header/toolbar and the real WhatsApp button in the reserved position. Equivalent hero semantics may be visually hidden for accessibility; they must not duplicate or reconstruct the visible design.

Do not recreate the hero with HTML/CSS/SVG, recolor it, regenerate it, substitute a similar reference or silently crop away its composition. The `creative/**` registry records asset identity, approval scope, hashes and permitted placement. `tools/life-skills-operator/**`, when integrated, must consume that registry rather than own another brand kit. A pending record is not an approved master.

Immediate production order is the four website masters: Hebrew/English, mobile/desktop. Work from the already chosen composition, review one candidate at a time, and preserve approved pixels. Batch ad variants follow the registered master and the credit/receipt policy in [creative/README.md](creative/README.md). Do not generate a new design for every post.

## Repository surfaces and existing commands

| Surface | Source / instructions | Existing verification |
| --- | --- | --- |
| Public bilingual website | `src/life-skills-page.jsx`, `website/`, `assets/`, `scripts/build_life_skills_site.py` | Root `npm run check`, `npm run check:server`, `npm run build` |
| Local website preview | Root [package.json](package.json), `server.js` | `npm run build:preview`, then `npm start` |
| Private application | [apps/life-skills/README.md](apps/life-skills/README.md) | Follow that directory's integration and verification instructions |
| Source integrity | [tools/source-audit/README.md](tools/source-audit/README.md) | Follow its read-only source gate; never refresh fingerprints just to suppress drift |
| Creative assets and execution contract | [creative/README.md](creative/README.md) | Verify actual asset bytes, approval evidence and allowed controls; do not treat contract documentation as a completed generator |

The source repository and the production repository are separate. The existing public `/life-skills/` release is downstream in `shloimie-beep/bnei-neviim-academy`. A source change is not a deployment receipt. Verify the exact released revision and live result before reporting a website update as complete.

## Historical material

The earlier Inner Leadership offer, ages 7–13, Beit Shemesh location, pricing, Google-first funnel and GHL production instructions formerly presented here are historical. They are not current Life Skills authority. Their provenance remains in Git history and the existing `ACQUISITION_PIVOT_2026-08-23.md`, `GHL_*.md`, `GOOGLE_ADS_LAUNCH_PLAN.md`, `WEBSITE_COPY_EN_HE.md`, `MARKETING_POSITIONING_AND_VIDEO_SCRIPTS.md` and `EMAIL_FUNNEL_EN_HE.md` files. Consult the CURRENT registry before using any of them; their filenames do not establish current approval.

Keep private originals, identifiable-minor proofs, client information and credentials outside Git and public CI artifacts. Record neutral asset identifiers and verification receipts instead. Image generation, publishing, messaging, ad spend and deployment are distinct actions: apply the owner's existing authorization to the exact action and do not infer completion or permission from another action's status.
