-- UNNUMBERED ISOLATED CANDIDATE. MAIN registration/review/run gates remain.
-- Requires the unchanged payment candidate and five native Stage tables.
-- No importer, backfill, role grant, provider, clinical case or migration entry.
CREATE TABLE ls_fishing_stage.command_receipts (
 workspace_id uuid NOT NULL,actor_id uuid NOT NULL,command_id uuid NOT NULL,
 action text NOT NULL CHECK(length(action) BETWEEN 1 AND 80),request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 result_ciphertext text NOT NULL CHECK(octet_length(result_ciphertext) BETWEEN 1 AND 100000),
 recorded_at timestamptz NOT NULL,stage_operation_id uuid,source_stage_id uuid,expected_stage_revision integer CHECK(expected_stage_revision>0),
 PRIMARY KEY(workspace_id,actor_id,command_id),
 FOREIGN KEY(workspace_id,actor_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_id,stage_operation_id) REFERENCES ls_fishing_stage.operations(workspace_id,actor_account_id,operation_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((action='stage.resources')=(stage_operation_id IS NOT NULL)),CHECK(stage_operation_id IS NULL OR stage_operation_id=command_id),
 CHECK((stage_operation_id IS NULL AND source_stage_id IS NULL AND expected_stage_revision IS NULL) OR (stage_operation_id IS NOT NULL AND source_stage_id IS NOT NULL AND expected_stage_revision IS NOT NULL))
);
CREATE TABLE ls_fishing_stage.source_approvals (
 workspace_id uuid NOT NULL,id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('terms','template','payment_condition')),
 version text NOT NULL CHECK(length(version) BETWEEN 1 AND 120),canonical_id text NOT NULL CHECK(length(canonical_id) BETWEEN 1 AND 500),
 source_revision text NOT NULL CHECK(length(source_revision) BETWEEN 1 AND 500),source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 approval_reference text NOT NULL CHECK(length(approval_reference) BETWEEN 1 AND 500),approved_by uuid NOT NULL,approved_at timestamptz NOT NULL,
 payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 100000),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,kind,version),
 FOREIGN KEY(workspace_id,approved_by) REFERENCES ls_identity.accounts(workspace_id,id)
);
-- Canonical references are immutable imported evidence, NOT approval controls
-- writable by a browser/operator. This slice exposes NO source approval writer.
CREATE TABLE ls_fishing_stage.cohorts (
 workspace_id uuid NOT NULL,stage_id uuid NOT NULL,cohort_id uuid NOT NULL,stage smallint NOT NULL CHECK(stage BETWEEN 1 AND 4),
 operator_id uuid NOT NULL,instructor_id uuid NOT NULL,template_approval_id uuid NOT NULL,terms_approval_id uuid NOT NULL,policy_approval_id uuid NOT NULL,
 child_capacity integer NOT NULL CHECK(child_capacity BETWEEN 1 AND 1000),revision integer NOT NULL CHECK(revision>0),active boolean NOT NULL,
 label_ciphertext text NOT NULL CHECK(octet_length(label_ciphertext) BETWEEN 1 AND 20000),
 decision_actor_id uuid NOT NULL,decision_command_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,stage_id),UNIQUE(workspace_id,cohort_id,stage),UNIQUE(workspace_id,stage_id,cohort_id,stage),
 FOREIGN KEY(workspace_id,operator_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,instructor_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,template_approval_id) REFERENCES ls_fishing_stage.source_approvals(workspace_id,id),
 FOREIGN KEY(workspace_id,terms_approval_id) REFERENCES ls_fishing_stage.source_approvals(workspace_id,id),
 FOREIGN KEY(workspace_id,policy_approval_id) REFERENCES ls_fishing_stage.source_approvals(workspace_id,id),
 FOREIGN KEY(workspace_id,decision_actor_id,decision_command_id) REFERENCES ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE ls_fishing_stage.venues (
 workspace_id uuid NOT NULL,id uuid NOT NULL,operator_id uuid NOT NULL,capacity integer NOT NULL CHECK(capacity BETWEEN 1 AND 1000),
 revision integer NOT NULL CHECK(revision>0),active boolean NOT NULL,approval_reference text NOT NULL CHECK(length(approval_reference) BETWEEN 1 AND 500),
 details_ciphertext text NOT NULL CHECK(octet_length(details_ciphertext) BETWEEN 1 AND 20000),
 decision_actor_id uuid NOT NULL,decision_command_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,operator_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,decision_actor_id,decision_command_id) REFERENCES ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE ls_fishing_stage.fit_decisions (
 workspace_id uuid NOT NULL,id uuid NOT NULL,stage_id uuid NOT NULL,learner_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN('enrollment','makeup')),decision text NOT NULL CHECK(decision IN('approved','rejected')),
 target_occurrence_id uuid,target_revision integer CHECK(target_revision>0),
 actor_id uuid NOT NULL,command_id uuid NOT NULL,recorded_at timestamptz NOT NULL,
 note_ciphertext text NOT NULL CHECK(octet_length(note_ciphertext) BETWEEN 1 AND 20000),
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,stage_id) REFERENCES ls_fishing_stage.cohorts(workspace_id,stage_id),
 FOREIGN KEY(workspace_id,learner_id) REFERENCES ls_identity.people(workspace_id,id),
 FOREIGN KEY(workspace_id,target_occurrence_id) REFERENCES ls_fishing_stage.occurrences(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_id,command_id) REFERENCES ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((purpose='makeup')=(target_occurrence_id IS NOT NULL AND target_revision IS NOT NULL)),
 CHECK(purpose<>'enrollment' OR (target_occurrence_id IS NULL AND target_revision IS NULL))
);
CREATE TABLE ls_fishing_stage.terms_acceptances (
 workspace_id uuid NOT NULL,id uuid NOT NULL,stage_id uuid NOT NULL,learner_id uuid NOT NULL,household_id uuid NOT NULL,
 parent_id uuid NOT NULL,source_approval_id uuid NOT NULL,source_sha256 text NOT NULL CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 accepted_at timestamptz NOT NULL,command_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,stage_id,learner_id,parent_id,source_approval_id),
 FOREIGN KEY(workspace_id,stage_id) REFERENCES ls_fishing_stage.cohorts(workspace_id,stage_id),
 FOREIGN KEY(workspace_id,learner_id) REFERENCES ls_identity.people(workspace_id,id),
 FOREIGN KEY(workspace_id,household_id) REFERENCES ls_cases.families(workspace_id,id),
 FOREIGN KEY(workspace_id,source_approval_id) REFERENCES ls_fishing_stage.source_approvals(workspace_id,id),
 FOREIGN KEY(workspace_id,parent_id,command_id) REFERENCES ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id) DEFERRABLE INITIALLY DEFERRED
);
-- Separate renewed acceptance per four-lesson purchase. Existing stage terms
-- and historical twelve-session purchases are not reclassified or backfilled.
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
CREATE TABLE ls_fishing_stage.offer_approvals (
 workspace_id uuid NOT NULL,id text NOT NULL CHECK(length(id) BETWEEN 1 AND 160),revision integer NOT NULL CHECK(revision>0),
 digest text NOT NULL CHECK(digest ~ '^[a-f0-9]{64}$'),payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 100000),
 policy_approval_id uuid NOT NULL,actor_id uuid NOT NULL,command_id uuid NOT NULL,recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,policy_approval_id) REFERENCES ls_fishing_stage.source_approvals(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_id,command_id) REFERENCES ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE ls_fishing_stage.enrollments (
 workspace_id uuid NOT NULL,id uuid NOT NULL,stage_id uuid NOT NULL,purchase_id uuid NOT NULL,purchase_line_id text NOT NULL,
 learner_id uuid NOT NULL,household_id uuid NOT NULL,fit_decision_id uuid NOT NULL,terms_acceptance_id uuid,block_acceptance_id uuid,policy_approval_id uuid NOT NULL,
 hold_id uuid NOT NULL,guardian_digest text NOT NULL CHECK(guardian_digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN('confirmed','suspended','revoked')),revision integer NOT NULL CHECK(revision>0),
 actor_id uuid NOT NULL,command_id uuid NOT NULL,recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,purchase_id,purchase_line_id),
 FOREIGN KEY(workspace_id,stage_id) REFERENCES ls_fishing_stage.cohorts(workspace_id,stage_id),
 FOREIGN KEY(workspace_id,purchase_id) REFERENCES ls_fishing_payments.purchases(workspace_id,id),
 FOREIGN KEY(workspace_id,learner_id) REFERENCES ls_identity.people(workspace_id,id),
 FOREIGN KEY(workspace_id,household_id) REFERENCES ls_cases.families(workspace_id,id),
 FOREIGN KEY(workspace_id,fit_decision_id) REFERENCES ls_fishing_stage.fit_decisions(workspace_id,id),
 FOREIGN KEY(workspace_id,terms_acceptance_id) REFERENCES ls_fishing_stage.terms_acceptances(workspace_id,id),
 FOREIGN KEY(workspace_id,block_acceptance_id) REFERENCES ls_fishing_stage.block_acceptances(workspace_id,id),
 CHECK((terms_acceptance_id IS NOT NULL)<>(block_acceptance_id IS NOT NULL)),
 FOREIGN KEY(workspace_id,policy_approval_id) REFERENCES ls_fishing_stage.source_approvals(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_id,command_id) REFERENCES ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE ls_fishing_stage.seat_reservations (
 workspace_id uuid NOT NULL,id uuid NOT NULL,hold_id uuid NOT NULL,stage_id uuid NOT NULL,occurrence_id uuid NOT NULL,learner_id uuid NOT NULL,
 origin text NOT NULL CHECK(origin IN('offer_hold','enrollment','makeup')),offer_id text,enrollment_id uuid,entitlement_id uuid,
 state text NOT NULL CHECK(state IN('reserved','confirmed','released')),revision integer NOT NULL CHECK(revision>0),hold_revision integer NOT NULL CHECK(hold_revision>0),
 actor_id uuid NOT NULL,command_id uuid NOT NULL,stage_operation_id uuid,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,entitlement_id),
 FOREIGN KEY(workspace_id,stage_id) REFERENCES ls_fishing_stage.cohorts(workspace_id,stage_id),
 FOREIGN KEY(workspace_id,occurrence_id) REFERENCES ls_fishing_stage.occurrences(workspace_id,id),
 FOREIGN KEY(workspace_id,learner_id) REFERENCES ls_identity.people(workspace_id,id),
 FOREIGN KEY(workspace_id,offer_id) REFERENCES ls_fishing_stage.offer_approvals(workspace_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(workspace_id,enrollment_id) REFERENCES ls_fishing_stage.enrollments(workspace_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(workspace_id,actor_id,command_id) REFERENCES ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(workspace_id,actor_id,stage_operation_id) REFERENCES ls_fishing_stage.operations(workspace_id,actor_account_id,operation_id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(workspace_id,entitlement_id) REFERENCES ls_fishing_stage.makeup_links(workspace_id,entitlement_id) DEFERRABLE INITIALLY DEFERRED,
 CHECK((origin='makeup')=(entitlement_id IS NOT NULL AND stage_operation_id IS NOT NULL)),
 CHECK(origin='offer_hold' OR enrollment_id IS NOT NULL)
);
CREATE UNIQUE INDEX fishing_one_active_learner_seat ON ls_fishing_stage.seat_reservations(workspace_id,learner_id,occurrence_id) WHERE state<>'released';
CREATE INDEX fishing_shared_seat_count ON ls_fishing_stage.seat_reservations(workspace_id,occurrence_id) WHERE state<>'released';
CREATE INDEX fishing_shared_hold ON ls_fishing_stage.seat_reservations(workspace_id,hold_id);
CREATE TABLE ls_fishing_stage.resource_reservations (
 workspace_id uuid NOT NULL,occurrence_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('instructor','venue')),
 resource_id uuid NOT NULL,instructor_id uuid,venue_id uuid,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
 occurrence_revision integer NOT NULL CHECK(occurrence_revision>0),active boolean NOT NULL,
 actor_id uuid NOT NULL,command_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,occurrence_id,kind),CHECK(ends_at>starts_at),
 CHECK((kind='instructor' AND instructor_id IS NOT NULL AND instructor_id=resource_id AND venue_id IS NULL) OR (kind='venue' AND venue_id IS NOT NULL AND venue_id=resource_id AND instructor_id IS NULL)),
 FOREIGN KEY(workspace_id,occurrence_id) REFERENCES ls_fishing_stage.occurrences(workspace_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(workspace_id,instructor_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,venue_id) REFERENCES ls_fishing_stage.venues(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_id,command_id) REFERENCES ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX fishing_resource_window ON ls_fishing_stage.resource_reservations(workspace_id,kind,resource_id,starts_at,ends_at) WHERE active;
-- Immutable joint request and once-only proposal allocation. These records
-- authorize no provider refund and do not change paid balances or enrollment.
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
-- Immutable financial REVIEW preparation only; not a dispatchable PAY operation.
CREATE TABLE ls_fishing_stage.refund_preparations (
 workspace_id uuid NOT NULL,id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('purchase','family')),
 household_id uuid NOT NULL,payer_account_id uuid NOT NULL,cancellation_id uuid,reservation_id uuid,
 state text NOT NULL CHECK(state='prepared_only'),review_sha256 text NOT NULL CHECK(review_sha256 ~ '^[a-f0-9]{64}$'),
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),total_refund_cents integer NOT NULL CHECK(total_refund_cents>0),
 actor_id uuid NOT NULL,command_id uuid NOT NULL,recorded_at timestamptz NOT NULL,
 payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 100000),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,actor_id,command_id),
 CHECK((kind='family')=(cancellation_id IS NOT NULL AND reservation_id IS NOT NULL)),
 CHECK(kind='family' OR (cancellation_id IS NULL AND reservation_id IS NULL)),
 FOREIGN KEY(workspace_id,household_id) REFERENCES ls_cases.families(workspace_id,id),
 FOREIGN KEY(workspace_id,payer_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,cancellation_id) REFERENCES ls_fishing_stage.refund_cancellations(workspace_id,id),
 FOREIGN KEY(workspace_id,reservation_id) REFERENCES ls_fishing_stage.refund_fee_reservations(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_id,command_id) REFERENCES ls_fishing_stage.command_receipts(workspace_id,actor_id,command_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE TABLE ls_fishing_stage.refund_preparation_members (
 workspace_id uuid NOT NULL,preparation_id uuid NOT NULL,purchase_id uuid NOT NULL,child_id uuid NOT NULL,
 provider_account_id text NOT NULL,livemode boolean NOT NULL,original_payment_id text NOT NULL CHECK(length(original_payment_id) BETWEEN 1 AND 160),
 refund_cents integer NOT NULL CHECK(refund_cents>0),
 PRIMARY KEY(workspace_id,purchase_id),UNIQUE(workspace_id,preparation_id,child_id),
 UNIQUE(workspace_id,provider_account_id,livemode,original_payment_id),
 FOREIGN KEY(workspace_id,preparation_id) REFERENCES ls_fishing_stage.refund_preparations(workspace_id,id),
 FOREIGN KEY(workspace_id,purchase_id) REFERENCES ls_fishing_payments.purchases(workspace_id,id),
 FOREIGN KEY(workspace_id,child_id) REFERENCES ls_identity.people(workspace_id,id)
);
CREATE FUNCTION ls_fishing_stage.reject_program_history_rewrite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'IMMUTABLE_PROGRAM_HISTORY'; END;
$$;
CREATE TRIGGER immutable_program_commands BEFORE UPDATE OR DELETE ON ls_fishing_stage.command_receipts FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.reject_program_history_rewrite();
CREATE TRIGGER immutable_program_sources BEFORE UPDATE OR DELETE ON ls_fishing_stage.source_approvals FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.reject_program_history_rewrite();
CREATE TRIGGER immutable_program_fit BEFORE UPDATE OR DELETE ON ls_fishing_stage.fit_decisions FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.reject_program_history_rewrite();
CREATE TRIGGER immutable_program_terms BEFORE UPDATE OR DELETE ON ls_fishing_stage.terms_acceptances FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.reject_program_history_rewrite();
CREATE TRIGGER immutable_program_block_terms BEFORE UPDATE OR DELETE ON ls_fishing_stage.block_acceptances FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.reject_program_history_rewrite();
CREATE TRIGGER immutable_program_offers BEFORE UPDATE OR DELETE ON ls_fishing_stage.offer_approvals FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.reject_program_history_rewrite();
CREATE TRIGGER immutable_refund_cancellations BEFORE UPDATE OR DELETE ON ls_fishing_stage.refund_cancellations FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.reject_program_history_rewrite();
CREATE TRIGGER immutable_refund_fee_reservations BEFORE UPDATE OR DELETE ON ls_fishing_stage.refund_fee_reservations FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.reject_program_history_rewrite();
CREATE TRIGGER immutable_refund_preparations BEFORE UPDATE OR DELETE ON ls_fishing_stage.refund_preparations FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.reject_program_history_rewrite();
CREATE TRIGGER immutable_refund_preparation_members BEFORE UPDATE OR DELETE ON ls_fishing_stage.refund_preparation_members FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.reject_program_history_rewrite();
-- The operation FK alone cannot distinguish a prior/different-stage operation.
-- Bind the intended NEXT source revision to its actual actor/operation at commit.
CREATE FUNCTION ls_fishing_stage.verify_program_stage_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.stage_operation_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM ls_fishing_stage.revisions r JOIN ls_fishing_stage.operations o
   ON o.workspace_id=r.workspace_id AND o.stage_id=r.stage_id AND o.stage_revision=r.revision
   AND o.actor_account_id=r.actor_account_id AND o.operation_id=r.operation_id AND o.state_sha256=r.state_sha256
  WHERE r.workspace_id=NEW.workspace_id AND r.stage_id=NEW.source_stage_id AND r.revision=NEW.expected_stage_revision
   AND r.actor_account_id=NEW.actor_id AND r.operation_id=NEW.stage_operation_id
 ) THEN RAISE EXCEPTION 'PROGRAM_STAGE_RECEIPT_MISMATCH'; END IF;
 RETURN NEW;
END;
$$;
CREATE CONSTRAINT TRIGGER exact_program_stage_receipt AFTER INSERT ON ls_fishing_stage.command_receipts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ls_fishing_stage.verify_program_stage_receipt();
