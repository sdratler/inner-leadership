-- Administrative acknowledgments only; existing public inquiries remain immutable.
-- An unknown reservation is terminal for automatic dispatch, including crashes.
CREATE TABLE ls_service_interest.inquiry_email_outbox (
 workspace_id uuid NOT NULL,
 id uuid NOT NULL,
 application_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose='academy_inquiry_acknowledgment_v1'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','unknown','sent','canceled')),
 created_at timestamptz NOT NULL,
 reserved_at timestamptz,
 completed_at timestamptz,
 reconciled_by uuid REFERENCES ls_identity.accounts(id),
 provider_id text CHECK(provider_id IS NULL OR (length(provider_id) BETWEEN 1 AND 256 AND provider_id ~ '^[A-Za-z0-9_-]+$')),
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,application_id),
 FOREIGN KEY(workspace_id,application_id) REFERENCES ls_service_interest.public_applications(workspace_id,id),
 CHECK((state='queued' AND reserved_at IS NULL AND completed_at IS NULL AND provider_id IS NULL)
  OR (state='unknown' AND reserved_at IS NOT NULL AND completed_at IS NULL AND provider_id IS NULL)
  OR (state='sent' AND reserved_at IS NOT NULL AND completed_at IS NOT NULL AND provider_id IS NOT NULL)
  OR (state='canceled' AND completed_at IS NOT NULL AND provider_id IS NULL))
);
REVOKE ALL ON ls_service_interest.inquiry_email_outbox FROM PUBLIC;
