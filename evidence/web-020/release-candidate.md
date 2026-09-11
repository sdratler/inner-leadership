# WEB-020 approved hero-master release candidate

- Run: `WEB020-20260911T1025+03-HERO06`
- Branch: `codex/web-020-centered-hero-20260911-1025`
- Reconciled base: `23f152abb1a2b3424022ffa78232ede07eb83abb`
- Decisions: `D-WEB-HERO-LAYERING-20260911-06`, `OWNER-HERO-TYPE-20260911-01`
- Owner review: EN mobile approved on 2026-09-11; the same continuing task then approved HE mobile and both checked desktop variants.

## Implemented contract

The hero now selects one exact owner-approved composite master by locale and viewport. The master pixels contain the approved headline, service, age, real founder-and-boy photograph, teal/cream treatment, benefit icons and labels, and shallow bottom curve. The toolbar and WhatsApp anchor remain real, accessible website controls. Equivalent hero text and benefit labels remain in screen-reader semantics before the figure. No OpenArt generation or model credits were used for this website change.

The header keeps the exact approved Hebrew leaf and separate live `Life Skills` text in both languages. At mobile widths the direct locale control remains visible beside the real menu button and mirrors with locale direction. The WhatsApp control remains a genuine anchor to `https://wa.me/972534932631` with the approved locale-specific label.

## Exact installed masters

| Slot | Public asset path | Dimensions | SHA256 |
| --- | --- | ---: | --- |
| EN mobile | `assets/images/founder-boy-hero-en-mobile.png` | 941×1529 | `ee2924444efc3d21dda5186b3a1107c3fde935ce4c76ded75ae3458aa99c7a71` |
| HE mobile | `assets/images/founder-boy-hero-he-mobile.png` | 941×1529 | `56dc8fcbe99f16d723a8b07b41eda8ebb03eb27716829b8c786f27b82a3ddcbe` |
| EN desktop | `assets/images/founder-boy-hero-en-desktop.png` | 2400×1350 | `5c28d22d7b6b784eb6becb4cfabb7977c80a304b5bcaca93943564ed74394f50` |
| HE desktop | `assets/images/founder-boy-hero-he-desktop.png` | 2400×1350 | `74c7d3258770abdab5c146e1211c4cbd16e0738840d5c274390f9a707f8dd824` |

`node creative/bin/verify-master-contract.mjs --ready` independently read each file header and checksum and returned `ready_count: 4`, `required_count: 4`, no warnings and no errors.

## Browser QA

Headless Chromium inspected HE and EN at 1440×1200, 390×844, 360×800 and 320×720 against the production static build. All eight cases returned HTTP 200 and passed:

- exact locale/orientation image selection and intrinsic dimensions;
- complete 98px toolbar, approved leaf with no CSS filter, live `Life Skills`, and mirrored mobile language/menu controls;
- complete hero and WhatsApp button inside every tested first mobile viewport;
- direct WhatsApp destination and exact locale CTA label;
- no horizontal overflow, failed requests, console errors or broken images;
- Frank Ruhl Libre 700 and Heebo 400/700 loaded;
- screen-reader headline, service/age and all three benefit labels present in source order.

Screenshots remain outside Git because the hero includes an identifiable minor. Key local receipts:

- EN desktop first view: `a8a0eebae64ca764f54f3763e3d072d2870cb338d72a4a7f133b25857fdf98ea`
- HE desktop first view: `53f7920a0066746f0571aca9de8fc1db0ecb75fd4963582311154311bb50b19b`
- EN 390×844 first view: `061214629357b16e343fcf397e20af8e1bf633212021c1ebab404f1f37f72885`
- HE 390×844 first view: `6bf9fd6c9505a1a17e75b62d3eee15b49dae1228c37e3d0c42d9c62a737b1918`
- EN 320×720 first view: `9f8f8e80c54ad12ec85c142285e579dcd463113f87e422954b6dd7ea7c5dbbc8`
- HE 320×720 first view: `9ea2bc80ea6dbbcfb6654a60dd2e5bdf8093fa4c35e30fefd5969613742265bf`
- EN full page: `2691a6d61cde437b76b17f008d7c6e5128b97a274c069bbe8019ab011f613a2b`
- HE full page: `d1e94dd79cd720482f92888e76a286751ba74da4c233808c0b05dbf6a9527387`

## Checks

- `python3 tools/ci/verify-ci-boundary.py`: `CI_BOUNDARY_OK`.
- `python3 -m unittest discover -s tools/source-audit/tests -v`: 52/52 pass.
- `node creative/bin/verify-master-contract.mjs --ready`: 4/4 approved masters ready.
- `node --test tests/web-020/teal-release.test.cjs`: 10/10 pass.
- `npm run check`: 43 Node checks and 26 Python checks pass.
- `npm run build`: production build pass with zero publication blockers and no function bundle.
- `npm run check:server`: 11/11 pass.
- `git diff --check`: pass.

## Build digests

- `assets/css/site.css`: `930de9814203e76d3076474c3b5b153027f361a070a7a5b27a6edc123be5c1c6`
- `assets/js/site-react.js`: `fa29e162f5b06753422c56b45d426b0eab449bdf0a0b29cae3418765479a8253`
- `dist/site/index.html`: `d2bf21d73d7938707d2bf644b8f3c30b0d802840379a03614fc7746ab3facb19`

The downstream academy route import and public deployment are recorded separately after the source PR is merged and the production URL is verified.
