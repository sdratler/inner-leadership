# WEB-010 v4.5.5 release candidate — 2026-09-09

## Candidate scope

- Hebrew brand lockup: `כישורי חיים` / `לחיים שלמים`, with the olive-branch mark.
- English brand: `Life Skills` only; no English tagline is displayed.
- Current v4.5.4 bilingual copy and v4.5.5 visual finish, including the later owner-approved mobile hero refinement and all twelve continuous modules.
- Direct verified WhatsApp destination: `https://wa.me/972534932631`.
- Existing founder-and-boy hero, grass-group About photograph, curriculum artwork, local fonts and SVG icons; no new image generation.
- Existing testimonial quote remains exactly “Medication is no longer relevant…” with attribution `LB, 2024`.

## Testimonial publication evidence

Owner instruction `LS-LB-CONSENT-20260909-001`, recorded 9 September 2026, explicitly confirms consent and authorizes public use of the existing LB quote and supplied portrait with attribution `LB, 2024`. This is owner-confirmed authorization; it is not represented as independently verified paperwork or a signed release. The exact quote is not expanded into a general medication claim.

## Verification

All commands completed with exit code 0 on 2026-09-09:

```text
npm run check
npm run build
npm run check:server
git diff --check
```

The production build reported zero publication blockers. Browser validation covers Hebrew and English at 1440px and 390px, actual font loading, complete hero faces, all local images, the testimonial, direct WhatsApp links and no horizontal overflow.

## Control boundary

Owner launch authorization `LS-WEB-LAUNCH-20260909-001` permits the scoped branch, protected PR, merge and production deployment for `/life-skills/`. It does not authorize changes to the academy homepage, login/app routes, DNS, email, advertising budgets, unrelated campaigns or private-practice application.
