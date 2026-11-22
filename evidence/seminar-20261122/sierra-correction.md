# Sierra Lake seminar correction

Task: `JLFA-SEMINAR-MOBILE-DESTINATION-20261122-01 / CORRECTION-02`.

Current source: [Fishing Website & Acquisition Brief](https://docs.google.com/document/d/1jw0shI2DSfUH9RpJc2WdeIqXwO1OYOUEiwuv3mdNngU/edit). The source writer verified the adopted correction on November 22, 2026: `Sierra Lake, Boca Raton` and `Bring your fishing tackle.`. The original map coordinates, event date/time, ages and contact remain unchanged. This is a scoped factual/copy correction, not an earlier design violation.

## Baseline and ownership

The clean isolated checkout starts at `3cd41cb1b097d856fcc64af8b76da34e53d9cfb7`, verified as the latest successful Fishing Railway application deployment. Current open PRs were inspected; no overlapping seminar implementation was observed. Historical Windows worktrees and cross-host claims are inaccessible, so no cross-host lease or ownership transfer is claimed. Existing backend, billing, CRM and shared-header PRs remain untouched. Source-document reconciliation stays with its current writer.

## Scoped brief

Preserve the existing mobile page's single column, navy/white/gold styling, type hierarchy and working actions. Replace the old place label with Sierra Lake. Add one legible tackle reminder between the event details and actions, including the same fact in invitation text, metadata and accessible flyer text. Keep the flyer proportional and uncropped. Update the QR explanation so both displayed codes are described as opening the seminar page; directions remain a separate button on that page.

## Asset identity

The corrected flyer was visually inspected by the coordinating agent. Both final JPG and PNG were decoded with zxing-cpp to `https://bneineviimacademy.org/fish`. Exact JPG adopted into the existing public filename:

- `apps/life-skills/public/seminar/bass-fishing-seminar-20261122.jpg`
- 1254 × 1254 pixels; 927,263 bytes
- SHA-256: `7f0b1388bb99fc9aa64448d00b5edbf40e7cec79df59d00672a354a63130d155`

The separate PNG/SVG QR exports remain byte-identical to the verified release; the permanent destination is unchanged. No new gateway route, public asset path, credentials, customer record, send, billing or database change is required.

## Verification checkpoint

- Existing seminar unit tests: 3 passed.
- Scoped ESLint on the changed TypeScript/TSX: passed.
- Production build, actual mobile render inspection, independent exact-diff review, required protected CI and deployed readback: pending at this checkpoint.

Deployment must preserve the existing inquiry acknowledgment admission by using its normal source-only compatibility rebind. Do not deploy a new source pin while leaving the old commit-bound policy behind, and do not alter or invent the existing mail authority to make a release pass. This candidate is not claimed deployed or live.
