-- Owner-entered administrative interest only. This does not create a contact,
-- case, enrollment, payment, provider message or clinical record.
CREATE SCHEMA ls_service_interest;
REVOKE ALL ON SCHEMA ls_service_interest FROM PUBLIC;

CREATE TABLE ls_service_interest.inquiries (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,request_digest),
 UNIQUE(workspace_id,id,request_digest),
 FOREIGN KEY(workspace_id,recorded_by) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX group_interest_recent ON ls_service_interest.inquiries(workspace_id,created_at DESC,id DESC);

CREATE TABLE ls_service_interest.operations (
 workspace_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 inquiry_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,inquiry_id,request_digest) REFERENCES ls_service_interest.inquiries(workspace_id,id,request_digest),
 FOREIGN KEY(workspace_id,recorded_by) REFERENCES ls_identity.accounts(workspace_id,id)
);

REVOKE ALL ON ALL TABLES IN SCHEMA ls_service_interest FROM PUBLIC;
