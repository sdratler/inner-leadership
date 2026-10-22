-- UNNUMBERED PROPOSAL ONLY. NOT REGISTERED, EXECUTED OR PRODUCTION-ADMITTED.
-- MAIN must reconcile identity/enrollment/resource bindings, migration ordering,
-- table privileges, AEAD key scope and real-service access before any application.
-- No independent calendar engine, enrollment, payment ledger or provider outbox.
CREATE SCHEMA IF NOT EXISTS ls_fishing_stage;

CREATE TABLE ls_fishing_stage.plans (
 workspace_id uuid NOT NULL,
 stage_id uuid NOT NULL,
 cohort_id uuid NOT NULL,
 stage smallint NOT NULL CHECK(stage BETWEEN 1 AND 4),
 template_version text NOT NULL CHECK(length(template_version) BETWEEN 1 AND 120),
 revision integer NOT NULL CHECK(revision BETWEEN 1 AND 1000),
 state_sha256 text NOT NULL CHECK(state_sha256 ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 2000000),
 PRIMARY KEY(workspace_id,stage_id),
 UNIQUE(workspace_id,cohort_id,stage),
 UNIQUE(workspace_id,stage_id,cohort_id,stage,template_version)
);
-- One ordinal header per canonical group occurrence; no per-child date copies.
-- Adapter inserts/validates all twelve headers and encrypted aggregate atomically.
CREATE TABLE ls_fishing_stage.occurrences (
 workspace_id uuid NOT NULL,
 id uuid NOT NULL,
 stage_id uuid NOT NULL,
 cohort_id uuid NOT NULL,
 stage smallint NOT NULL,
 template_version text NOT NULL,
 ordinal smallint NOT NULL CHECK(ordinal BETWEEN 1 AND 12),
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,cohort_id,stage,template_version,ordinal),
 FOREIGN KEY(workspace_id,stage_id,cohort_id,stage,template_version)
  REFERENCES ls_fishing_stage.plans(workspace_id,stage_id,cohort_id,stage,template_version)
);
CREATE TABLE ls_fishing_stage.revisions (
 workspace_id uuid NOT NULL,
 stage_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision BETWEEN 1 AND 1000),
 recorded_at timestamptz NOT NULL,
 actor_account_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 previous_state_sha256 text CHECK(previous_state_sha256 ~ '^[a-f0-9]{64}$'),
 state_sha256 text NOT NULL CHECK(state_sha256 ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(octet_length(payload_ciphertext) BETWEEN 1 AND 2000000),
 CHECK((revision=1) = (previous_state_sha256 IS NULL)),
 PRIMARY KEY(workspace_id,stage_id,revision),
 UNIQUE(workspace_id,actor_account_id,operation_id),
 UNIQUE(workspace_id,stage_id,revision,actor_account_id,operation_id,state_sha256),
 FOREIGN KEY(workspace_id,stage_id) REFERENCES ls_fishing_stage.plans(workspace_id,stage_id)
);
CREATE TABLE ls_fishing_stage.operations (
 workspace_id uuid NOT NULL,
 actor_account_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 stage_id uuid NOT NULL,
 stage_revision integer NOT NULL CHECK(stage_revision BETWEEN 1 AND 1000),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 state_sha256 text NOT NULL CHECK(state_sha256 ~ '^[a-f0-9]{64}$'),
 receipt_ciphertext text NOT NULL CHECK(octet_length(receipt_ciphertext) BETWEEN 1 AND 20000),
 PRIMARY KEY(workspace_id,actor_account_id,operation_id),
 FOREIGN KEY(workspace_id,stage_id) REFERENCES ls_fishing_stage.plans(workspace_id,stage_id),
 FOREIGN KEY(workspace_id,stage_id,stage_revision,actor_account_id,operation_id,state_sha256)
  REFERENCES ls_fishing_stage.revisions(workspace_id,stage_id,revision,actor_account_id,operation_id,state_sha256)
);
-- Links only. Capacity must be reserved atomically in the MAIN-owned admitted
-- shared seat ledger, including original enrollments, offer holds and makeups.
-- This table must NEVER be used alone to calculate remaining capacity.
CREATE TABLE ls_fishing_stage.makeup_links (
 workspace_id uuid NOT NULL,
 source_stage_id uuid NOT NULL,
 entitlement_id uuid NOT NULL,
 enrollment_id uuid NOT NULL,
 learner_id uuid NOT NULL,
 occurrence_id uuid NOT NULL,
 reservation_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,entitlement_id),
 UNIQUE(workspace_id,enrollment_id,occurrence_id),
 UNIQUE(workspace_id,learner_id,occurrence_id),
 UNIQUE(workspace_id,reservation_id),
 FOREIGN KEY(workspace_id,occurrence_id) REFERENCES ls_fishing_stage.occurrences(workspace_id,id),
 FOREIGN KEY(workspace_id,source_stage_id) REFERENCES ls_fishing_stage.plans(workspace_id,stage_id)
);
-- MAIN adds actual workspace/account/enrollment/reservation foreign keys only
-- after their frozen physical owners are reconciled. No grants are issued here.
-- Writes: lock stage + shared resource/seat keys in stable order, reload current
-- actor/relationships, compare expected revision, then update plan/headers and
-- append revision/operation/link in ONE transaction. No UPDATE of prior revisions.
-- Rollback a failed receipt/state commit together with every resource/seat effect.
-- Ciphertext columns contain bounded AEAD part envelopes; plaintext/current
-- snapshots are capped at 1 MiB and reuse the unchanged 64 KiB identity seal.
-- MAIN must restrict revision/operation rows to append-only application access.
