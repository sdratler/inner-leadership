# WEB-020 teal website release candidate

- Run: `WEB020-20260910T151455+03`
- Branch: `codex/web-020-teal-release-20260910`
- Exact base: `6326ae04cd1ed2d81f68e47111945edee0bbf5cd`
- Recorded: `2026-09-10T16:02:09+03:00`
- Decisions: `D-LOGO-LEAF-20260910-01`, `D-WEB-TEAL-LOCK-20260910-01`, `D-WEB-ABOUT-20260910-01`
- Parallel exclusion: no `creative/**` file or PR #16 state was changed.

## Locked asset verification

- Approved master: `assets/images/LS_LOGO_HE_LEAF_APPROVED_20260910.png`
- Master SHA256: `a95609b2ce76f5062be6619e5131430f11b99d7579148affebb2b545f66cc07c`
- Transparent placement derivative: `assets/images/LS_LOGO_HE_LEAF_APPROVED_20260910-transparent.png`
- Derivative SHA256: `023fc129c4cf2bf0a04c6a8ae5051118eb5d3eef1d75685b5a3941fb7b92ce2d`
- Derivative procedure: crop the source canvas to the approved leaf bounds and derive alpha from the neutral exterior only. Every visible derivative RGB pixel was verified against the corresponding master pixel; no interior pixel was redrawn, recolored, mirrored, retyped or regenerated.
- CSS applies no filter, blend mode, or tint to the Hebrew logo.

## Fonts

- `FrankRuhlLibre-wght.ttf`: self-hosted variable 300–900 Hebrew serif, used at weight 700 for Hebrew display text.
- `Heebo-wght.ttf`: self-hosted variable 100–900 Hebrew sans, used at 400/500/700 for body and UI.
- Both OFL 1.1 license files remain in `assets/fonts/` and the production allowlist.
- Primary-source verification: Google Fonts identifies Frank Ruhl Libre as the open-source revival of classic Frank Rühl, primary script Hebrew, weights 300–900, license OFL (`google/fonts/ofl/frankruhllibre`).

## Checks

- `python3 tools/ci/verify-ci-boundary.py`: pass (`CI_BOUNDARY_OK`).
- `python3 -m unittest discover -s tools/source-audit/tests -v`: 52/52 pass.
- `npm run check`: 43 Node checks + 26 Python static checks pass.
- `node --test tests/web-020/teal-release.test.cjs`: 5/5 pass.
- `npm run build`: production build pass; zero publication blockers; no function bundle.
- `npm run check:server`: 11/11 pass, including hardened headers, route/query behavior, private-file denial and Railway `/health`.
- `apps/life-skills`: lint pass, type generation/typecheck pass, Vitest 126/126 pass, Next production build pass.
- `npm ci`: 0 reported vulnerabilities.
- `git diff --check`: pass.

## Browser QA

Playwright Chromium inspected both locales at 320×844, 390×844 and 1440×1000 against the production static build served by `server.js`.

- No horizontal overflow at any size (`scrollWidth === viewport width`).
- HE/EN language and direction attributes are correct.
- 390px HE: 98px toolbar, 22px inline padding, 170px approved leaf, 44px menu target, 28px hero gutters, 64/66 display type, 72×2 gold divider, 27px service line, LTR `8–12`, 334×56 real WhatsApp CTA.
- 320px HE: approved 56/59 display fallback and 264×56 CTA.
- Frank Ruhl Libre 700 and Heebo 400/700 all resolve through `document.fonts` on Hebrew pages.
- Approved leaf source is exact and computed `filter` is `none`.
- Menu opens with `aria-expanded=true`, closes on Escape, and shows a 3px gold keyboard focus outline.
- Carousel contains W01–W12 in numeric order, advances 1/12 → 2/12 → 12/12, remains at 12/12 without autoplay, and supports Home/End/RTL arrow keys.
- Reduced-motion context reports `prefers-reduced-motion: reduce`; document and carousel scroll behavior are `auto`, reveal transition duration is 0s.
- Every lazy image was exercised through all twelve slides and downstream sections; zero broken images and zero failed browser requests.
- About heading/copy resolves correctly in both locales with exactly three paragraphs and the approved grass photograph.
- Fees, privacy/terms disclosure, testimonial attribution, contact destination and Bnei Neviim Academy relationship remain present.

Pixel screenshots used for review are stored outside the repository under the run workspace. They include identifiable minors and therefore are deliberately not committed.

## Build digests

- `assets/css/site.css`: `9805748d9122137596b6c41eb99b0fbd418b8b82be90b8b395ddfe1afb88bc76`
- `assets/js/site-react.js`: `49b208ee1d172573b30ad1bde9a8f1683200878ec725530727f736b209875dc7`
- `dist/site/index.html`: `17c6ee19ace45c99bbabc1ae4210fa320de2435e9b9625485ba7be596f73c300`

These are release-candidate digests. The final merge SHA, Railway deployment ID, production headers and public HE/EN verification are recorded after merge/deploy.
