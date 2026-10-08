-- Owner-only draft group planning. A proposal is not a trial, enrollment,
-- booking, accepted service, financial obligation or provider action.
CREATE SCHEMA ls_group_admin;
REVOKE ALL ON SCHEMA ls_group_admin FROM PUBLIC;

ALTER TABLE ls_service_interest.service_interests
 ADD CONSTRAINT service_interests_placement_identity_key
 UNIQUE(workspace_id,id,service_type,family_id,person_id);

CREATE TABLE ls_group_admin.draft_groups (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 id uuid NOT NULL,
 label_ciphertext text NOT NULL CHECK(length(label_ciphertext)>0),
 recorded_by uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,
 CONSTRAINT draft_groups_pkey PRIMARY KEY(workspace_id,id),
 CONSTRAINT draft_groups_receipt_key UNIQUE(workspace_id,id,request_digest),
 CONSTRAINT draft_groups_recorded_by_fkey FOREIGN KEY(workspace_id,recorded_by)
  REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE INDEX draft_groups_recent
 ON ls_group_admin.draft_groups(workspace_id,created_at DESC,id DESC);

CREATE TABLE ls_group_admin.draft_group_operations (
 workspace_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 draft_group_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT draft_group_operations_pkey PRIMARY KEY(workspace_id,operation_id),
 CONSTRAINT draft_group_operations_group_fkey
  FOREIGN KEY(workspace_id,draft_group_id,request_digest)
  REFERENCES ls_group_admin.draft_groups(workspace_id,id,request_digest),
 CONSTRAINT draft_group_operations_recorded_by_fkey FOREIGN KEY(workspace_id,recorded_by)
  REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE TABLE ls_group_admin.proposed_placements (
 workspace_id uuid NOT NULL,
 id uuid NOT NULL,
 draft_group_id uuid NOT NULL,
 service_interest_id uuid NOT NULL,
 service_type text NOT NULL CHECK(service_type='group'),
 family_id uuid NOT NULL,
 person_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,
 CONSTRAINT proposed_placements_pkey PRIMARY KEY(workspace_id,id),
 CONSTRAINT proposed_placements_exact_key UNIQUE(workspace_id,draft_group_id,service_interest_id),
 CONSTRAINT proposed_placements_receipt_key UNIQUE(workspace_id,id,request_digest),
 CONSTRAINT proposed_placements_group_fkey FOREIGN KEY(workspace_id,draft_group_id)
  REFERENCES ls_group_admin.draft_groups(workspace_id,id),
 CONSTRAINT proposed_placements_interest_fkey FOREIGN KEY(workspace_id,service_interest_id,service_type,family_id,person_id)
  REFERENCES ls_service_interest.service_interests(workspace_id,id,service_type,family_id,person_id),
 CONSTRAINT proposed_placements_recorded_by_fkey FOREIGN KEY(workspace_id,recorded_by)
  REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE INDEX proposed_placements_recent
 ON ls_group_admin.proposed_placements(workspace_id,draft_group_id,created_at DESC,id DESC);

CREATE TABLE ls_group_admin.proposed_placement_operations (
 workspace_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 proposed_placement_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT proposed_placement_operations_pkey PRIMARY KEY(workspace_id,operation_id),
 CONSTRAINT proposed_placement_operations_placement_fkey
  FOREIGN KEY(workspace_id,proposed_placement_id,request_digest)
  REFERENCES ls_group_admin.proposed_placements(workspace_id,id,request_digest),
 CONSTRAINT proposed_placement_operations_recorded_by_fkey FOREIGN KEY(workspace_id,recorded_by)
  REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE FUNCTION ls_group_admin.reject_mutation() RETURNS trigger
 LANGUAGE plpgsql AS $fn$
BEGIN
 RAISE EXCEPTION 'GROUP_PLANNING_PROVENANCE_IMMUTABLE' USING ERRCODE='23514';
END;
$fn$;

CREATE TRIGGER draft_groups_immutable BEFORE UPDATE OR DELETE
 ON ls_group_admin.draft_groups FOR EACH ROW EXECUTE FUNCTION ls_group_admin.reject_mutation();
CREATE TRIGGER draft_group_operations_immutable BEFORE UPDATE OR DELETE
 ON ls_group_admin.draft_group_operations FOR EACH ROW EXECUTE FUNCTION ls_group_admin.reject_mutation();
CREATE TRIGGER proposed_placements_immutable BEFORE UPDATE OR DELETE
 ON ls_group_admin.proposed_placements FOR EACH ROW EXECUTE FUNCTION ls_group_admin.reject_mutation();
CREATE TRIGGER proposed_placement_operations_immutable BEFORE UPDATE OR DELETE
 ON ls_group_admin.proposed_placement_operations FOR EACH ROW EXECUTE FUNCTION ls_group_admin.reject_mutation();

REVOKE ALL ON ALL TABLES IN SCHEMA ls_group_admin FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_group_admin.reject_mutation() FROM PUBLIC;
