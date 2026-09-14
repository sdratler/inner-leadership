# LS-080 security and privacy

- The browser never supplies actor, workspace, author, review status or evidentiary status. Strict schemas reject unknown fields.
- Every request resolves the opaque server session. Mutations also require the exact configured origin, same-origin fetch context when present, and the session CSRF secret.
- The service rechecks the session inside each transaction, loads live case guardians and the exact audience, and uses uniform `NOT_FOUND` denials for scoped resources.
- A parent report requires active parent/guardian membership, an explicit published `family_full` audience grant, and an authorized I-013 reference to the exact published LS-040 version.
- Report and reply narratives are encrypted at rest with per-record authenticated-data binding. Only digests, identifiers, timestamps and workflow state remain queryable.
- Parent report authorship, narrative, audience, event time and assignment-version snapshot are immutable. Review metadata moves only forward and cannot alter attribution.
- Family readers receive only published practitioner replies. Draft replies are practitioner-only.
- The LS-050 `DatabaseParentReportReader` returns attribution and submitted time only after exact case/audience authorization. It deliberately returns no narrative, review, witnessing or verification status.
- Adaptation calls a practitioner-only port, validates the returned new LS-040 version as a draft for the same assignment, and stores an immutable receipt. It never publishes that draft.
- No child account, clinical conclusion, rating, grade, score, private note, attendance write, provider delivery, client fixture or live identifier is introduced.

Database triggers independently enforce parent/audience/version provenance, practitioner ownership, immutable content, monotonic review history, draft-only adaptation receipts and published-reply immutability.

