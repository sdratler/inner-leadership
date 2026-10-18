-- ROOT-OWNED UNNUMBERED CANDIDATE ONLY. Not registered, executed or admitted.
-- Requires the actual identity/stage native baseline in an isolated future test.
-- No grants, provider outbox, new calendar, seat write or production migration.
CREATE TABLE ls_fishing_stage.academy_session_policy_evidence (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 id uuid NOT NULL,
 learner_id uuid NOT NULL,
 original_occurrence_id uuid NOT NULL,
 source_evidence_id text NOT NULL CHECK(length(source_evidence_id) BETWEEN 1 AND 120),
 source_revision integer NOT NULL CHECK(source_revision > 0),
 evidence_sha256 text NOT NULL CHECK(evidence_sha256 ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 65536),
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,learner_id,original_occurrence_id,source_evidence_id,source_revision),
 FOREIGN KEY(workspace_id,original_occurrence_id) REFERENCES ls_fishing_stage.occurrences(workspace_id,id)
);
CREATE TABLE ls_fishing_stage.academy_session_credits (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 id uuid NOT NULL,
 learner_id uuid NOT NULL,
 cohort_id uuid NOT NULL,
 stage_id uuid NOT NULL,
 original_occurrence_id uuid NOT NULL,
 original_ordinal smallint NOT NULL CHECK(original_ordinal BETWEEN 1 AND 12),
 module_id text NOT NULL CHECK(length(module_id) BETWEEN 1 AND 120),
 module_version text NOT NULL CHECK(length(module_version) BETWEEN 1 AND 120),
 activity_id text NOT NULL CHECK(length(activity_id) BETWEEN 1 AND 120),
 enrollment_id uuid NOT NULL,
 purchase_id uuid NOT NULL,
 purchase_line_id text NOT NULL CHECK(length(purchase_line_id) BETWEEN 1 AND 120),
 state text NOT NULL CHECK(state IN ('outstanding','replacement_reserved','delivered')),
 replacement_reservation_id uuid,
 first_evidence_id uuid NOT NULL,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,learner_id,original_occurrence_id),
 CHECK(state <> 'replacement_reserved' OR replacement_reservation_id IS NOT NULL),
 FOREIGN KEY(workspace_id,original_occurrence_id) REFERENCES ls_fishing_stage.occurrences(workspace_id,id),
 FOREIGN KEY(workspace_id,stage_id) REFERENCES ls_fishing_stage.plans(workspace_id,stage_id),
 FOREIGN KEY(workspace_id,first_evidence_id) REFERENCES ls_fishing_stage.academy_session_policy_evidence(workspace_id,id)
);
-- An append-only command receipt/event: the implementation never UPDATEs or
-- DELETEs this table. Reauthorize BEFORE replay lookup; differing request digest
-- on the same actor/operation is a conflict. No browser facts enter this payload.
CREATE TABLE ls_fishing_stage.academy_session_credit_events (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 actor_account_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 request_sha256 text NOT NULL CHECK(request_sha256 ~ '^[a-f0-9]{64}$'),
 evidence_id uuid NOT NULL,
 credit_id uuid,
 outcome text NOT NULL CHECK(outcome IN ('issued','retained','no_credit','facts_required')),
 receipt_ciphertext text NOT NULL CHECK(octet_length(receipt_ciphertext) BETWEEN 1 AND 65536),
 recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,actor_account_id,operation_id),
 FOREIGN KEY(workspace_id,evidence_id) REFERENCES ls_fishing_stage.academy_session_policy_evidence(workspace_id,id),
 FOREIGN KEY(workspace_id,credit_id) REFERENCES ls_fishing_stage.academy_session_credits(workspace_id,id)
);
-- Full nine-field original anchor, selected learner/guardian, cohort/module,
-- purchase-line/delivery and source-evidence relationships are revalidated by
-- Root's REQUIRED authority in the SAME locked transaction before these rows.
-- Existing unambiguous entitlement IDs are retained; conflicts fail closed.
-- SQL uniqueness prevents a second credit after a retry or process restart.
-- Reservation is NOT delivery. This candidate contains no booking transition.
