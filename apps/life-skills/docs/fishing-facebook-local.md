# Local Fishing Facebook operator

Use the existing paced personal-profile workflow for local Facebook Group operation. The app's entry point delegates to the already installed `bryan-kier/fb-group-auto-poster` checkout; it owns no separate queue, rules, media, credentials or browser profile. This is operator wiring, not a replacement publication policy or a hosted publishing feature.

From the Fishing app root:

```powershell
Set-Location 'D:\fishing-local-facebook-20261109\apps\life-skills'
node scripts/fishing-facebook-local.mjs
```

No argument means `status`. Explicit `status` has the same behavior. It dispatches only `florida_campaign.py status` against the existing ledgers, with read-only SQLite connections and network/process/file-write guards. It never loads the browser adapter. Its group-level output is private operational information; keep it outside Git and shared handoffs. An `open` submission slot alone does not establish that a group is due or that publication is permitted.

For a separately authorized, explicit due run on the owner's available Windows desktop:

```powershell
node scripts/fishing-facebook-local.mjs run-due
```

This dispatches only the reviewed `florida_browser.py run-due`. The command may publish and wait between eligible submissions. It uses the existing personal identity, dedicated visible Playwright profile, exact checked captions/video, current rules fingerprints, holds, per-group rules and direct-readback receipts. The existing ledger reserves the next submission time before each attempt and preserves its 5–15 minute spacing across restarts. The worker stops on account warnings or uncertain submissions; changed rules and thread-only destinations require the existing operator review. Preserve pending/unknown results and reconcile them through the existing workflow before retrying. No detection evasion or guaranteed delivery is provided.

The workflow and maintenance instructions remain in `C:\Users\User\tools\fb-group-auto-poster\implementation\FLORIDA-OUTREACH.md`. A status check or this PR does not grant permission for a live run. Existing Codex scheduling remains with its current owner; this adapter creates or changes no automation.

The currently reviewed worker successor applies the owner's per-group Florida calendar cadence after explicit visibility, completeness, permission and moderation review. Its status summary distinguishes rules admission from current holds, cooldowns and due groups. The owner-approved successor has no campaign-wide daily cap and can start due work from 10:00 until before 18:00 America/New_York, retaining 5-15 minute spacing and prioritizing designated or rule-constrained opportunities. A Windows OS-owned mutex spans the full paced run and manual publish path; overlapping publishers refuse before browser startup. The normal 10 a.m. start and any authorized afternoon catch-up use the same guard. Status reports the guard and today/tomorrow agendas from current persisted outcomes. Process death releases the guard while the ledger preserves unknown reservations and pacing. Confirmed account/rate warnings, checkpoints and identity mismatches latch a private account hold even before reservation. Scheduled recovery and manual publishing remain blocked until Shlomo manually resolves the problem and the existing operator records his explicit resolution. Status exposes the hold; later page loads never auto-clear it. Generic network failures and pending/unknown submissions do not invent account holds. Slow uploads, unavailable desktop or safety stops can still leave work pending. Consult the existing worker procedure and private live rule records for the actual schedule and qualifications. The app stores only the reviewed code/interpreter pins.

Declined campaign deliveries remain per-group nonretry holds even after a later rule review. Direct readback waits for the canonical story, exact author and video to hydrate, and excludes only actual inline See more/See less button controls before the exact caption comparison. Literal caption words, both links and ambiguous/mismatched content keep their existing checks. These code pins apply on the next worker launch; they do not hot-reload an already running publisher.

The current worker also skips an unavailable `Write something...` opener only after confirming the failure happened before reservation and no account or uncertain-submission hold exists. It records that group as needing review, continues other due groups, and finishes with `needs_action` when any groups were skipped. A post-click timeout still stops the full run with its durable unknown reservation.

On a post-click timeout, the worker can save bounded visible composer text, a viewport screenshot and diagnostic metadata before the page closes. These remain under the existing private `sessions/submission-diagnostics` directory. It records an unverified candidate story URL only when the observed create request and response explicitly bind the intended actor, exact group audience and caption; missing or ambiguous binding never produces a candidate. This does not update the delivery permalink, settle the unknown reservation, perform readback, retry, navigate or continue to another group. Diagnostic storage failure preserves the original timeout. Raw responses, browser storage and cookies are not captured.

Run/account-check events use the existing stdout log. Read-only status derives bounded last-run evidence, the last verified login time, confirmed publication time and the exact next planned 10:00/14:00 Florida target. Missing evidence stays unknown; a saved profile or previous publication does not establish current login. This calculation creates no timer and does not prove the desktop will wake. The owner panel consumes the same evidence through the existing versioned encrypted snapshot; hosted controls cannot start or resume the local worker.

## Installation binding

The reviewed installation is exactly `C:\Users\User\tools\fb-group-auto-poster`, resolved from both the current Windows home and OS user home. It must remain the original checkout at the commit pinned by `COMMIT` in `scripts/fishing-facebook-local.mjs`, with no unreviewed Git changes. The launcher verifies exact SHA-256 bytes for its five consumed Python modules, virtual-environment binding and interpreter files. Redirected paths, symlink/junction ancestors, alternate worktrees, other OS/home paths, hosted/CI/production/test environments and all extra arguments fail closed. There is no path, profile, media, group, force or headless override.

Python runs with isolated startup, no site startup hooks and no bytecode writes. The bridge compiles hash-checked local module bytes directly, avoiding stale cached bytecode and refusing other poster modules, including the upstream mass loop. Third-party packages come from the installed virtual environment. The reviewed worker retains its own runtime identity, media and rules checks; the app does not copy those mutable approvals into another registry. A changed installation needs a fresh review and an intentional pin update; do not automatically accept a new hash, reset its ledgers or fall back to another poster.

The command is never imported by app runtime, routes or startup. The hosted Marketing snapshot remains read-only under its [existing release boundary](fishing-marketing-release.md). This change does not synchronize a snapshot, alter feature/provider flags, activate retired feeds, change BNA, or deploy anything.

## Verification

Run from the repository root with Node and Python available:

```powershell
node --test apps/life-skills/tests/operators/fishing-facebook-local.test.mjs
```

The tests use disposable synthetic modules and SQLite files, never installed campaign data or Facebook. Even an explicit `run-due` is rejected in test processes. They cover command selection, environment/path/commit/hash rejection and read-only status enforcement. Run the no-argument command separately on the bound machine to verify the actual installed status path. A live due run is outside these checks.

Current intent routes remain [Fishing Start here](https://docs.google.com/document/d/1AwB6My_ZrXf09j5ZFXvu42UKW30kCnlWU7_sLDpFHIA/edit?tab=t.4omt1dj3ko64), the current and mixed decision logs, and the existing Fishing Continuation. The current `JLFA-OWNER-FULLSTACK-PACKAGE-20261110-01` and its T12/T13/T15 clauses govern this slice. The existing source/integration owner records repository adoption and remaining runtime evidence in the same task; this derived operator note does not grant effect authority. The app's shared integration/release ownership is unchanged.
