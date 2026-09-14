# LS-080 contextual updates

LS-080 lets an authorized parent submit an attributed contextual report linked to one exact immutable, published LS-040 assignment version. The report exists immediately. A practitioner may mark it reviewed, write a draft or published reply, and request a new adapted LS-040 draft through an injected port.

`reviewed` means only that the practitioner read the report. It never means that the event was witnessed, verified, graded, rated or clinically established. The update domain contains no attendance ownership and writes no calendar record.

## Surfaces

- Locale UI: `/[locale]/updates` for `en` and `he`.
- Private API: `GET|POST /api/updates`.
- Domain: `src/features/updates`.
- Migration: `migrations/0080_ls_context_updates_20260911.sql`.
- Synthetic tests: `tests/ls-080`.

The runtime fails closed for adaptation until the central integrator supplies an LS-040 `PracticeAdaptationPort`. Report creation uses the I-013-compatible read-only SQL adapter and therefore requires LS-040 to be integrated first.

