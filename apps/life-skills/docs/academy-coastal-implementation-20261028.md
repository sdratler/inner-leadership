# Academy coastal refinement — implementation handoff

State: local code changes, no commit/push/deployment or production effects.

Release authorization: the owner subsequently requested “Deploy everything ...
all the updates” on 28 October. The prior no-deployment hold below is historical;
this authorizes the normal protected release of this coastal website/form slice.
Actual merge, deployment and serving evidence remain separately recorded.

## Baseline and authority

Implemented the owner's attached `02_CODEX_IMPLEMENTATION_BRIEF.md` from
`Fishing_Academy_Codex_Handoff.zip`, supplied 28 October 2026. The explicit
request approves revised marketing copy, light reordering and coastal design.
It supersedes the earlier exact-copy restriction only for this presentation work.

Inspected HEAD `d23ab5b3357ea0b75fe32c1b838fb14e6aabf329` and snapshot
`8e78ad934ba05f51b9d7ee2504be5a13b7d382dc` before editing: their trees have no
differences. The latter is the merge of the former. No newer source was reverted.
The existing dirty generated `next-env.d.ts` is restored after Next's build;
its original SHA256 is `0f70629890b72a0a82e91972cc032c04b658b26c265373cb711cf576bfbf8fcc`.

Read the current Operating revision
`AHj4eMRY_iDVcXghZxSJVWdYdXwl2G_12hGIsvM6Yf29PeODiPU_qpcHSgpkrcd0iNJ1FHQQIsW56Bt-YosPOo2WpXGGpuTWV-g2bLht6Jo`.
Its wider CRM/retired-business work is separate from this explicitly scoped
Academy presentation assignment and has not been adopted here.

## Implemented

- Removed the legacy brand scope from the Academy frame, resolving its h1/body
  cascade conflicts without changing other pages' brand stylesheet.
- Desktop hero overlays use the measured header height and available viewport.
  The original full-width photograph keeps its natural ratio and every pixel.
  The complete action group has 28px bottom clearance at all four target desktops.
  Existing mobile art direction, enlarged-content flow and image failure remain.
- One versioned EN/HE coastal marketing binding overlays the immutable Exact05
  projection. Combined introduction/audience, six concrete practice benefits,
  numbered stages with secondary links, founder before pricing, parent journey,
  closing invitation and useful footer contacts/terms.
- Removed the medication testimonial from this public presentation. Git history
  retains its original wording and approved asset; no replacement quote invented.
- Prices still use `founderPrice`; the block is named “Four-session block.”
  Phase-specific amounts, eligibility and server-derived counter remain intact.
- Compact expandable form rates, earlier first field, lighter child cards,
  section numbering, clear optional phone and non-selected choice prompts.
  Six terms disclosures stay one-open and now flow with the page. Disclosure
  hashes reveal/focus a keyboard-reachable summary. Footer terms stay within the
  entered form and remain readable after save.
- Saved summary replaces the entry fields and hides signup CTAs, while keeping
  contact and terms available. Actual save/result handling and all server
  contracts are unchanged.
- Curriculum uses shareable `?age=8-10|11-13|14-17`, preserves learning depth
  across stages/locales and Back/Forward, and safely defaults invalid/duplicate
  values. All 48 stable lesson identities, both languages, exact summaries,
  three age panels per stage and Foundation101/103/102 order are unchanged.
- Header behavior now matches its CSS1000px breakpoint. Floating WhatsApp is
  replaced with inline contact access on the form.

## Verification

- `npm test`: 257 files / 3,802 tests passed.
- `npm run lint`: full app, zero warnings.
- `npm run build`: production build and TypeScript succeeded. Retained warning:
  existing `academy-signup-population-runtime.ts:14` dynamically traces project
  files; that backend code was not changed by this assignment.
- `npm exec tsc -- --noEmit --incremental false`: passed.
- `git diff --check`: passed.
- Age navigation: 19 focused tests passed; source/SSR and history subscriptions.
- Local browser checks use actual React components/CSS with a loopback-only
  preview, mocked campaign/challenge/save responses and synthetic data. The
  server rejects every POST; Playwright intercepts the test saves in memory.
  No database, production request, real email or WhatsApp send occurs.
- EN/HE: two children, ZIP01234, drive37, independent parent-language selection,
  locale changes, validation summary, both required acknowledgments, optional
  WhatsApp unchecked, saved view, retained terms, no post-save signup CTA,
  disclosure focus and inline WhatsApp all passed. One mocked POST per locale.
- EN/HE: all four stages / twelve visible lessons / three age selections,
  menu Escape/focus return/950–1000px boundary, enlarged text, reduced-motion
  emulation and hero image-failure fallback passed.
- Visual captures: EN/HE at1280×720,1366×768,1440×900,1920×1080,320×568,
  360×800,390×844,430×932,768×1024,950×800. No horizontal page overflow.
  All requested desktop action groups visible. At320×568, the natural mobile
  photo can extend below the initial viewport; text remains readable and scrolls.
- Before/after form first field at390px: EN661→536px; HE661→510px.

Evidence directory: `D:/academy-coastal-evidence-20261028/`.
`visual-results.json`, `interaction-results.json`, `resilience-results.json`
contain measured results. `before/` and `after/` contain the actual captures.
These are component-browser/lab results, not deployed Next acceptance, native
Safari/physical-device/OS-zoom proof, field performance or new persistence proof.
Real API/auth/email/confirmation contracts retain their passing unit coverage.

## Policy and release notes

- No new policy decision was required to implement these improvements. Current
  owner timing starts the payment window with the actual announced confirmed
  group date, not registration/initial email/interest confirmation. Historical
  snapshot references to a different initial clock remain superseded.
- Existing “selected administration fee” / “selected early-refund rule” language
  remains verbatim in payment information. Final paid-offer/legal copy is a
  separate review; this refinement does not authorize fees or refunds.
- Retained hero $300 line without inventing a $1,950 comparison/baseline. Counter
  numbers shown in previews are expressly mocked, never current availability.
- Retained noindex/nofollow; public-indexing intent requires a separate decision.
- Release remains held by the owner's explicit no-deployment instruction.
  Current-candidate protected CI, normal merge and production serving checks
  have not been run for these uncommitted changes.
