-- Direct public group applications remain private, encrypted owner-review records.
-- They do not create People, leads, cases, enrollments, bookings, payments or messages.
CREATE TABLE ls_service_interest.public_applications (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 id uuid NOT NULL,
 contact_digest text NOT NULL CHECK(contact_digest ~ '^[a-f0-9]{64}$'),
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 notice_version text NOT NULL CHECK(length(notice_version) BETWEEN 1 AND 100),
 notice_language text NOT NULL CHECK(notice_language IN ('he','en')),
 received_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,request_digest),
 UNIQUE(workspace_id,id,request_digest)
);
CREATE INDEX public_group_application_recent ON ls_service_interest.public_applications(workspace_id,received_at DESC,id DESC);
CREATE INDEX public_group_application_contact_recent ON ls_service_interest.public_applications(workspace_id,contact_digest,received_at DESC);

CREATE TABLE ls_service_interest.public_application_operations (
 workspace_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 application_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,application_id,request_digest)
  REFERENCES ls_service_interest.public_applications(workspace_id,id,request_digest)
);

CREATE FUNCTION ls_service_interest.reject_public_application_mutation() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'public_group_application_append_only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER public_group_application_immutable BEFORE UPDATE OR DELETE ON ls_service_interest.public_applications
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
CREATE TRIGGER public_group_application_operation_immutable BEFORE UPDATE OR DELETE ON ls_service_interest.public_application_operations
 FOR EACH ROW EXECUTE FUNCTION ls_service_interest.reject_public_application_mutation();
REVOKE ALL ON ls_service_interest.public_applications,ls_service_interest.public_application_operations FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_service_interest.reject_public_application_mutation() FROM PUBLIC;
