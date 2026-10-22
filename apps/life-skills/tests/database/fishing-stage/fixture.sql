-- SYNTHETIC SHARED-PORT TABLES ONLY. MAIN applies this separately on the exact
-- registered disposable target. No application migration or real authority.
-- The native store under test is the real NativeFishingStageStore.
CREATE TABLE ls_fishing_stage.fixture_contexts (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 stage_id uuid NOT NULL, cohort_id uuid NOT NULL, stage integer NOT NULL,
 instructor_id uuid NOT NULL, child_capacity integer NOT NULL,
 resource_approved boolean NOT NULL, PRIMARY KEY(workspace_id,stage_id)
);
CREATE TABLE ls_fishing_stage.fixture_templates (
 workspace_id uuid NOT NULL, stage integer NOT NULL, version text NOT NULL,
 payload jsonb NOT NULL, active boolean NOT NULL,
 PRIMARY KEY(workspace_id,stage,version)
);
CREATE TABLE ls_fishing_stage.fixture_enrollments (
 workspace_id uuid NOT NULL, id uuid NOT NULL, learner_id uuid NOT NULL,
 stage_id uuid NOT NULL, payload jsonb NOT NULL, active boolean NOT NULL,
 child_enabled boolean NOT NULL, PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,learner_id) REFERENCES ls_identity.people(workspace_id,id)
);
CREATE TABLE ls_fishing_stage.fixture_guardians (
 workspace_id uuid NOT NULL, learner_id uuid NOT NULL, account_id uuid NOT NULL,
 active boolean NOT NULL, PRIMARY KEY(workspace_id,learner_id,account_id)
);
CREATE TABLE ls_fishing_stage.fixture_capacity (
 workspace_id uuid NOT NULL, occurrence_id uuid NOT NULL, included_places integer NOT NULL,
 suitable boolean NOT NULL, PRIMARY KEY(workspace_id,occurrence_id)
);
CREATE TABLE ls_fishing_stage.fixture_resource_effects (
 workspace_id uuid NOT NULL, occurrence_id uuid NOT NULL, payload jsonb NOT NULL,
 PRIMARY KEY(workspace_id,occurrence_id)
);
-- Deliberately no learner/target uniqueness here: the owned native makeup_links
-- constraint and adapter must enforce it even if this synthetic hook does not.
CREATE TABLE ls_fishing_stage.fixture_seat_effects (
 workspace_id uuid NOT NULL, id uuid NOT NULL, learner_id uuid NOT NULL,
 occurrence_id uuid NOT NULL, entitlement_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,id)
);
