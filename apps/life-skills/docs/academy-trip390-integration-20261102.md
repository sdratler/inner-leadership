# Trip390 inquiry integration

Engineering binding for `JLFA-TRIP390-FRONTEND-IMPLEMENT-20261102-01`, not a replacement Product, copy or policy master. Follow the existing [Fishing source route](academy-public-current.md). The bilingual catalogs retain their review status. Historical registrations, contracts, lessons and assets remain intact.

## Selection and transport

`LS_ACADEMY_PUBLIC_OFFER=JLFA-KEYS390-v1` selects the current inquiry projection on the existing localized Florida landing/apply routes. Absence retains the legacy projection; an unknown nonempty value fails closed. Pricing and stage aliases point to the selected offer's existing sections. The BNA gateway itself is unchanged.

The existing public endpoint and sole `program=sunday_fishing_academy` query are retained. Exact `Accept: application/vnd.jlfa.trip390-interest-v1+json` selects the Trip390 payload. The v3 HMAC challenge binds program, intake/offer/notice versions and the existing HttpOnly continuation cookie. Origin, same-origin POST, body bounds, minimum challenge age and rate limits remain enforced.

The raw `JLFA-TRIP390-INTEREST-v1` object is stored without invented legacy grade, stage, school-hours or driving fields. Existing encrypted `public_applications` and immutable operation receipts provide atomic save, replay and conflict protection. Existing schema constraints admit the new notice/version tuple; no migration is introduced.

## Saved state and access

Only a committed server response with the same operation ID and a real reference becomes saved. Ambiguous outcomes retain the exact operation/body for an explicit retry. Sibling IDs, string ZIP codes, independent message language and the recorded notice language remain unchanged across a locale switch.

Trip390 does not construct or invoke founder allocation, parent activation, attribution, inquiry/owner email queues, send callbacks, payments or bookings. Its response reports `not_queued`. Historical Sunday submissions under the Trip selector may replay an existing receipt but cannot create a new legacy registration or invoke post-commit hooks.

Ordinary practitioner login remains required for `/{locale}/app/group-applications?inquiryId=<reference>`. Only a validated UUID survives the login return path. The private reference endpoint rechecks the current session, role, workspace and Fishing program before decrypting. A public reference grants no authority. Trip390 readback has no legacy promotion/follow-up/send controls.

## Release and compatible rollback

Preserve PR229 as a separate open private-header slice and preserve the older dirty shared-contract worktree; neither is imported into this change. The inner browser configuration adds the Trip390 selection without adopting PR229's separate browser-override change.

Release only after exact review and current-head protected checks. First deploy the compatible new code and matching release marker with the selector absent. Verify and retain that deployment as the rollback target. Then select Trip390 on the same source. After any Trip390 row exists, the old `e8f9cb2e` image is not a compatible rollback: it lacks this decoder. A selector-off rollback on the compatible code preserves owner readback and all records; an uncertain guest operation stays locked rather than being resubmitted.

The previously staged `0a72d082-1762-4b32-b655-2f90cd9084d3` source points to older `84a0a71f`. Preserve its exact archived beforeimage and reconcile it explicitly against fresh complete provider state. Do not apply it as this candidate or use it as the post-Trip rollback target.

Build uses the supported `next build --webpack` path. Protected CI, lockfile, migrations and production integrations are unchanged. Local/native/browser, CI, merge, provider deployment and public synthetic readback receipts are distinct evidence states, recorded in the existing Fishing Continuation and Delivery.
