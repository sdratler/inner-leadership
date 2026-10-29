# BNA email review candidates

`src/features/bna-communications/email-candidates.json` contains the 15 exact bilingual email candidates from section 12 of `BNA_FISHING_CODEX_IMPLEMENTATION_MASTER_2026-10-29.md`. Its source SHA-256 identifies the supplied package; each message also binds its English and Hebrew subject/body bytes. Only leading/trailing blank lines and source line endings were normalized during extraction.

`previewBnaEmailCandidate` produces plain text for review. It requires each used reference or URL, rejects unexpected template tokens, and uses a natural greeting when the first name is absent. Candidate text remains a review candidate. Trigger descriptions are metadata; this module has no outbox, worker, scheduler or provider call.

The existing private BNA endpoint re-reads the owner-authorized inquiry and selects its saved message language. New admitted email-channel co-op/support inquiries freeze B0/S0 under migration0146; their owner preview reads the actual frozen text, version and recorded delivery state. Opening a preview never sends. An email acknowledgment is not inferred from a phone-selected reply channel. Owner cancellation and known-not-attempted retry are versioned commands; unknown provider effects are never silently retried. Historical Torah-morning inquiries and the separate Fishing lifecycle retain their contracts.

Before delivery integration, review final copy and verified sender/reply-to/footer. B0 and S0 require actual durable inquiry saves; D0 requires a reconciled successful gift and is not a tax receipt. Educational messages require the corresponding current purpose/channel permission, suppression/reply handling and working preference/unsubscribe paths. Preserve the separate Fishing lifecycle. Apply the package's duplicate, personal-conversation, recurring-gift and controlled-delivery gates before activation. An extracted template or successful preview does not establish any of those facts.

G3 preferences preparation adds an encrypted append-only adult-email journal,
owner-scoped pause/withdraw/reply-triage/invalid-address/complaint controls, and
inquiry-bound recipient preferences. Owner actions cannot grant subscription.
Native captured permission is the initial basis for that inquiry; a recipient's
explicit program preference records the displayed notice and changes the
permission anchor only on a new grant or regrant. Global BNA email withdrawal
and holds share the existing canonical recipient key across co-op/support;
they never merge People or alter Fishing WhatsApp/service acknowledgments.
Preference controls do not themselves activate optional sending.

The recipient capability belongs in a URL fragment and a same-origin JSON
body, never a query parameter, cookie, log or provider evidence. Reads are
side-effect-free and return no name, address, child details or private history.
Permission grants expire after30days; an old link still permits withdrawal.
Exact operation replay returns current native state after a lost response.

Preference migration0148 and its owner/recipient controls were released through
PR225. The existing private implementation checkpoint records exact deployed
sources, dedicated gates, native readback and ordinary browser acceptance.
Those receipts do not activate optional educational sequences. Never reapply
0148 or reuse a proof bound to a previous deployment.

The optional calendar candidate uses the same canonical adult recipient key,
native preference facts and owner follow-up status. Its additive schema remains
`migrations/proposals/0149_ls_bna_optional_calendar.sql`, outside the active
68-entry manifest. It has NOT been applied in production. The separately gated
People preview and private API remain off until exact schema release and browser
acceptance. A preview is read-only; a prepared payload encrypts the frozen copy,
personal preference link and approved postal footer. Saved previews protect the
capability rather than printing its bearer value. No child fields enter a message.

Native reservations coordinate unknown effects, identical content, 48-hour
spacing and two educational sends in a rolling seven days across co-op/support.
Owner cancellation preserves uncertain effects; only a known not-attempted result
admits an explicit versioned retry. Later grants anchor from that grant; another
program's language change does not invalidate an unchanged preparation. The
transactional service acknowledgment tables and Fishing lifecycle stay separate.
No optional production sender admission, worker or provider adapter is mounted;
the internal transport interface is exercised only with synthetic tests. Sender
footer/copy activation, exact-target schema guard/backup/restore, monitored reply
ingestion and verified donor-event integration remain required. Donor messages
cannot be prepared from this inquiry-only calendar or a browser's claim of a gift.

`scripts/release-bna-preferences-schema.ts` admits only the existing exact
Railway service/database with verified TLS and a deployment/commit/source/
manifest/ledger-bound protected proof. Backup and isolated-restore evidence
bind the same archive, database identity, exact0148 SQL, native catalog and
unchanged prior tables. Preflight/apply require the new preference gate off;
existing form,305 and B0/S0 gates are unaffected. Apply admits only0148, then
checks its exact catalog/ledger and empty event table; verify-only never applies.
Rollback keeps the additive immutable history and disables only the new
preference capability. It never reverses a saved withdrawal or resumes mail.
