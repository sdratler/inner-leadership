# Life Skills creative production

**The approved image is the visual master. A prompt is a request, not a master.**

This is the accepted `creative/**` registry, not a second creative system. It records the four completed website hero masters and the approved Hebrew Open Graph/organic master. It is not an installed bulk generator. The operator and downstream website must consume this contract; this README alone cannot prove deployment or provider behavior.

## Current authority and status

1. The owner's latest explicit correction and registered [Website Brief](https://docs.google.com/document/d/1jw0shI2DSfUH9RpJc2WdeIqXwO1OYOUEiwuv3mdNngU/edit) / [MKT-060 visual source](https://docs.google.com/document/d/1XITqbJKdM4d8dHnuW9hUKDDieQ-jIkFYaz14x3ww2hY/edit) govern intent. Reviewed readback: Website 3.2 and MKT-060 1.9 under `SOURCE-COORD-20260913-02`.
2. These manifests record derived execution truth. After review/integration, register the accepted Git commit in the existing Drive handoff. Until then, this is a draft reconciliation, not a replacement for the current Drive authority.
Private original-photo IDs/checksums and account details stay in the existing authenticated Drive handoff, because this repository is public. The public manifest binds each logical asset ID to that private record; this is access separation, not a second brand kit. No credentials or source-photo binaries enter Git.

3. `tools/life-skills-operator/**` contains logic only. Load these manifests by explicit path and commit/hash. A tool-local brand file, cached prompt or historic ZIP must never be an alternate fallback.
4. OpenArt stores references and generation history. The repository records approval, provenance and production state. Website source and the downstream public deployment require their own evidence.

| Record | Purpose |
| --- | --- |
| [manifests/assets.json](manifests/assets.json) | Exact source identities, checksums and verification limits, including `LS-OG-MASTER-HE` |
| [manifests/brand.json](manifests/brand.json) | Brand identity and pixel authority; no new CSS palette or font approximation |
| [manifests/website-hero-masters.json](manifests/website-hero-masters.json) | Four final master slots, actual approval state, button placement |
| [manifests/copy.json](manifests/copy.json) | Copy scope, rejected lines and unresolved pixel/copy mismatch |
| [manifests/production-policy.json](manifests/production-policy.json) | One-proof gate, costs, allowed edits and bulk receipt requirements |
| [audit/2026-09-11-master-pipeline-audit.md](audit/2026-09-11-master-pipeline-audit.md) | Verified failure chain and remaining implementation work |
| [MIGRATION-MAP.md](MIGRATION-MAP.md) | Reconcile existing lanes and retire contradictory instructions |

## Preserve the four finished website heroes

The English and Hebrew mobile and desktop masters are already owner-approved, archived and deployed. Their four fixed SHA-256 values live in [website-hero-masters.json](manifests/website-hero-masters.json). Never recreate, resize, crop, recolor, relayout or re-encode those files. The older candidate-making recipe is historical provenance, not an executable queue.

**Baked into each hero:** headline, service line, age, real photo, all three benefit icons and labels, teal/shading/fade, cream treatment and bottom curve. No founder signature or added corner foliage. **Visible live UI:** header/toolbar (including the approved logo/navigation/locale control) and actual WhatsApp button. No second logo in the hero.

The website consumes the exact image bytes. Proportional display scaling is allowed; rewriting/resizing the asset bytes, CSS color filters, overlay gradients, relayout, mirroring, `object-fit: cover` cropping and visible HTML copy/icon reconstruction are not. No automatic image optimizer may silently recompress the master. Select the registered mobile/desktop asset responsively; keep its intrinsic aspect ratio and reserve layout space before loading. Hidden semantic text must match the displayed copy without duplicate screen-reader announcements.

The final WhatsApp bounds are measured on each finished image, not guessed from an older screenshot. Store `{x,y,width,height}` in normalized image coordinates. The live button uses that box as the approved placement; verify real mobile/desktop screenshots, touch target, keyboard focus and localized editable prefill. Short labels: EN `Message on WhatsApp`; HE `שלחו הודעה בוואטסאפ`. Resolve the approved destination from that private binding. Clicking opens a draft; it does not send a message. The existing approved live-button styling may be used; it must not recolor the image.

## Use OpenArt without re-administering the kit

After masters and the runner are actually integrated, a normal request can be:

> Make eight new posts from the approved feed and status masters, using photos A and B and the approved responsibility/motivation copy. Preserve the design and stay within the agreed credit cap.

The worker resolves exact master/photo/copy IDs, prepares a **zero-generation-cost plan**, reports its output count and price, and executes within the user's existing authorization. The user need not paste individual prompts or track downloads. For an unapproved visual change, return one candidate. For approved variants, process the authorized queue and return a contact sheet plus the output register. Do not ask again for settled master choices or the already approved batch cap.

This is the target interaction. PR #22's review is complete at exact head `4dd9d1cb8b7d12a3be29081db6ef46da4feeb2d8`; its merge still requires the applicable explicit authorization. Do not restart its adapter/queue/receipt work merely because a source fingerprint changed.

Every distinct creative is one documented job. `imageCount: 8` means eight results for one prompt, not eight different copy/photo specifications. Feed and vertical use separately approved 4:5 and 9:16 masters. EN/HE raster text is not interchangeable automatically. Reuse a file for placements with the same ratio; a 30-day rotation may reuse approved outputs and is not proof that 60 unique images exist.

The current [monthly queue](manifests/monthly-creative-queue.json) reserves 30 distinct concept/photo/language designs, with 15 in each language. Feed/vertical derivatives are counted separately. Every output remains missing. Queue records reference `copy.json`; draft concepts are not approved copy. Shared defaults reduce duplicated planning state. An actual submitted job receipt snapshots exact resolved inputs, wording and hashes.

## Credit and fidelity rules

- Reusing an existing master costs no generation credits. Planning from registered IDs is local and should not call a paid intent model. Free-form interpretation, when needed, is a separately metered operation.
- Discover the provider's current model form, quote the **actual parameters**, and verify remaining credits. Do not infer price from a model name or change settings after quoting.
- One candidate at a time while fixing a master; no automatic premium escalation, retry storm or silent full-month batch. Cheap full-frame redraws are wasteful when exact reuse is possible.
- Nano Banana Pro may create genuine photo/composition derivatives after a fidelity proof. Its exposed form has no exact-pixel lock: a preservation sentence cannot guarantee unchanged teal, Hebrew or faces. Do not advertise guaranteed sameness from image-to-image alone.
- Exact wording/logo changes require registered clean underlays/layers and edit masks. Preserve original photographic pixels. If these do not exist, prepare one controlled editing candidate; do not claim a flat PNG supports perfect text substitution. Compare all pixels outside the allowed mask after editing. Font files, glyph shaping, Hebrew spelling, RTL, numbers and line breaks belong to that localized proof, not a new whole-frame renderer.
- Store the exact submitted prompt and parameters before submission. Claim a job once, record the returned history ID immediately, resume that job after an interruption, and download/verify the result before it can be approved or scheduled. A timeout is not permission to resubmit and pay again.
- OpenArt's current ChatGPT result widget self-polls and ends the generating turn. An unattended queue needs a verified execution host/adapter; opening multiple windows is not a durable queue.

## Readiness and closeout

From repository root:

```sh
node creative/bin/verify-master-contract.mjs --inventory
node --test creative/tests/master-contract.test.mjs
node creative/bin/verify-master-contract.mjs --ready
```

`--inventory` may pass while reporting all four images missing. `--ready` must fail until real approved files exist and their hashes/dimensions/approval/bounds validate. The checker is a local preflight; wiring it into the operator/build is still a separate integration task. It cannot certify Hebrew or visual taste automatically.

Report separately: requested jobs, submitted jobs, saved images, verified images, owner-approved masters, scheduled posts and published posts. Generation does not activate Meta, Wappy/WhatsApp, group messaging, website deployment or CRM automation. Those integrations consume approved output IDs and retain their own authorization and delivery receipts.

## Approved Hebrew Open Graph and organic master

`LS-OG-MASTER-HE` is the exact approved output from OpenArt history `avJp5dVmQ57ZwWoxUzxF`, resource `hJLsVPvmQEAidSZ05PYj`. Its archived PNG is `1376×768`, `1,483,572` bytes, SHA-256 `209bdb5a7c6fa8573dead56e22d1213787e7e080f2d701fbe5901480029313ab`. The older history `8mHVLTE0Kn9KRLNYPNhC` is provenance only. Never regenerate, silently crop, recolor or relayout the approved output.

This is a deliberately simpler link-preview/organic card: no toolbar, no logo-only treatment, no drawn WhatsApp CTA and no benefit-icon row. Those omissions do not apply to complete static ads, which keep their three labeled benefits and static WhatsApp CTA, and do not change the four website heroes. Website installation must use crawler-visible localized Open Graph metadata and an absolute public image URL; HTTP success alone is not proof of a WhatsApp unfurl.

The three first-week organic captions in `copy.json` remain `REVIEW` and `publishAllowed: false`. Reusing this master for those reviewed placements costs zero generation credits. Publication, scheduling, Meta changes, messaging, CRM changes and automatic WhatsApp replies remain separate; automatic replies stay off.
