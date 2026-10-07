# Admitted Nomad call metadata

Implementation: `LS-ACQ-CRM-20261002-01`. Configured is not phone/device-verified.
The endpoint remains disabled by default. No provider configuration or production
migration is performed by implementing it.

`POST https://life-skills.bneineviimacademy.org/api/private/acquisition/call-events`
accepts only a Nomad **CALL** custom JSON template:

```json
{"source":"android_nomad","from":"%from%","timestamp":"%timestamp%","duration":"%duration%"}
```

Optional `contact` is accepted only as a valid bounded JSON string. The minimal
template omits it because the pinned provider's string replacement does not JSON
escape contact names; a quote must not break capture. Existing CRM names are kept.
Do not enable enhanced device information, SMS/push forwarding or history import.
Keep certificate validation ON. Do not disable SSL checks.

Runtime names (values are never logged/committed): `LS_NOMAD_CALLS_ENABLED=true`,
`LS_NOMAD_DEVICE_BINDING_ID` (one stable registered device/rule UUID), and
`LS_NOMAD_CALL_SECRET` (a dedicated 32-random-byte base64url value), supplied in
Nomad's custom header `Authorization: Bearer <secret>`. Rotation preserves the
device binding/replay identity. The ordinary existing identity runtime supplies
the exact workspace, encryption and distributed rate-limit store. No shared
developer password or WhatsApp token is accepted as an alternative.

60 authenticated requests/minute per binding; 2 KiB actual body limit. Replay
identity is device binding + canonical caller + original epoch-millisecond
timestamp; changed payload at that identity conflicts, not an overwrite. Exact
concurrent retry stores once. Nomad's timestamp survives its worker retry. A new
ring notification with a different timestamp is distinct; this is not a claimed
carrier call ID. `duration=0` does not prove a missed/completed call.

Encrypted immutable receipts reuse the existing acquisition store. Unknown,
shared, reserved, DEMO, suppressed, archived or non-adult endpoints remain
unclassified Needs Review. Only native authority can append a minimal activity
link to one existing live administrative contact, without changing their name,
stage, notes, account, case, tasks or consent. Before native cutover/freeze there
is receipt capture only, never a parallel Sheet/native writer. Explicit ordinary
practitioner promotion creates a `native_manual` lead with Phone/Nomad provenance,
not a fabricated WhatsApp thread. Normal matching preserves all existing fields.
The private directory shows the latest five linked calls, separately from
clinical records, with an explicit bounded-history label.

Activation gates: reviewed/protected code integration; approved same-target
schema/recovery checks; registered device/binding and securely saved dedicated
secret; owner phone CALL-rule setup/permissions/Test; authorized controlled known
and unknown calls and retry readback through receipt, Needs Review/People. Never
test against prospects or infer end-to-end delivery from an HTTP fixture.

Provider source verified: [Nomad repository](https://github.com/we-digital/android-nomad-gateway),
commit `642f1d56438d3b3194ad597c77b273f96b5192e4`,
`CallBroadcastReceiver.java`, `CallWebhookWorker.java`, `ForwardingConfig.java`.
