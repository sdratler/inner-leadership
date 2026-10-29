# BNA support-interest implementation

Package `BNA-JLFA-IMPLEMENTATION-20261029-10`, section 7. This extends the existing encrypted inquiry store and owner People queue. It does not create a second CRM, a donor relationship, a payment or a permission in another program.

The new public route is `/api/public/bna-support-inquiries`, independently gated by `LS_BNA_SUPPORT_INQUIRY_ENABLED`, the existing BNA gate and configured ordinary owner. Its challenge is cryptographically separate from co-op and Torah-morning challenges. The server binds the program to `bna_support_interest` and the landing path to `/support` or `/he/support`; a browser cannot select another program by payload or attribution.

Required fields are adult name, reply contact/channel, support purpose and message language, with a separately recorded page/notice language. Optional fields are area of interest and a short message. Strict parsing rejects child, donation and payment fields. Project updates require an explicit versioned email-channel permission; selecting an updates purpose alone is insufficient. The conversation purpose accepts phone-only replies. A saved permission is not a queued or delivered message.

The existing private owner endpoint reads the encrypted record, preserves its source and immutable follow-up history, and supports operation-reference lookup and exact replay. The combined People model presents this program under Support, independently of BNA parent and Fishing purposes. The co-op-only B0 preview does not apply to Support; S0 integration remains future work. Existing optional 305 inquiry links still admit only their original parent-inquiry targets and remain disabled in production.

## Current evidence and release boundary

Local PGlite tests exercise the actual support HTTP handler and store, including one saved record after replay, owner versus unrelated-account readback, follow-up history, purpose classification, explicit email permission and rejection of a co-op challenge. The proposal SQL preserves existing inquiry IDs; the existing Fishing application count remains unchanged. These are local database tests, not native PostgreSQL, ordinary browser, delivery or production proof.

`migrations/proposals/0144_ls_bna_support_interest.sql` is intentionally outside the active manifest. It is not a release operator. Before activation, reconcile the unapplied 0143 and other draft migration numbering, build and test the exact support migration/catalog/ledger guard, take and restore a fresh production backup, obtain required candidate CI, deploy the exact merged app with Support off, and apply only the admitted schema delta. Then verify the challenge, enable the separately gated website form/relay, and prove an actual EN/HE support submission and ordinary-owner readback. The owner's existing launch authorization remains valid; these are executable verification dependencies, not requests for another approval.

No support flag, production migration, sender, worker, outbox, donor processor or schedule was activated by this local implementation.
