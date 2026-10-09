-- Append-only owner planning history for moving a current proposal to a new,
-- previously unused draft group. A move is not a trial, enrollment, booking,
-- accepted service, financial obligation, message or provider action.
ALTER TABLE ls_group_admin.proposed_placements
 ADD CONSTRAINT proposed_placements_movement_identity_key
 UNIQUE(workspace_id,id,draft_group_id,service_interest_id,service_type,family_id,person_id);

CREATE TABLE ls_group_admin.proposed_placement_moves (
 workspace_id uuid NOT NULL,
 id uuid NOT NULL,
 source_proposed_placement_id uuid NOT NULL,
 destination_proposed_placement_id uuid NOT NULL,
 source_draft_group_id uuid NOT NULL,
 destination_draft_group_id uuid NOT NULL,
 service_interest_id uuid NOT NULL,
 service_type text NOT NULL CHECK(service_type='group'),
 family_id uuid NOT NULL,
 person_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,
 CONSTRAINT proposed_placement_moves_pkey PRIMARY KEY(workspace_id,id),
 CONSTRAINT proposed_placement_moves_source_key UNIQUE(workspace_id,source_proposed_placement_id),
 CONSTRAINT proposed_placement_moves_destination_key UNIQUE(workspace_id,destination_proposed_placement_id),
 CONSTRAINT proposed_placement_moves_receipt_key UNIQUE(workspace_id,id,request_digest),
 CONSTRAINT proposed_placement_moves_different_proposal_check
  CHECK(source_proposed_placement_id<>destination_proposed_placement_id),
 CONSTRAINT proposed_placement_moves_different_group_check
  CHECK(source_draft_group_id<>destination_draft_group_id),
 CONSTRAINT proposed_placement_moves_source_fkey FOREIGN KEY
  (workspace_id,source_proposed_placement_id,source_draft_group_id,service_interest_id,service_type,family_id,person_id)
  REFERENCES ls_group_admin.proposed_placements
  (workspace_id,id,draft_group_id,service_interest_id,service_type,family_id,person_id),
 CONSTRAINT proposed_placement_moves_destination_fkey FOREIGN KEY
  (workspace_id,destination_proposed_placement_id,destination_draft_group_id,service_interest_id,service_type,family_id,person_id)
  REFERENCES ls_group_admin.proposed_placements
  (workspace_id,id,draft_group_id,service_interest_id,service_type,family_id,person_id),
 CONSTRAINT proposed_placement_moves_recorded_by_fkey FOREIGN KEY(workspace_id,recorded_by)
  REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE INDEX proposed_placement_moves_history
 ON ls_group_admin.proposed_placement_moves(workspace_id,service_interest_id,created_at,id);

CREATE TABLE ls_group_admin.proposed_placement_move_operations (
 workspace_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 proposed_placement_move_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT proposed_placement_move_operations_pkey PRIMARY KEY(workspace_id,operation_id),
 CONSTRAINT proposed_placement_move_operations_move_fkey
  FOREIGN KEY(workspace_id,proposed_placement_move_id,request_digest)
  REFERENCES ls_group_admin.proposed_placement_moves(workspace_id,id,request_digest),
 CONSTRAINT proposed_placement_move_operations_recorded_by_fkey FOREIGN KEY(workspace_id,recorded_by)
  REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE TRIGGER proposed_placement_moves_immutable BEFORE UPDATE OR DELETE
 ON ls_group_admin.proposed_placement_moves FOR EACH ROW EXECUTE FUNCTION ls_group_admin.reject_mutation();
CREATE TRIGGER proposed_placement_move_operations_immutable BEFORE UPDATE OR DELETE
 ON ls_group_admin.proposed_placement_move_operations FOR EACH ROW EXECUTE FUNCTION ls_group_admin.reject_mutation();

REVOKE ALL ON ls_group_admin.proposed_placement_moves FROM PUBLIC;
REVOKE ALL ON ls_group_admin.proposed_placement_move_operations FROM PUBLIC;
