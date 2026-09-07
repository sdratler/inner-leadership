# Life Skills source integrity 2.0.0

This is a read-only, fixed-source administrative integrity check, not a product contract, deployment receipt, client-data processor or semantic guarantee. CURRENT Drive remains authority. Policies are reviewed data; a new hash alone is not permission to change policy.

## Separate trust paths

`source-audit.yml` ordinarily runs only trusted-base code under `pull_request_target`. It fetches proposed files as bytes to verify exact hashes, interprets only bounded JSON policy/receipt data, checks independent approval in Build Control, and binds the result to the exact current PR head. It does not check out or run proposed app code, shell scripts, workflows, dependencies or caches with the Google reader. Proposed-code tests run under a separate `pull_request` workflow with no Google, provider or production credentials.

The initial 1.1.0-to-2.0.0 migration cannot pretend the old checker understands the new policy. A `workflow_dispatch` on the independently reviewed exact head is the narrow bootstrap exception. The existing default-branch workflow must exist, the server must accept the reviewed branch dispatch, and `source-policy-bootstrap` must have an actual independent reviewer, prevent self-review and disallow administrator bypass. The reviewer checks the full delta, external receipt digest and exact commit. Unsupported dispatch/protection or lack of an eligible reviewer means Blocked; do not loosen protections or manufacture a successful commit status.

Before any proposed branch push, verify provider-side branch/deploy isolation. Before any credential-bearing job, contain the documented credential exposure privately and verify the Releases security row. Store the Google reader only in scoped environment secrets, never in repository-wide or organization-inherited secrets available to ordinary PR jobs. The standing reader may read only the nine registered non-client Docs and Build Control. The ordinary-reader environment must allow the actual executing trusted main ref only. Remove a former repository-level reader secret only after exact identity, consumers, replacement and readback are verified; never print any value. The bootstrap reader environment is restricted to the reviewed remediation branch and real approval gate.

## Policy receipt

`expected.json` is canonical-JSON hashed (sorted keys, UTF-8, compact separators) independently of its on-disk byte SHA256. `policy-receipt.json` lists every changed PR file's raw SHA256, excluding itself; removal is `null`. The receipt is itself canonical-JSON hashed and pinned in Build Control Policy Receipts. An independently Approved row must match the base/result policy digests, receipt digest, exact Work ID scope, expiry, independent reviewer, evidence URL and exact current head. This head binding is outside the commit to avoid circular self-hashes. Any file, policy, head, base, expiry or scope change requires another reviewed exact receipt. The maker is not the independent approver.

Current receipt effect limits deny merge, deployment, paid activation, private-client-data use and downstream unlock. Mutable Work Graph status/claim/output/Next Action are not definition fingerprints. Stable definition columns are A,B,C,D,E,H,I,J,O. Interface fingerprints use A,B,C,D,E,G,H; acceptance metadata is checked separately. Overview authority is rows18:25; dynamic status summaries are not contracts. All schema-migration digests are explicitly listed in the SYS033 review packet; never regenerate accepted fingerprints just to make a failure disappear.

## CLI

From the repository root, execute `python3 -m unittest discover -s tools/source-audit/tests -v` without credentials. `audit.py --snapshot PATH --work-id SYS-034 --baseline SHA --phase integrate --packet SYS-033=ZIP --output REPORT` consumes a fresh private administrative connector snapshot. Do not commit or upload the raw snapshot.

Prefer the wrapper: `python3 tools/source-audit/preflight.py --work-id SYS-034 --claim-id CLAIM --snapshot PATH --packet-dir PRIVATE_PACKET_DIRECTORY --output REPORT`. It derives the phase, exact accepted starting SHA and producer arguments from the actual row and verifies outer/inner producer hashes. `--preclaim` is limited to a Ready unclaimed row; it does not create a claim. `--live` replaces `--snapshot` only for the reviewed installed checker. `preflight.sh` and `preflight.ps1` provide the same contract. OpenSSL is discovered from an existing explicit absolute executable, PATH or supported Windows installations; nothing is downloaded. Windows execution still needs installer verification.

`policy_gate.py --pr NUMBER --publish-status --output REPORT` runs in the trusted-base PR job. `--bootstrap-head EXACT_SHA` is permitted only in the protected reviewed dispatch. Status success is possible only after a complete PASS with an unchanged exact head; a denial publishes failure, never forced success. Raw credentials/source bodies are never emitted.

The checker reads and reconciles Work Graph, Decisions, Interfaces, Overview, Instructions, Chat Runs, Merge Packets, Releases, Change Log and Policy Receipts. A reachable branch is not merged main. Reconstructed integration runs are warnings, not new runtime tests. Deployment requires scoped provider evidence; historical reported deployment remains historical. Interface declarations are not frozen merely because they compile. The five application consumers remain ineligible until LS025 is accepted on main and all required interfaces have evidence.

## CI and evidence limits

`pr-ci.yml` runs static checks, app lint/types/unit/UI/build, disposable database migration/idempotency checks and browser suites, with existing LS025 database/HTTPS journeys when those files exist. `ci-identity.cjs` permits only the fixed disposable CI database at loopback, creates a separate empty synthetic identity database and temporary self-signed localhost keys, and never uses a real provider or persists keys. Node22 and postgres17 resolve within approved major versions; record actual resolved versions/image digest in the installer evidence. Do not claim these jobs passed until they run.

A prepared schedule is not installed. A manual audit is not a natural scheduled run. Check actual installed workflow SHA, event type, run URL and conclusion before asserting schedule verification. This tool never grants merge/deployment authority or rewrites controls.
