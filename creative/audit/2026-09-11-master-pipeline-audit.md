# Life Skills master-image pipeline audit — 11 September 2026

## Conclusion

The owner had selected a visual reference, but the execution system never established the corresponding final image masters. It repeatedly interpreted the selected picture as styling instructions, stripped its copy/icons and rebuilt them in code. Prompt approval, technical tests and completed generation receipts were then mistaken for visual approval or installed automation.

The chosen design does not need to be invented again. The immediate task is to produce one surgical English-mobile derivative of the known reference, removing toolbar and painted WhatsApp control plus the now-approved Self-governance label correction, inspect it, and then complete the other three masters one at a time. A finished master retains all visible copy/icons/photo/treatment. Website code adds only the real header and WhatsApp control.

This audit produced a scoped documentation/manifest/readiness-check correction. It did not create image assets, rewrite the website or operator, merge PRs, deploy, post messages, or activate ads. Generation credits spent: **0**.

## Evidence and scope

- Read the full visible owner conversation and the entire supplied `Pasted markdown(5).md` (1,130 lines including final empty line). Private conversation/export bytes are not copied into Git. Line numbers below refer to that attachment.
- Retrieved CURRENT Start Here, Operating Protocol, Website Brief 3.0, MKT-060 1.8 and the existing Codex ad-production handoff. Read bounded Build Control Workflow Control/Work Graph rows, including CRE-010, SYS-040 and MKT-060.
- Inspected source repository `sdratler/inner-leadership` main at `0af6981cbab1c5e79ebc0ffb4d29bd08020b7729`, root instructions, PR #16/#22/#23 metadata/comments and relevant source files.
- Inspected complete upload and creation lists for OpenArt project `life skills` (registered private project ID): 4 uploads and 4 completed generations, neither list truncated. This is not an inventory of every project/account or the owner's computer.
- Downloaded and visually inspected the exact chosen reference from Drive; independently verified its SHA256 and dimensions. Downloaded/rehashed Photo B. OpenArt metadata for the reference and Photo A was verified; direct CDN byte download returned HTTP403, so this audit does **not** independently repeat the earlier cross-provider byte comparison or Photo A hash proof.
- Source repo is separate from downstream public deployment `shloimie-beep/bnei-neviim-academy`. No live deployment/browser/funnel audit was performed in this scoped creative audit.

## Verified failure chain

| Finding | Evidence | Consequence / correction |
| --- | --- | --- |
| Owner's request was inverted | Transcript line3 asks to remove toolbar/button only; lines96–115 remove headline/icons too; lines219–220 encode live copy/benefits | Correct the implementation contract, not the owner's wording |
| Correcting a comment did not correct code | PR16 `ed55e2e210050897899efa9fe5b625ae9cca014d`; PR22 `e017c34744ff5637169bf3049ce168c5dede0222`; PR23 `7904ecb87ea73e44b6414510b914eb03d97efdf7` remain open drafts at audited heads | Reconcile the actual code before integration |
| Duplicate brand truth | PR22 `src/state.mjs` loads `config/life-skills-brand-kit.v1.json`; `src/intent-agent.mjs` and compiler/assertions insist on live copy/benefits | Read canonical creative manifests; missing/stale master blocks that job without fallback |
| Tests enshrine the error | PR22 tests require benefits outside the raster; PR23 renders headline/service/age/benefits in React | Passing these tests does not prove the approved image is displayed |
| Main has no installed creative system | Neither `creative/**` nor `tools/life-skills-operator/**` exists at audited main; each exists only in a draft PR | Mark this reconciliation as draft until accepted; no claim of operating automation |
| Old README is a different offer | Root README promoted Inner Leadership ages7–13, Beit Shemesh, old labs/prices/GHL route | Replace active entry point with current registry links; historical docs remain provenance |
| Supposed bulk engine is incomplete | PR22 delegates prose to Codex and prints output; no implemented OpenArt queue, durable output receipt, dedupe or credit ledger | Implement adapter/state transitions before advertising unattended bulk production |
| Even planning can cost money | Real `plan` calls the intent model; only fixtures avoid it | Structured plans must be local; optional paid interpretation separately metered |
| Spend flags are misleading | Generation may be enabled while generic spend/providerMutation flags are false | Explicit image-credit budget separate from Meta budget |
| Settings differ from prompt | One inspected OpenArt job (ID retained in private audit) asked4:5 in prose, submitted1:1 and returned1024×1024 | Validate actual request schema and output dimensions |
| Ratios are approximate | Other three 4:5 requests returned1856×2304, not exact4:5 | Verify final dimensions; approve any final sizing/composition operation before promotion |
| Rejected copy is still active | Existing ad handoff includes C03 belonging/contribution and C05 'I have a role', both rejected in this conversation | Block these rows until reconciled; do not automatically produce all five concepts |
| Partial canonical correction leaves contradictory prose | Website contains superseded §21–22 and current §23; ad handoff read-first says2.9/1.7 while later paragraph says3.0; MKT includes old UI-free paragraph before1.8 correction | Resolve current section once; never concatenate conflicting generations of the instruction |
| Prompt lock cannot preserve pixels | Current Nano Banana Pro form exposes no edit mask/seed/pixel-lock parameter | Use verified approved assets; exact localized edits require underlay/mask and outside-mask comparison |

Correction comments were independently found on all three PRs: [#16](https://github.com/sdratler/inner-leadership/pull/16#issuecomment-5631973205), [#22](https://github.com/sdratler/inner-leadership/pull/22#issuecomment-5631553154), [#23](https://github.com/sdratler/inner-leadership/pull/23#issuecomment-5631551595). Build Control marks CRE-010 and SYS-040 stale/rebase required. MKT-060 is blocked and notes that rejected outputs are not production masters. These are actual readbacks, not proof that remediation code is installed.

## What exists now

| Item | Verified state |
| --- | --- |
| Selected teal mobile reference | 941×1672; exact Drive/OpenArt IDs and verified SHA256 retained in the existing private handoff |
| Exact Photo A | 4000×3000; provider ID/dimensions/size verified; reported original hash retained privately with explicit verification caveat |
| Exact Photo B | 4000×3000; exact Drive bytes/hash verified and recorded privately; no project upload ID yet |
| Four final website masters | **Not found in audited main, PR registries or complete OpenArt project inventory.** Source reference still contains controls. Do not confuse missing final masters with a missing chosen design |
| Four completed OpenArt outputs | Blank-plate generation requests explicitly excluded text/icons. They are not the requested final masters |
| Whole month's accepted creatives | Not substantiated by this inventory. Old40 deterministic exports are explicitly owner-rejected in current Drive handoff |
| Credit balance | Starter plan; balance read and retained privately. Audit used0 generation credits |

An additional exact-copy conflict is visible in the approved reference: first English icon label is **Self-leadership**, while older text manifests say **Self-governance**. **Resolved during this audit: the owner explicitly confirmed Self-governance.** The first candidate must replace that one label while preserving the remaining design; do not retain Self-leadership as current copy. The Hebrew headline remains **בכל ילד יש גיבור**, never the earlier accidental 'story' wording.

## What this correction supplies

- Updated root README and a concise creative gate in AGENTS; no new business offer or palette.
- The same `creative/manifests/brand.json`, `assets.json`, `copy.json` namespace from PR16, reconciled toward actual pixels and explicit verification status. No second operator brand kit.
- Four master records with **MISSING** status and null asset/approval/bounds, instead of invented final filenames/hashes or automatic owner approval.
- A production policy covering one proof, ratio masters, permitted substitutions, credits, deduplication/resume and receipts.
- A read-only dependency-free readiness checker. It verifies actual file bytes, dimensions, approval hash binding, allowed layers and control geometry. Its passing unit tests do not imply the four assets or the OpenArt runner exist.
- An explicit migration map for PR16/22/23 and historical packs. This chat's earlier V4 layout/font/hex specification is also superseded as visual authority; it was not a finished master.
- The broader repository workflow audit, consolidated Codex handoff and updated project-instructions text requested during this audit. These cover economical intent clarification, source propagation, a real watchdog and lead-to-CRM checks; implementation is separately identified.
- A 30-design planning queue referencing one copy registry. It contains no finished outputs and no approved batch spend. The existing private production handoff was replaced in place with v5 and read back, preserving its ID and correcting rejected copy and model defaults.

## Remaining work, in execution order

1. Accept/reconcile this scoped contract with existing CRE-010 owner; register the accepted commit once. Preserve other workers' branches and claims. Current task authorizes this audit/README/control correction, not takeover/merge of their code.
2. Image-producing lane: retrieve known reference and exact Photo A, verify source bytes, prepare **one** EN-mobile candidate by removing toolbar and painted CTA and replacing the first English benefit label with Self-governance; retain all other pixels. If the available editing tool cannot restrict changes, use a controlled image-editing path or stop that operation with a precise capability reason. Do not substitute a cheap full-frame redraw.
3. Visually inspect the candidate before presenting it. Bind approval to the actual file. Complete HE-mobile and two centered desktop masters sequentially. Record the reserved control bounds from each finished image.
4. SYS-040: consume the registry, make the no-spend plan truly local, implement adapter/queue/cost ledger and resume semantics. Fix assertions and tests; validate Photo B by registry state rather than permanently hardcoding it unavailable.
5. WEB-020: install exact four assets with live header/button and matching hidden semantics. Verify served byte hashes and actual EN/HE desktop/mobile screenshots. Do not force the entire tall image into a short first viewport by shrinking text or cropping faces; adapt page height and retain normal scrolling.
6. Ads: accept one feed and one vertical master, reconcile final bilingual copy, then run bounded variants. Store outputs in the existing OpenArt project and durable asset register, with original source/master/copy hashes and provider job IDs. Use a contact sheet for review; no independent redesign per post.
7. Publishing/scheduling/funnel automation follows as separate verified integration. A generated image is not a Wappy post, Meta ad, WhatsApp delivery or spreadsheet lead.

## Economy and acceptance limits

Read-only OpenArt quotes for one image-to-image output with two references at9:16: Nano Banana Pro2K40 credits; Nano Banana2Lite default1K15; Wan2.7 standard2K6; Sunburst medium2k61. These are exact-setting snapshots, not authorization or quality guarantees. Requote the final parameters before paid execution. Ordinary exact reuse is cheaper than any fresh generation.

A flat PNG is not an editable design document. Promising exact text substitution without clean underlays/layers and an edit mask repeats the same failure in a different tool. The fixed pixels can remain fixed only when the actual operation is constrained and compared. New photo compositions need one fidelity proof; spelling, face identity, readable hierarchy and correct control placement require inspection of the actual output.

Follow-up capability inspection found no edit-mask/protected-region/deterministic-patch field in the exposed Nano Banana, GPT Image, Grok, Seedream, Wan or Kling forms. The connector exposes reference-based generation and a user-driven upload picker; no direct local-file import tool was exposed. A supported controlled local patch plus verified storage/import route is therefore an implementation dependency for exact edits. This is a connector limitation, not evidence that OpenArt's entire product lacks editing features. No paid trial was submitted to test a guarantee the form cannot express.

The user-facing target is simple: request a number of variants and a budget once; the worker resolves registered pieces, produces authorized jobs and returns saved outputs and receipts. The supporting system must actually be installed and tested before that simplicity can be claimed.

## Publication boundary encountered

The first branch push was stopped by automatic approval review because it included private Drive/OpenArt identifiers, photo checksums and a contact number. Destination readback confirmed the connected account owns the repository, but the repository is public. The revised public commit omits those bindings and keeps them in the existing private Drive handoff. The initial unpublished commit must not be pushed as history. No artwork or photo binaries are included.
