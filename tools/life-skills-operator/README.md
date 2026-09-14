# Life Skills Creative Operator

This package consumes the accepted machine-readable authority in `creative/manifests/**`. It does not keep a second brand kit or public asset registry.

## Local plan

Structured planning performs no model or provider call:

```bash
npm run plan -- --intent examples/website-hero-approved-master.json
```

Free-form interpretation is explicit and separately metered:

```bash
npm run interpret-plan -- "Use the approved English mobile hero."
```

The compiler emits typed requested changes, preservation rules, unresolved blockers, exact registered assets and effect limits. A plan never generates, spends, publishes, deploys or changes provider configuration.

## Durable generation boundary

`QueueStore` gives each canonical job specification one deduplication key, writes claims atomically and records provider state outside Git. `OpenArtAdapter` requires a numeric image-credit cap, records a quote before submission, persists a returned history ID, resumes by that ID, and blocks automatic resubmission after an ambiguous submission. The adapter accepts an authenticated runtime transport; secrets and private asset bindings never belong here.

An already-submitted job is resumed from its saved history receipt with `resumeExisting`; that path adopts the receipt, performs no quote or submit, records `newImageGenerations: 0`, and polls only the saved history ID. Never create a replacement generation merely because a local queue record is missing.

The current 30-design queue remains blocked by the canonical manifest: zero approved **full static-ad** masters, incomplete copy approval, missing Photo B OpenArt binding and no numeric image-credit cap. A full static ad is a finished feed or vertical raster with the approved photo, copy, logo, service/age, all three labeled benefit icons and the baked visual WhatsApp CTA; the posting platform provides the real link. A simpler approved link-preview or organic card is a different surface and never satisfies the full-ad-master gate. Those blockers do not affect the already deployed website.

## Watchdog

```bash
npm run watchdog -- --config /private/path/runtime.json
```

The watchdog uses ordinary code only (`modelCalls: 0`, `providerCalls: 0`). It verifies the promoted website masters, repairs only the derived queue index, and reports expired claims, ambiguous submissions, missing provider receipts, source/deployment divergence and missed heartbeats. A scheduler is not considered installed until an authorized host records an actual scheduled-event receipt.

## Execution boundary

`execute` accepts the same structured intent but remains fail-closed. It cannot turn a blocked ad plan into paid work and cannot publish, deploy, merge, send messages, enable automatic WhatsApp replies or mutate provider settings. Website plans reference the four exact deployed raster masters; only the header and real WhatsApp anchor are visible live UI.
