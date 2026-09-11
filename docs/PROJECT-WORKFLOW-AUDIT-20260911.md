# Project operating-workflow audit — 2026-09-11

Scope: source/instruction/automation structure at `sdratler/inner-leadership` main `0af6981cbab1c5e79ebc0ffb4d29bd08020b7729`, current Operating 2.5 export, draft PRs 16/22/23, and selected downstream release PR metadata. This is not a full application-security audit, live private-login test, provider-settings audit, or proof of complete business-feature coverage. No runtime, CI, deployment, generation, or provider configuration was changed.

Findings below refer to the original audited main. This reconciliation branch adds the documentation/creative contract and marks remaining runtime work separately.

## Findings and smallest corrective actions

| Finding | Evidence | Practical effect | Minimum correction |
| --- | --- | --- | --- |
| F01 — root README was an obsolete business master | Original `README.md` described Inner Leadership, ages 7–13, Beit Shemesh, old pricing, Google-first/GHL production and no WhatsApp automation | New workers could select the wrong offer and runtime before reading current sources | Replace active commercial assertions with CURRENT registry pointers; retain old files only as provenance. Prepared in this reconciliation branch. |
| F02 — embedded instructions conflict with current Operating 2.5 | Original `AGENTS.md` CLAIM LEASE requires read/write/read Work Graph claims; the registered Operating Protocol 2.5, read during this audit CLAIM LEASE requires append-only Control Events and a winning fence | Two workers following different supposedly-current instructions can claim the same work or reject valid carry-over | Retire the stale embedded block or replace it verbatim from the canonical export, with source revision/hash. Never keep two executable settings blocks. |
| F03 — identical version labels do not imply identical instructions | AGENTS lists Operating v2.5 while preserving older PREFLIGHT, CLAIM LEASE and GPT-FIRST text | A version-only check misses the drift | Record content hash and source read time; compare exact settings blocks. Treat copied labels as provenance only. |
| F04 — main source checker is an older generation | `tools/source-audit/expected.json` pins website2.3, registry2.3, operating2.2, prompts2.3, packet1.3; current Operating explicitly says the older main checker is not the six-lane preparation runner | A correctly strict old checker fails current approved sources, encouraging manual overrides and repeated packets | Document installed checker versus registered preparation bundle separately. Retrieve its independent receipt through existing Workflow Control. Do not modify expected fingerprints to force PASS. |
| F05 — namespaced work can be unrepresentable by the old checker | `tools/source-audit/audit.py:46` accepts LS/SYS/PRG/MKT/OPS/FIN only; CRE/WEB absent | Creative work cannot honestly pass that check merely because other lanes do | Record the exact gate capability gap and route through the authorized current checker; any future checker change needs its own reviewed control transition. |
| F06 — existing CI is not a current-source reconciliation service | `.github/workflows/control-integrity.yml` checks proposed paths against frozen CI/control prefixes; `pr-ci.yml` runs source-checker tests, root static tests/build, and private-app tests | Green checks can coexist with a stale README, wrong creative policy and unimplemented batch workflow | Explain check scopes in the operator return receipt. Add actual contract checks only in a separately reviewed CI change; do not call current green checks full source or visual approval. |
| F07 — no daily source-audit schedule in this repository's main workflow tree | Main contains only `control-integrity.yml` and `pr-ci.yml`; neither has a schedule or current Drive collector invocation | A statement that daily auditing is installed cannot be inferred from this tree | Record main workflow inventory and require an actual schedule-event receipt for any external/other-generation scheduler. Do not infer no scheduler exists anywhere else. |
| F08 — canonical creative and operator implementations are still unmerged drafts | Main has neither `creative/**` nor `tools/life-skills-operator/**`; PR16 and PR22 introduce them | Users believe there is an active engine when only prepared code and comments exist | Give each capability an explicit prepared/integrated/runtime-verified state, with exact commit and evidence. |
| F09 — the proposed intent compiler is not a complete ramble engine | PR22 IntentSchema accepts requestedChanges/preserve but compiler does not apply them as typed field changes; current CLI resolves a model intent and prints a contract | Specific corrections such as “move the title” can be reduced to summary text without executable effect | Normalize into typed target/change/preserve fields; compare against canonical state; record a reversible diff; do not execute unresolved layout adjectives. |
| F10 — plan mode still consumes model calls; bulk mechanics absent | PR22 `cli.mjs` calls `resolveIntent` before either mode; resolver invokes the OpenAI Agents model. Executor delegates to Codex. No durable job queue, idempotency ledger, real OpenArt adapter, cost ceiling or output persistence exists there | Planning can spend credits; repeated starts can redo work; stdout is mistaken for documentation | Add an offline structured-input planning path and a resumable job/receipt adapter in the future code lane. Do not advertise the batch system as installed now. |
| F11 — source snapshots and feature docs lag behind integrated source | `apps/life-skills/docs/current-sources.json` is LS000 build provenance from Sept6. App README says no login handler/case database, but `src/features/identity/**`, `features/cases/**` and an identity route now exist | A manager cannot infer installed capability or percentage complete from these historical snapshots | Label build provenance explicitly and maintain a derived feature-status table keyed to work IDs/commits/tests/runtime evidence. Preserve architecture source authority in Drive. |
| F12 — source feature presence is not live login readiness | `src/proxy.ts` defaults to foundation_locked and denies private routes; `features/identity/config.ts` requires explicit enablement, HTTPS and validated private configuration | Existing identity code does not prove customers can log in | Keep identity implementation, interface acceptance, runtime configuration and successful live journeys as distinct statuses. Do not enable or probe private production without its authorized scope. |
| F13 — source and deployed artifacts can diverge | BNA PR150 imported source main revision; later BNA PR151 changed mobile identity/PWA/prefills downstream | Comparing only source main can miss deployed corrections | Register source SHA, built artifact digest, downstream commit and provider deployment receipt together. Port intentional downstream source changes through the source lane rather than maintaining parallel authorities. |

## Verified settings mismatch

Exact BEGIN-to-END settings-block SHA256 (UTF-8):

- Original main AGENTS: `d60b81d8f478b57e94bc9929110a225e2a7ee2001458de419b6a4f022d5190af`
- Current Operating 2.5 export: `3beb8ca02af44e81ff3987e42ebc95588a6905cb3bcf15d4d5d94e88504100d6`

The current Operating export additionally:
- identifies the independently verified preparation checker rather than the installed older main checker;
- restricts provisional downstream work to an exact Integrated parent;
- identifies active GPT_PACKET preparation and a GPT_GIT target that is still INACTIVE absent separate activation evidence;
- uses append-only claims with readback, winner/fence validation and immutable event retry;
- distinguishes preparation, integration, runtime installation and owner acceptance.

The user's explicit current instruction authorizes the present bounded audit/documentation task. That task authorization must not be misreported as installation of the broader protected GPT_GIT automation.

## Installed versus only prepared

| Capability | Evidence-based state |
| --- | --- |
| Proposed-code CI | Workflow files exist on main. PR22 head has a completed successful “Life Skills proposed-code CI” run: [34573833062](https://github.com/sdratler/inner-leadership/actions/runs/34573833062). This does not prove operator-specific tests ran in CI. |
| Frozen CI/control path check | Implemented in trusted base workflow. It reviews paths, not semantic brand correctness or every Drive source. |
| Source-audit checker and unit suite | Implemented older generation in main. No fresh full-source PASS was run in this subtask. |
| Six-lane preparation checker | Current Operating describes an independently pinned external packet. Installation/readback not established from main; the executor must use current Workflow Control evidence. |
| Current daily source audit | No scheduled workflow in inspected main. External schedule/history unverified. The available commit-run wrapper filters PR events and cannot establish absence of scheduled runs. |
| Creative registry | PR16 draft only on original main; the new registry remains prepared until integrated. |
| Creative Operator SDK | PR22 draft only, wrong current visual contract. |
| OpenArt batch engine with durable records | Not implemented by PR22 source. Connected OpenArt tool access is a separate capability, not proof of this engine. |
| Four approved website hero masters | Not established by the repository state; separate asset audit owns current bytes and approval receipts. |
| Private identity functionality | Source implementation exists behind closed/configured boundaries. No live runtime/auth journey was tested. |
| Website release | Downstream PR150 and151 are merged; authenticated provider revision and live page were not checked in this subtask. |

## Downstream evidence

- [BNA PR150](https://github.com/shloimie-beep/bnei-neviim-academy/pull/150): merged Sept10; imports source `0af6981cbab1c5e79ebc0ffb4d29bd08020b7729`; downstream merge `518aa38c91d7f87b4e8e8f6712cb74ebf1c4e9a0`.
- [BNA PR151](https://github.com/shloimie-beep/bnei-neviim-academy/pull/151): merged Sept10; adds mobile/route identity and locale WhatsApp prefills; downstream merge `85365ea5fdbad18f52fc66d9329153887778da7f`.

PR bodies report earlier tests and deployment intentions. Those are historical claims, not fresh deployment proof from this audit.

## Recommended minimal governance document

Create one compact repository protocol that points to, and does not copy, the existing business/control sources. It should define this operating sequence:

1. **Capture:** preserve the user's change in a neutral intake record with its source reference; do not copy private client data.
2. **Resolve:** read the current relevant state and classify an existing instruction, an explicit correction, or a genuinely unresolved business choice.
3. **Clarify only material ambiguity:** ask one targeted question when missing information changes output, costs or external effects. Do not ask the owner to repeat known selections.
4. **Record:** map the approved change to the same canonical source; record before/after revision or asset hash and the dependency invalidation it causes.
5. **Plan:** make one typed, reversible execution contract with target, permitted changes, invariants, budget and verification. Existing rules must be read, not restated as new independent masters.
6. **Execute:** the assigned code/image lane resumes its existing job using exact inputs and a durable job identifier. Discussion alone launches no paid operation.
7. **Verify:** compare the actual result with the specific instruction and approved pixels; verify Hebrew visually and textually; evaluate controls in the browser when appropriate.
8. **Close:** record separate prepared, generated, reviewed, approved, integrated and live evidence. Report the completed result and the one remaining dependency rather than another untracked plan.

For lower cost: reuse verified assets; use deterministic source/receipt checks; only reread or summarize changes within the required fresh source gate; avoid model calls for already structured jobs; enforce one proof for a new composition and resume failed jobs without regenerating successful outputs. Do not bypass a required freshness/security gate to save tokens.

## Audit disposition

The existing native Operating Protocol and Prompt Pack were subsequently reconciled in place to versions 2.6 and 2.8 under `AUDIT-CREATIVE-SOT-20260911-01`. Guarded writes and fresh native readback verified identical 7,912-character installable blocks, unchanged text outside the reviewed replacements, and no lost protected controls. Their shared block SHA256, excluding its terminal newline, is `25b6b9710d26ddd5849939d712e03ddb8d8b9d1159f28db2b183033edc2dd1dc`. `PROJECT-INSTRUCTIONS-TO-PASTE.md` contains that exact block. Project Settings UI, Workflow Control activation, source-checker admissions and runtime scheduling were not changed by those writes.

Active findings are mapped for root reconciliation, not declared done. F01 documentation is prepared. F02's stale embedded settings block has also been removed in the local AGENTS patch and replaced with current Operating and PROJECT-WORKFLOW pointers, under the owner's explicit correction. These edits are a reviewable correction and do not establish installation. F03–F13 are mapped in the consolidated handoff or their existing scoped implementation lanes. Preserve existing working lanes and add precise remaining work, not another competing master project plan.
