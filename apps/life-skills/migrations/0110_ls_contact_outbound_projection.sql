-- Additive administrative send ledger. A prepared row is committed before an
-- external send, so a lost response cannot erase the requested CRM projection.
-- Encrypted fields and receipts are private to the existing Life Skills DB.
CREATE TABLE ls_contact_ops.outbound_projections (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 operation_id uuid NOT NULL,
 actor_account_id uuid NOT NULL,
 legacy_lead_id text NOT NULL CHECK(legacy_lead_id ~ '^LS-(LEAD|WAPI)-[A-Za-z0-9_-]+$'),
 authority_epoch integer NOT NULL CHECK(authority_epoch>=0),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 projection_ciphertext text NOT NULL CHECK(length(projection_ciphertext)>0),
 receipt_ciphertext text,
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','sent_pending','projected')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK((state='prepared' AND receipt_ciphertext IS NULL) OR
       (state IN ('sent_pending','projected') AND receipt_ciphertext IS NOT NULL AND length(receipt_ciphertext)>0))
);
CREATE INDEX outbound_projections_pending ON ls_contact_ops.outbound_projections(workspace_id,state,created_at)
 WHERE state<>'projected';
REVOKE ALL ON ls_contact_ops.outbound_projections FROM PUBLIC;
