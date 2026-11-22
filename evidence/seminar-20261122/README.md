# JLFA-SEMINAR-MOBILE-DESTINATION-20261122-01

## Verified release — 22 November 2026, 11:26 America/New_York

**Live:** https://bneineviimacademy.org/fish — anonymous200, tested on the real hostname. [Exact receipts](release.json).

- App `3cd41cb1b097d856fcc64af8b76da34e53d9cfb7`, PR249 merged through required protected checks; Railway `1ff2dedc-0cc4-4471-93e3-7e9eba8311e0` SUCCESS.
- Gateway `b2f4bdc551155bb05b6116cc19507badab9fb368`, PR199 merged into the existing serving branch; Railway `754cd0b5-28a0-4e37-8179-9f1a4e62e4b4` SUCCESS.
- Required final CI45040379847 and control45040376214 passed. Independent exact-source and live review passed. Final CSS-only refinement fixed a real enlarged-text label collision; retained test-only reproduction rejects two painted-text collisions, corrected390 and different320 holdout reject none.
- Live Chromium/WebKit anonymous320/375/390/430 checks passed: metadata, contact/maps, original JPEG, PNG/SVG, copy/fallback, file-share fallback, recipient draft without backend requests/storage, QR dialog and keyboard focus. Local Android/iPhone emulation and supported-native-share stubs also passed.
- Public PNG downloaded and independently decoded to `/fish`; original downloaded JPEG remains byte-identical and its QR remains Maps. Existing BNA home, EN/HE Fishing pages and inquiry page text hashes, locked-logo and hero-image bytes match pre-release.
- Private API returns401; private page's existing Next streaming response navigates to `/en/login` (verified in a fresh anonymous browser). Unknown public children404 and POST `/fish`405.
- Existing inquiry admission was rebound to the exact reviewed commit/proxy hash, preserving all other policy fields and runtime variables. Current startup/automatic worker cycle states are healthy; no test inquiry, message, payment or credential change was performed.

Physical-phone QR scanning, actual WhatsApp handoff/preview cache and native share sheet remain unverified. The operator should check those on a handset; emulation/stubs are not handset acceptance. Repository/service renaming remains a separately tracked cleanup, not part of this release.

This final evidence is a documentation-only follow-up branch. Runtime source remains the two exact commits above; no extra redeploy is required for these records. Earlier checkpoints below are history.

Baseline: `d6f54cc05a1e58e794985c35c954fca9ed5949fb`, same as observed Railway deployment `1f262f0d-225e-48ae-9bcc-79107051b142`. New clean local checkout, branch `codex/fishing-seminar-mobile-20261122`. Existing remote PRs inspected; no overlapping seminar implementation was observed. Historical integrator chat is not accessible from this host; no cross-host lease or ownership transfer is claimed.

## Task-specific design brief

Audience: a parent viewing a seminar link or scanning the owner's phone. Primary action: WhatsApp Rabbi Shlomo. Hierarchy: restrained exact logo, seminar title/hook, readable date/location/age, WhatsApp/directions, original flyer, sharing and large QR. Single centered column, navy/white/gold, 20px narrow-screen gutters, 44px minimum controls, no floating obstruction. Flyer remains proportional and uncropped. Native sharing has a visible download/copy fallback. After the Florida event date, show next-seminar inquiry wording and retain the historical details.

## Requirements and evidence

| Requirement | Implementation | Status/evidence |
| --- | --- | --- |
| Clear Fishing identity and separate local checkout | Root README and docs/FISHING-ACADEMY-START-HERE.md | Local setup verified; repository/service rename deferred |
| Readable event and exact latest supplied flyer | Seminar configuration/page and public/seminar | In progress |
| WhatsApp, phone, exact directions | Seminar page | In progress |
| Sharing/copy/recipient draft/native file fallback | Client controls; no recipient persistence | In progress |
| Large QR + PNG/SVG, decode | Deterministic exports | Pending |
| Exact public route/assets and metadata | Fishing proxy and bounded BNA gateway | In progress |
| Mobile/anonymous/private boundaries | Focused tests + rendered inspection | Pending |
| Independent review, protected CI, exact deployment/live smoke | Existing GitHub/Railway workflow | Pending |

Original requested PNG is not locally available. The owner downloaded and supplied `WhatsApp Image 2026-11-22 at 02.42.21.jpeg` during this task. Visually inspected; exact bytes copied as `bass-fishing-seminar-20261122.jpg`, SHA-256 `4a4d3219ae6246daaaecf4fdbf0a26f391ae6bbcd63d7c989305f957bc6f0eef`. This is a separately identified owner-supplied JPEG, not a claim of matching the earlier PNG hash. Locked logo SHA-256 matches `e78ff6d3ef16c37613725507ce14da05883734a77f48b78ab9d6df3f92480356`.

No genuine inquiry submissions, customer messages, payments or runtime-secret changes are required or authorized for tests. Browser emulation, deployment, and physical-phone acceptance remain distinct.

## Verification checkpoint

91 focused seminar/proxy unit tests passed; full lint and production build passed. Independent reviewer reran 91 app/45 gateway tests and identified two P2 issues: internal-origin alias redirect and repeated event metadata outside configuration. Both corrected, with an internal-host regression. Final reviewer readback and post-fix tests remain pending.

Original JPEG QR decoded to the exact supplied Maps URL. New deterministic PNG QR decoded to `https://bneineviimacademy.org/fish`; SVG shares the same matrix. Generator uses authoring-only qrcode 8.2 and zxing-cpp 3.1.1; no new runtime package.

Opened and inspected actual Chromium mobile-emulation screenshots at 320, 375, 390 and 430px plus the large QR view. Balanced gutters, uncropped flyer, readable date/contact and no overflow observed. A test locator initially matched Next's accessibility announcer as well as the validation error; tightened to the actual input error. Browser smoke found a missing favicon request; added an explicit exact-logo icon. Repeat final smoke after rebuild; no physical-phone or Safari acceptance is claimed.
