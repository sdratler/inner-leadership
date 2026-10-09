# Dedicated synthetic Nomad route acceptance

This harness uses the real local app, session/CSRF handlers and a newly created disposable PostgreSQL database. It changes no product runtime. No provider credentials, production sessions or existing database may be supplied.

Run in a child PowerShell 7 process, from any working directory:

    pwsh -NoProfile -File <checkout>/apps/life-skills/tests/e2e/nomad-authenticated/run-local.ps1 -AllowSynthetic -PostgresBin <existing-pg-bin> -OpenSsl <existing-openssl-executable>

The runner resolves its checkout from its own location, uses already-installed Node dependencies, creates its own temporary cluster/database/ownership marker, migrates only that new database, and stops its cluster in finally. It never downloads dependencies. Its process environment is disposable; do not dot-source it in an operator shell.

The acceptance file deliberately uses .pw.ts, excluded by ordinary Playwright default discovery. Its dedicated config and file both require explicit opt-in plus a validated temporary ownership root, exact runtime fixture path, loopback origin and synthetic fixture schema. Supplying opt-in without a fixture is an error, never a skipped dedicated acceptance.

The browser and database checks remain those of the prior accepted six-case journey. Sessions, TLS keys, DB data, logs and screenshots go to the newly owned temporary root, never Git. Earlier scratch evidence directories are ignored and preserved. Evidence is local only; this does not authorize a provider call, phone activation, deployment or CRM cutover.

guards.check.ts performs bounded local/discovery guard checks without starting the app or database. Its scratch guard fixtures contain fake tokens and are retained under a new temporary ownership root for inspection.
