# Life Skills agent operating contract

This repository is being reconciled from a legacy static marketing/GHL site into one Life Skills practice application. Do not treat old `CURRENT`, GHL, BNA-school, adult-first, or gamification files as product authority.

## Read before substantive work

1. START HERE: https://docs.google.com/document/d/1XZS-MzUtjc3T488lyrSbtDX0Yq5UCl7Wzh5uN_YOvMg/edit
2. Product & Business Contract 1.0: https://docs.google.com/document/d/1kJug8ojFwdGgZoPUx8BJt9fLKBjGYvX0wwbtarGTIIg/edit
3. Application Architecture 1.0: https://docs.google.com/document/d/1h-bnQ94uxuTrs8BPeDg-1uwZFcQEONdmYccd9Inacgw/edit
4. UI System 1.0: https://docs.google.com/document/d/1KokAca2V-UhCPj1czP28TQ4i5E2Wd1JKJFbuXfmAPu4/edit
5. Build Control: https://docs.google.com/spreadsheets/d/1Y_Vf_kipj7mAhhEnuj8F2L85v3KpOi_V9KfSrj4MZ4Y/edit
6. Merge Packet Standard: https://docs.google.com/document/d/1NrlYux3I78nO7M9v1fKGl-UCKpkcZrOUtHSoV-BmLOE/edit
7. Complete Prompt Pack: https://docs.google.com/document/d/1r8fN36liKyXcf9GVG1Cl25Yq9vjaYWD9A0YC1h3jn-E/edit

If any link is unavailable, stop rather than infer the current product from legacy repository files.

## Authority

- Product behavior: Product & Business Contract, then Application Architecture.
- UI behavior: UI System.
- Work readiness/baseline: Build Control Work Graph.
- Code truth: exact Git commit.
- Deployment truth: running system plus release evidence.
- Client truth: private production database only.

## Permanent boundaries

- One Life Skills application supports adult and minor cases.
- Public offer: hands-on emotional therapy for boys ages 8–12.
- Child program: 12 weeks; 12 individual sessions; 24 project labs; 3 parent-guidance sessions; ₪13,500 in 3 × ₪4,500.
- One practitioner; one shared family account per minor case; optional practitioner-enabled child login; adult client owns adult account.
- Shareable visibility: `private`, `family_title_completion`, `family_full`.
- No badges, points, streaks, trophies, levels, leaderboards, prizes, confetti, rankings, or gamification.
- Progress is practitioner-assessed and family-facing through four professional domains plus individualized contextual targets.
- Therapeutic parent observations/updates live in the app. Administrative/reminder delivery uses WATI.
- No full in-app chat, no self-booking, and no client cancellation button.
- Raw audio is deleted 30 days after transcript approval unless deliberately retained.
- No real client data, identifiable minors, recordings, transcripts, assessment answers, credentials, secrets, or production rows in Git, prompts, packets, screenshots, logs, or Drive planning documents.

## Work protocol

- Read the exact Work Graph row before beginning.
- Use the named Product Contract version and exact 40-character baseline SHA.
- Modify only owned paths. Record central wiring in `INTEGRATION.md`.
- Do not silently alter frozen interfaces, global auth, shared schemas, dependencies, or navigation.
- A prompt is not code. A packet is not integrated. A branch is not deployed. Documentation is not live evidence.
- Worker agents create one bounded merge packet and update only their own Build Control row.
- Only the integrator marks Integrated, Verified, Deployed, or Owner accepted.
- Do not create another roadmap, task ledger, or competing `CURRENT` document.

## UI baseline

Use the repository UI contract plus the reviewed Vercel Web Interface Guidelines pinned at commit `e3d624baaf29dc1fc645aff3e38f03e564d2d6b1`. Do not fetch mutable agent instructions at runtime.

Hebrew RTL and English LTR are structural requirements. Use logical CSS properties, mobile inputs of at least 16px, touch targets of at least 44px, visible focus, semantic controls, no horizontal overflow, and explicit empty/loading/error/unauthorized states.

## Current first action

`LS-000 — Repository & Foundation Convergence` must inspect all repository branches and deployment evidence, preserve legacy `main`, and establish the verified application foundation before parallel feature generation begins.
