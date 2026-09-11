# Life Skills Creative Operator v0.1

Purpose: accept the owner's natural-language ramble, classify it, resolve it against machine-enforced current creative state, emit a deterministic execution contract, and optionally hand that contract to Codex through the OpenAI Agents SDK experimental Codex tool.

## Why this exists
The owner should not need to remember file names, OpenArt projects, model IDs, reference IDs, website layering rules, or which elements are live UI versus raster artwork. Those are locked in config and validated before execution.

## Current hard locks
- Website hero = static art plate plus live HTML. Never bake toolbar, wordmark, hero copy, WhatsApp button, benefits, navigation, locale switch or hamburger into the static plate.
- Website desktop and mobile use the same centered hierarchy; no side-split desktop hero.
- Ads = OpenArt art direction, then exact raster compositing for logo/copy/WhatsApp glyph/benefit SVGs.
- OpenArt project is always `life skills` / `YNFWEmEe4mvjjbLz7KLc`.
- Photo A proof references are exactly style master `5Fidhb5Gy4pLhCzTIkNO` then real photo `2JRZlpK8Gy3hAoYp3XMv`.
- Do not send logo/icons/previous generated proofs into OpenArt as references.
- Nano Banana Pro first. GPT Image 2.5 Sunburst only after owner rejects the primary proof.
- One proof before any batch after a rendering-policy change.
- Raster `Message on WhatsApp` is visual; the actual clickable Meta CTA is separate.

## Run
```bash
npm install
node src/cli.mjs plan "Use that exact teal shading. For the website, keep the toolbar live, not inside the hero image."
```

Execution is intentionally separate:
```bash
LIFE_SKILLS_REPO=/path/to/inner-leadership node src/cli.mjs execute "Make the C01 Hebrew Photo A feed proof."
```

The executor must use private environment credentials. No secrets belong in this repository.

## Owner-ramble contract

The natural-language model is allowed to interpret **intent**, not execution identity. Provider project IDs, reference IDs, asset roles, layer boundaries and effect permissions come from versioned config and are validated after interpretation. An owner correction can produce a new proposed execution contract; it does not silently rewrite Product/Website/Marketing authority. Canonical source changes still follow the existing same-file reconciliation protocol.

Website and ads intentionally use different layer boundaries. Website static plates are UI-free art and the site renders live controls. Ads are final rasters and currently retain the short visual WhatsApp CTA, while Meta owns the actual clickable CTA/destination.
