# Administrative contact archive

Native-authority implementation, not a completed live cutover. The existing
`/api/private/contact-profiles` endpoint accepts strict `archive` / `restore`
commands with the ordinary practitioner session, CSRF, authority epoch,
profile version and operation UUID. Legacy/frozen authority fails closed.

Archive adds an encrypted administrative marker. It does not change the prior
stage, notes, due date, identity, case links, payment/booking state or opt-out.
Restore removes only this marker; imported/identity archives and communication
suppression remain separate. Immutable command receipts bind actor and original
input. An old archive replay after restoration cannot re-archive or overwrite
newer edits. Production DEMO records are excluded from this workflow.

Archived administrative contacts stay discoverable, but are excluded from open
administrative queues and outgoing/native acquisition actions. Assigned clinical
access remains independently authorized. No provider action is performed.

UI requires confirmation, blocks concurrent unsaved edits, and retains an exact
request for an uncertain-result retry. A successful operation reloads the saved
record. No permanent deletion endpoint or Delete Demo control exists.

Release gates: final retained-app browser/role verification, protected review,
compatible reader rollout and the existing native cutover. The new optional
encrypted-payload field is rejected by older strict profile readers: do not roll
back to a reader lacking this field once it has been written. A compatible reader
must remain deployed, even if lifecycle controls are disabled. No live writes or
schema migrations were performed while preparing this change.

Remaining: legacy Sheet route support is not implemented; archive/restore is not
yet available in the currently served Sheet-backed People view. Full live
acceptance and provider/inbound replay coverage must not be inferred from unit
or isolated operational-store tests.
