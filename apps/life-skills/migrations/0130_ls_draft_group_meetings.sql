-- Append-only owner planning for proposed draft-group occurrences. These rows
-- never confirm or reserve a meeting and have no provider or appointment effect.
CREATE TABLE ls_group_admin.draft_meeting_revisions (
 workspace_id uuid NOT NULL,
 id uuid NOT NULL,
 occurrence_id uuid NOT NULL,
 draft_group_id uuid NOT NULL,
 previous_revision_id uuid,
 state text NOT NULL CHECK(state='proposed'),
 time_zone text NOT NULL CHECK(time_zone='Asia/Jerusalem'),
 local_start text NOT NULL CHECK(local_start ~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$'),
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 15 AND 480),
 venue_ciphertext text NOT NULL CHECK(length(venue_ciphertext)>0),
 recorded_by uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,
 CONSTRAINT draft_meeting_revisions_pkey PRIMARY KEY(workspace_id,id),
 CONSTRAINT draft_meeting_revisions_identity_key UNIQUE(workspace_id,occurrence_id,id),
 CONSTRAINT draft_meeting_revisions_receipt_key UNIQUE(workspace_id,id,request_digest),
 CONSTRAINT draft_meeting_revisions_one_successor UNIQUE(workspace_id,previous_revision_id),
 CONSTRAINT draft_meeting_revisions_time_check CHECK(ends_at=starts_at+duration_minutes*interval '1 minute'),
 CONSTRAINT draft_meeting_revisions_root_check CHECK((previous_revision_id IS NULL)=(occurrence_id=id)),
 CONSTRAINT draft_meeting_revisions_group_fkey FOREIGN KEY(workspace_id,draft_group_id)
  REFERENCES ls_group_admin.draft_groups(workspace_id,id),
 CONSTRAINT draft_meeting_revisions_previous_fkey FOREIGN KEY(workspace_id,occurrence_id,previous_revision_id)
  REFERENCES ls_group_admin.draft_meeting_revisions(workspace_id,occurrence_id,id),
 CONSTRAINT draft_meeting_revisions_recorded_by_fkey FOREIGN KEY(workspace_id,recorded_by)
  REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE INDEX draft_meeting_revisions_group_history
 ON ls_group_admin.draft_meeting_revisions(workspace_id,draft_group_id,occurrence_id,created_at,id);

CREATE TABLE ls_group_admin.draft_meeting_operations (
 workspace_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 meeting_revision_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT draft_meeting_operations_pkey PRIMARY KEY(workspace_id,operation_id),
 CONSTRAINT draft_meeting_operations_revision_fkey FOREIGN KEY(workspace_id,meeting_revision_id,request_digest)
  REFERENCES ls_group_admin.draft_meeting_revisions(workspace_id,id,request_digest),
 CONSTRAINT draft_meeting_operations_recorded_by_fkey FOREIGN KEY(workspace_id,recorded_by)
  REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE TRIGGER draft_meeting_revisions_immutable BEFORE UPDATE OR DELETE
 ON ls_group_admin.draft_meeting_revisions FOR EACH ROW EXECUTE FUNCTION ls_group_admin.reject_mutation();
CREATE TRIGGER draft_meeting_operations_immutable BEFORE UPDATE OR DELETE
 ON ls_group_admin.draft_meeting_operations FOR EACH ROW EXECUTE FUNCTION ls_group_admin.reject_mutation();

REVOKE ALL ON ls_group_admin.draft_meeting_revisions FROM PUBLIC;
REVOKE ALL ON ls_group_admin.draft_meeting_operations FROM PUBLIC;
