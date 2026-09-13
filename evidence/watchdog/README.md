# SYS-042 watchdog preparation

This lane prepares a secret-free scheduled watchdog for the Life Skills creative operator. It does not install, dispatch or merge the workflow.

The prior natural scheduled run, [GitHub run 34105683645](https://github.com/sdratler/inner-leadership/actions/runs/34105683645), failed on 7 September 2026 while an obsolete credentialed live source audit compared changed canonical and control fingerprints with a stale baseline. That failure is evidence of a schedule firing, not a successful watchdog installation.

The replacement workflow runs only repository code. It installs the bounded operator from its lockfile, verifies all four registered website hero masters, records zero model and provider calls, and uploads both the watchdog report and a schedule receipt. A manual `workflow_dispatch` receipt is deliberately marked ineligible as installation proof.

Integration order is strict:

1. PR #22 must first be merged under its own recorded authorization so the referenced operator exists on `main`.
2. The workflow-file PR must receive a separate owner-authorized CI/control transition; the existing trusted-control check must remain blocking until then.
3. After merge, allow the cron schedule to fire naturally. Do not substitute a manual dispatch.
4. Record the successful `event=schedule` run URL, exact main SHA and uploaded `scheduled-run-receipt.json` in Build Control.

Until all four steps complete, watchdog installation remains **UNVERIFIED**.
