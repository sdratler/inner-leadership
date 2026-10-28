# Owner 305 conversation classification

The People page offers a manual register for conversations on `+1 (305) 491-6674`. Its private API is `/api/private/owner-305-conversations`. Only the signed-in active practitioner in the existing workspace can read or write it. It creates no Person, contact, provider receipt, call activity, message, enrollment, or automatic follow-up task. Contact hints, notes, classifications, and actions are encrypted at rest; the tables are append-only.

## Release order

1. Complete and verify the separate schema-only 0138–0139 release. The 0140 operator requires that exact ledger prefix and the prior schema readback; current production was at 0137 when this branch was prepared.
2. Deploy this reviewed code with `LS_305_CLASSIFICATION_ENABLED` unset or `false`. Prepare a real database backup/readback, isolated restore verification, and rollback review. Supply a protected proof file bound to the exact deployment, reviewed Git commit, manifest/source hashes, database URL hash, and baseline ledger hash. Set `LS_305_SCHEMA_PROOF_FILE` and `LS_305_SCHEMA_PROOF_SHA256` only in the operator environment.
3. Run `npx tsx scripts/release-owner-305-schema.ts --source-digest` offline to obtain the candidate source digest. Run `--preflight` against the exact Railway target; review its one pending migration (`0140_ls_owner_305_conversations.sql`). For the one schema-only apply, set `LS_305_SCHEMA_APPLY_APPROVED=true` and run `--apply`. Then run `--verify-only`. Do not use the loopback-only `npm run db:migrate` for production.
4. After schema readback, enable `LS_305_CLASSIFICATION_ENABLED=true`, sign in as the ordinary owner, enter one clearly synthetic conversation, read it back, update its classification with the same operation on uncertain retry, and confirm it is absent from the contacts/People identity store. Treat provider conversation history and real 305 message delivery as separate evidence.

The 0140 operator is independent of the 0138–0139 operator. Its apply path refuses a live classification flag, unbound target, changed migration source, stale backup/restore proof, partial schema, changed ledger, or missing explicit apply flag. It does not run as a web-process startup migration.
