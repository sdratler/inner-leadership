# WEB-020 OG/content correction evidence — 2026-09-13

- Run/claim: `WEB020-20260913T221124+03-OGCONTENT`
- Baseline: `9956e396dfb19d5ae6e3ce2a1136b107027679b7`
- Branch: `codex/web-020-og-content-20260913-2211`
- Source epoch: `SOURCE-COORD-20260913-02`
- Admission: fresh manual connector/Git audit; no automated checker PASS is claimed because the checked-in workflow instructions are stale.

## Approved social image

- OpenArt history/generation ID: `avJp5dVmQ57ZwWoxUzxF`
- OpenArt resource ID: `hJLsVPvmQEAidSZ05PYj`
- Installed path: `assets/images/og/LS_OG_MASTER_HE_V1_20260913.png`
- Dimensions: `1376 × 768`
- Size: `1,483,572 bytes`
- SHA256: `209bdb5a7c6fa8573dead56e22d1213787e7e080f2d701fbe5901480029313ab`
- Treatment: exact downloaded pixels; no crop, recolor, regeneration or added text.
- The same owner-approved Hebrew image is referenced by both language routes. No separate English social image is represented as approved.

## Preserved hero masters

- `founder-boy-hero-en-mobile.png`: `ee2924444efc3d21dda5186b3a1107c3fde935ce4c76ded75ae3458aa99c7a71`
- `founder-boy-hero-he-mobile.png`: `56dc8fcbe99f16d723a8b07b41eda8ebb03eb27716829b8c786f27b82a3ddcbe`
- `founder-boy-hero-en-desktop.png`: `5c28d22d7b6b784eb6becb4cfabb7977c80a304b5bcaca93943564ed74394f50`
- `founder-boy-hero-he-desktop.png`: `74c7d3258770abdab5c146e1211c4cbd16e0738840d5c274390f9a707f8dd824`

## Implemented page structure

1. Locked photographic hero with live toolbar and direct WhatsApp link.
2. Concise full-width teal approach section.
3. Cream/sand parent-guidance section immediately after the approach.
4. Twelve illustrated teaching modules in continuous document order, with no carousel, accordions or public Example boxes.
5. Existing LB testimonial before the founder section.
6. Existing grass-group founder composition, FAQ, centered closing CTA and nonprofit footer.

## Illustration placement

| Theme | Installed file |
| --- | --- |
| W01 | `LS-WEB-04__p03__r01.webp` |
| W02 | `LS-CUR-W02__p03__r01.webp` |
| W03 | `LS-CUR-W03__p02__r01.webp` |
| W04 | `LS-CUR-W04__p03__r01.webp` |
| W05 | `LS-WEB-02__p02__r01.webp` |
| W06 | `LS-WEB-03__p03__r01.webp` |
| W07 | `LS-CUR-W07__p03__r01.webp` |
| W08 | `LS-AD-A07__p03__r01.webp` |
| W09 | `LS-CUR-W09__p03__r01.webp` |
| W10 | `LS-CUR-W10__p03__r01.webp` |
| W11 | `LS-CUR-W11__p03__r01.webp` |
| W12 | `LS-WEB-04__p03__r01.webp` (approved reuse) |

No rendered module has a missing image or placeholder. W01 and W12 intentionally reuse the approved wide courtyard illustration.

## Verification

- Static/server/WEB-020 tests: 65 passed, 0 failed.
- Python structural tests: 26 passed, 0 failed.
- Production build: succeeded with zero publication blockers and the OG image in the public allowlist.
- Browser QA: HE/EN at 1440 desktop and 390×844, 360×800 and 320×700 mobile.
- Browser result: 12 modules, 0 public Example boxes, 0 horizontal overflow; all deferred images loaded during full-page traversal.
- Mobile result: live language switch visible in the 98px toolbar and hero WhatsApp CTA inside the first viewport at all three tested widths.
- Automatic WhatsApp responses remain outside the website and remain off.

Screenshot binaries are retained as local review artifacts outside Git to avoid publishing additional identifiable-photo copies in repository history.
