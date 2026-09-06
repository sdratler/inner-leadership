# Life Skills source integrity

This is a read-only gate, not an alternative Product Contract, a clinical system,
a deployment audit, a whole-Drive cleanup, or proof that all semantic contradictions
are detectable. The approved source decisions remain in the registered Drive files.

## What it checks

Nine fixed, non-client source documents; exact normalized export fingerprints;
selected positive and retired-language rules; reviewed Overview launch-policy
and Instructions rule fingerprints; identical complete Project Settings
Blocks; approved-decision and interface fingerprints; work-definition fingerprints;
explicit dependency grammar, missing producers and cycles; eligible code baselines;
claim completeness, six-hour expiry and known ownership overlaps; and required
packet files/checksums. Integration mode verifies supplied producer ZIP bytes.
Text and settings normalization removes a leading BOM and changes CRLF to LF only.
Dynamic claims, status, results and output links do not unnecessarily invalidate
stable work-definition hashes. A relevant decision or definition change does.

The owner-authorized bootstrap was run against actual connected-source exports.
No scheduled cloud run has occurred as part of packet preparation. No client data
or credentials are in this folder. The expected.json file contains derived IDs,
hashes and test rules, not copies of the source documents.

## Run

Python3.10+ and OpenSSL are sufficient; no Python package installation is required.

```sh
python3 -m unittest discover -s tools/source-audit/tests -v
python3 tools/source-audit/audit.py --live --output /tmp/source-audit.json
python3 tools/source-audit/audit.py --snapshot /tmp/fresh-source-input.json \
  --work-id LS-100 --baseline EXACT_40_CHARACTER_BASELINE --phase prepare \
  --output /tmp/SOURCE_AUDIT.json
python3 tools/source-audit/audit.py --live --work-id LS-105 \
  --baseline EXACT_40_CHARACTER_BASELINE --phase integrate \
  --packet LS-100=/private/verified/LS-100.zip --output /tmp/SOURCE_AUDIT.json
```

Resolve the baseline from the fresh Work Graph; placeholders must never be used
as actual command arguments. A snapshot must contain actual source reads within
30minutes and must be labeled connector_export. It is not a cloud run. See
snapshot-schema.json for the input shape. A synthetic_test input is test-only.
Exit0 means the checked scope passed; exit1 means blocked. Missing credentials,
unreadable sources or incomplete inputs must never be converted into PASS.

## Narrow credentials

Use a dedicated service account with view-only access to the nine registered Docs
and Build Control ONLY. Do not share a parent folder, Leads workbook, client runtime,
consent records, media originals or clinical folder. Both Drive and Sheets APIs
must be enabled in its project. Domain-wide delegation is neither needed nor
approved. OAuth scopes are read-only. Configure its JSON privately in repository
secret LIFE_SKILLS_AUDIT_GOOGLE_SERVICE_ACCOUNT_JSON; never paste it in a prompt,
issue, packet, log or repository. A short-lived GOOGLE_ACCESS_TOKEN is supported
for a private manual run. OpenSSL signs a temporary0600 private-key file which is
removed automatically. The runtime must still be trusted; environment secrets are
not a security boundary against malicious code.

The collector permits only fixed Google/GitHub HTTPS hosts and refuses redirects,
limits reads/retries and emits neutral errors, not HTTP bodies. Network/provider
authentication has not been live-tested in this packet because no runtime
credentials were available here. Actual integration must prove it.

## Daily and pull-request checks

The prepared workflow runs at04:17UTC daily and on manual dispatch, plus trusted
pull_request_target events. It checks out only the target repository's base SHA,
NEVER the pull-request head with secrets. It executes no PR-provided scripts,
artifacts, caches or package hooks. The result is explicitly posted to the PR head
as source-integrity. The trusted workflow/checker and baseline changes themselves
need independent review. Do not replace this with an untrusted-head checkout.

A successful workflow run is the last-success heartbeat. Inspect run timestamps
and conclusions before relying on schedule health; a daily job that never starts
cannot notify on its own. No guarantee of exact-time execution. GitHub's schedule
is supplemental: every packet worker still runs a fresh on-demand scope check.
A missing/stale scheduled heartbeat must be reported, not interpreted as success.

Configure a required source-integrity check, bound to the expected GitHub Actions
app where supported, after a real successful installation run. Existing rules must
be preserved. The checker cannot prevent a privileged administrator from bypassing
rules; no tool should describe an unenforced branch rule as installed. Review rules
for forks/merge queues before enabling them; this workflow does not implement a
merge-queue trigger. Do not use dependency installation or application deployment
as part of this audit job.

## Approved changes

The active conversation records the explicit approval. A claimed reconciliation
worker patches the SAME authoritative files, removes contradictions, updates the
relevant definitions and records one Change Log transaction. Read back and review
all affected prose as well as structured cells. Only after that review renew the
expected fingerprints in a scoped reviewed change. There is deliberately no
“accept current state” command that would make arbitrary drift green.

An unrelated Proposed idea is not an automatic blocker for independent work.
A new Approved decision or interface change triggers reconciliation. Scope-local
work-definition findings can be warnings for another independent packet, but
global unreadable inputs, audit settings and decision drift fail closed.

## Known scope limits

This gate does not search every Drive folder for duplicate master documents, inspect
private data, attest clinical efficacy, validate every natural-language implication,
run app tests, verify deployment, or install its own scheduler. Those actions have
separate ownership/evidence. Legacy-only Drive cleanup remains SYS-021. The entire
current Work Graph, including narrative next-action text, was reviewed at bootstrap;
new approved changes still require semantic review. Actual source document exports
can change after formatting updates; review that drift rather than silently updating
hashes. Optional future integration slices must have exact baseline and dependency
evidence before their rows become Ready.

## Control-summary coverage in checker1.1.0

Read Overview A1:C100 and Instructions A1:H100. The stable Overview section begins
at row18 (including all launch constraints); Instructions begins at row3. The
reader keeps internal blank rows and rejects missing or malformed sections.
Trailing empty rows normalize consistently across connector and Sheets exports.
Overview counters/last-run status above row18 are deliberately not hashed.
The fingerprints detect any subsequent change; semantic correctness still relies
on the recorded review that established them. Overview is derived from the Product
Contract, never a separate authority. Changing expected hashes to suppress an
unexplained failure is prohibited.
