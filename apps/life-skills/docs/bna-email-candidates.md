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
No new optional send path is added by this code.

The recipient capability belongs in a URL fragment and a same-origin JSON
body, never a query parameter, cookie, log or provider evidence. Reads are
side-effect-free and return no name, address, child details or private history.
Permission grants expire after30days; an old link still permits withdrawal.
Exact operation replay returns current native state after a lost response.

This preference preparation is NOT a deployed feature. Proposed migration
`migrations/proposals/0148_ls_bna_email_preferences.sql` is outside the active
manifest. The flag-gated owner panel and matching BNA recipient page/relay are
implemented in the existing repositories. `LS_BNA_PREFERENCES_ENABLED` stays
off pending the native release guard, full candidate CI, backup/restore
and ordinary browser acceptance. No existing data migration or historical
outbound collector is authorized by the proposal. Runtime flags and production
acceptance are recorded in the existing private implementation checkpoint.
