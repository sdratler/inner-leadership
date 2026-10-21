-- UNNUMBERED OWNER03 LEGACY UPGRADE PROPOSAL. Root scope1360/Change1388.
-- Requires independently classified exact legacy candidate, NOT absent/partial/current.
-- Legacy native schema SHA256 eb9da1c89b77c3472455181369cf0f57129f4054e7b7cf826538f375c2f5f048
-- Current native schema SHA256 3975ad3a28e0810ef8d94e274a0912d959efddfbb34da5e950bee6e09cb271d4
-- Caller owns one migration transaction and current target/catalog/recovery authority.
-- No migration number/manifest adoption, importer, backfill, grants or provider effect.
LOCK TABLE ls_fishing_stage.enrollments IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
 IF to_regclass('ls_fishing_stage.block_acceptances') IS NOT NULL
 OR to_regclass('ls_fishing_stage.refund_cancellations') IS NOT NULL
 OR to_regclass('ls_fishing_stage.refund_fee_reservations') IS NOT NULL
 OR NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='ls_fishing_stage' AND table_name='enrollments' AND column_name='terms_acceptance_id' AND is_nullable='NO')
 OR EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema='ls_fishing_stage' AND table_name='enrollments' AND column_name='block_acceptance_id')
 THEN RAISE EXCEPTION 'OWNER03_UPGRADE_BASELINE_REQUIRED'; END IF;
END;
$$;
CREATE TABLE ls_fishing_stage.block_acceptances (
 workspace_id uuid NOT NULL,id uuid NOT NULL,block_id uuid NOT NULL,
 stage_id uuid NOT NULL,learner_id uuid NOT NULL,household_id uuid NOT NULL,parent_id uuid NOT NULL,
 source_approval_id uuid NOT NULL,source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 occurrence_ids uuid[] NOT NULL CHECK(cardinality(occurrence_ids)=4 AND array_position(occurrence_ids,NULL) IS NULL
  AND occurrence_ids[1]<>occurrence_ids[2] AND occurrence_ids[1]<>occurrence_ids[3] AND occurrence_ids[1]<>occurrence_ids[4]
  AND occurrence_ids[2]<>occurrence_ids[3] AND occurrence_ids[2]<>occurrence_ids[4] AND occurrence_ids[3]<>occurrence_ids[4]),
 accepted_at timestamptz NOT NULL,command_id uuid NOT NULL,
 payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 100000),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,block_id),
 FOREIGN KEY(workspace_id,stage_id) REFERENCES ls_fishing_stage.cohorts(workspace_id,stage_id),
 FOREIGN KEY(workspace_id,learner_id) REFERENCES ls_identity.people(workspace_id,id),
 FOREIGN KEY(workspace_id,household_id) REFERENCES ls_cases.families(workspace_id,id),
 FOREIGN KEY(workspace_id,source_approval_id) REFERENCES ls_fishing_stage.source_approvals(workspace_id,id),
 FOREIGN KEY(workspace_id,parent_id,command_id) REFERENCES ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id) DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE ls_fishing_stage.enrollments
 ALTER COLUMN terms_acceptance_id DROP NOT NULL,
 ADD COLUMN block_acceptance_id uuid,
 ADD FOREIGN KEY(workspace_id,block_acceptance_id) REFERENCES ls_fishing_stage.block_acceptances(workspace_id,id),
 ADD CHECK((terms_acceptance_id IS NOT NULL)<>(block_acceptance_id IS NOT NULL));
CREATE TABLE ls_fishing_stage.refund_cancellations (
 workspace_id uuid NOT NULL,id uuid NOT NULL,household_id uuid NOT NULL,payer_account_id uuid NOT NULL,
 policy_version text NOT NULL,decision_id text NOT NULL,revision integer NOT NULL CHECK(revision=1),
 purchase_ids uuid[] NOT NULL CHECK(cardinality(purchase_ids) BETWEEN 2 AND 20 AND array_position(purchase_ids,NULL) IS NULL),
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 100000),
 actor_id uuid NOT NULL,command_id uuid NOT NULL,recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,id,household_id,decision_id),
 FOREIGN KEY(workspace_id,household_id) REFERENCES ls_cases.families(workspace_id,id),
 FOREIGN KEY(workspace_id,payer_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_id,command_id) REFERENCES ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX fishing_refund_cancellation_members ON ls_fishing_stage.refund_cancellations USING gin(purchase_ids);
CREATE TABLE ls_fishing_stage.refund_fee_reservations (
 workspace_id uuid NOT NULL,id uuid NOT NULL,cancellation_id uuid NOT NULL,household_id uuid NOT NULL,decision_id text NOT NULL,
 fee_cents integer NOT NULL CHECK(fee_cents=20000),review_sha256 text NOT NULL CHECK(review_sha256 ~ '^[a-f0-9]{64}$'),
 proposal_sha256 text NOT NULL CHECK(proposal_sha256 ~ '^[a-f0-9]{64}$'),request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 100000),
 actor_id uuid NOT NULL,command_id uuid NOT NULL,recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,cancellation_id),UNIQUE(workspace_id,household_id,decision_id),
 FOREIGN KEY(workspace_id,cancellation_id,household_id,decision_id) REFERENCES ls_fishing_stage.refund_cancellations(workspace_id,id,household_id,decision_id),
 FOREIGN KEY(workspace_id,actor_id,command_id) REFERENCES ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TRIGGER immutable_program_block_terms BEFORE UPDATE OR DELETE ON ls_fishing_stage.block_acceptances FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.reject_program_history_rewrite();
CREATE TRIGGER immutable_refund_cancellations BEFORE UPDATE OR DELETE ON ls_fishing_stage.refund_cancellations FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.reject_program_history_rewrite();
CREATE TRIGGER immutable_refund_fee_reservations BEFORE UPDATE OR DELETE ON ls_fishing_stage.refund_fee_reservations FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.reject_program_history_rewrite();
