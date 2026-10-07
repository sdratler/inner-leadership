-- LS-ACQ-CRM-20261002-01. Minimal, immutable call metadata reuses encrypted
-- acquisition receipts. A link is administrative routing, NOT a lead, clinical
-- record, identity grant, consent, payment, booking or external provider action.
CREATE TABLE ls_contact_ops.call_activity_links (
 workspace_id uuid NOT NULL,
 candidate_id uuid NOT NULL,
 person_id uuid NOT NULL,
 linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,candidate_id),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES ls_contact_ops.inbound_activity_candidates(workspace_id,id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_identity.people(workspace_id,id)
);
CREATE INDEX call_activity_by_person ON ls_contact_ops.call_activity_links(workspace_id,person_id,candidate_id);
CREATE TRIGGER call_activity_no_edit BEFORE UPDATE OR DELETE ON ls_contact_ops.call_activity_links
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
CREATE TRIGGER call_activity_no_truncate BEFORE TRUNCATE ON ls_contact_ops.call_activity_links
 FOR EACH STATEMENT EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
REVOKE ALL ON ls_contact_ops.call_activity_links FROM PUBLIC;
