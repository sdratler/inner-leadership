-- Owner-only practical-learning evidence for the Fishing planning draft.
-- Evidence never confirms enrollment, attendance, trip authorization or payment.
ALTER TABLE ls_group_admin.proposed_placements
 ADD CONSTRAINT proposed_placements_fishing_practice_identity_key
 UNIQUE(workspace_id,id,draft_group_id);

CREATE TABLE ls_group_admin.fishing_practice_revisions (
 workspace_id uuid NOT NULL,
 id uuid NOT NULL,
 draft_group_id uuid NOT NULL,
 proposed_placement_id uuid NOT NULL,
 program_key text NOT NULL CHECK(program_key='fishing_lessons'),
 module_key text NOT NULL CHECK(module_key IN ('knots','rod_rigging','terminal_tackle','field_casting','fish_fighting','equipment_selection')),
 evidence_state text NOT NULL CHECK(evidence_state IN ('practice_observed','no_evidence_yet')),
 note_ciphertext text NOT NULL CHECK(length(note_ciphertext)>0),
 previous_revision_id uuid,
 recorded_by uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,
 CONSTRAINT fishing_practice_revisions_pkey PRIMARY KEY(workspace_id,id),
 CONSTRAINT fishing_practice_revisions_identity_key UNIQUE(workspace_id,id,draft_group_id,proposed_placement_id,module_key),
 CONSTRAINT fishing_practice_revisions_receipt_key UNIQUE(workspace_id,id,request_digest),
 CONSTRAINT fishing_practice_revisions_one_successor UNIQUE(workspace_id,previous_revision_id),
 CONSTRAINT fishing_practice_revisions_placement_fkey
  FOREIGN KEY(workspace_id,proposed_placement_id,draft_group_id)
  REFERENCES ls_group_admin.proposed_placements(workspace_id,id,draft_group_id),
 CONSTRAINT fishing_practice_revisions_previous_fkey
  FOREIGN KEY(workspace_id,previous_revision_id,draft_group_id,proposed_placement_id,module_key)
  REFERENCES ls_group_admin.fishing_practice_revisions(workspace_id,id,draft_group_id,proposed_placement_id,module_key),
 CONSTRAINT fishing_practice_revisions_recorded_by_fkey FOREIGN KEY(workspace_id,recorded_by)
  REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE UNIQUE INDEX fishing_practice_revisions_one_root
 ON ls_group_admin.fishing_practice_revisions(workspace_id,proposed_placement_id,module_key)
 WHERE previous_revision_id IS NULL;
CREATE INDEX fishing_practice_revisions_history
 ON ls_group_admin.fishing_practice_revisions(workspace_id,draft_group_id,proposed_placement_id,module_key,created_at,id);

CREATE TABLE ls_group_admin.fishing_practice_operations (
 workspace_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 practice_revision_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT fishing_practice_operations_pkey PRIMARY KEY(workspace_id,operation_id),
 CONSTRAINT fishing_practice_operations_revision_fkey
  FOREIGN KEY(workspace_id,practice_revision_id,request_digest)
  REFERENCES ls_group_admin.fishing_practice_revisions(workspace_id,id,request_digest),
 CONSTRAINT fishing_practice_operations_recorded_by_fkey FOREIGN KEY(workspace_id,recorded_by)
  REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE TRIGGER fishing_practice_revisions_immutable BEFORE UPDATE OR DELETE
 ON ls_group_admin.fishing_practice_revisions FOR EACH ROW EXECUTE FUNCTION ls_group_admin.reject_mutation();
CREATE TRIGGER fishing_practice_operations_immutable BEFORE UPDATE OR DELETE
 ON ls_group_admin.fishing_practice_operations FOR EACH ROW EXECUTE FUNCTION ls_group_admin.reject_mutation();

REVOKE ALL ON ls_group_admin.fishing_practice_revisions FROM PUBLIC;
REVOKE ALL ON ls_group_admin.fishing_practice_operations FROM PUBLIC;
