---
name: fishing-browser-visual-review
description: Test Fishing Academy UI in a real browser and inspect actual EN/HE desktop and mobile renders against current Fishing references. Use for browser or visual acceptance, not screenshot generation alone, production-data testing, or BNA review.
---

Read root `AGENTS.md`, `apps/life-skills/docs/academy-public-current.md` and the current Fishing UI/Website/Brand and continuation clauses linked there. Inspect existing Playwright configuration/tests and the exact target before choosing a command. Reuse installed Playwright/Chrome where sufficient; do not install another stack or claim unavailable global plugins are installed.

Establish scope, commit, URL/environment, baseline and allowed effects. Separate component harness, mounted app, disposable native database, deployed site and provider acceptance. Do not run an undifferentiated suite that provisions/migrates/sends against real services during setup. Use synthetic fixtures and isolated browser storage. Keep cookies, tokens, family data and private screenshots out of public Git.

Use current UI's viewport/state matrix. At setup it requests EN/HE at 320x568, 375px, 390x844, 430x932, 1366x768 and 1440x900, plus short heights, enlarged text/200% zoom, RTL, keyboard and reduced motion. Refresh this from UI for actual tasks. Label Chromium mobile emulation accurately; it is not physical iPhone/Safari testing. Distinguish browser zoom from CSS/text-enlargement emulation.

Capture baseline/candidate screens with intended header, CSS, fonts and imagery. Save initial-viewport and full-page views after fonts/images/states settle. Check overflow, broken images, console errors, bounding boxes and localized destinations. Exercise menu, Escape/focus restoration, FAQ, sibling controls, locale/state preservation and authorized form failure/retry. Synthetic receipts cannot prove persistence; native save/reload/new-session and owner readback need an admitted disposable environment.

Open and visually inspect screenshots with the available image viewer or supported browser/computer-use surface. Inspect hierarchy, subjects/crop, contrast/readability, gutters, centering, rhythm, CTA, focus, navigation and form states. Compare with an identified approved reference and record defects or missing baseline approval. Screenshots on disk, passing assertions and unchanged hashes are not visual inspection or owner acceptance.

Retain failures and console evidence; fix only authorized files and repeat affected checks. Keep screenshots/traces/reports outside public Git unless reviewed as public-safe. Record commit, target, viewport/locale, fixture/effect scope, exact image paths and what was actually opened in existing Delivery. Keep generated, inspected, technically passed, owner-accepted, integrated and live-verified distinct. Report inaccessible browsers/devices/references and continue independent setup. No send, payment, deployment or ownership transfer is authorized.
