-- Owner-only administrative service interests. An interest is not placement,
-- enrollment, terms acceptance, booking, billing, access or a provider action.
ALTER TABLE ls_cases.family_members
 ADD CONSTRAINT family_members_service_interest_identity_key
 UNIQUE(workspace_id,family_id,person_id,role);

ALTER TABLE ls_identity.people
 ADD CONSTRAINT people_service_interest_kind_key
 UNIQUE(workspace_id,id,kind);

CREATE TABLE ls_service_interest.service_interests (
 workspace_id uuid NOT NULL,
 id uuid NOT NULL,
 family_id uuid NOT NULL,
 person_id uuid NOT NULL,
 member_role text NOT NULL CHECK(member_role='child'),
 person_kind text NOT NULL CHECK(person_kind='minor'),
 service_type text NOT NULL CHECK(service_type IN ('group','tutoring')),
 source_inquiry_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL,
 CONSTRAINT service_interests_pkey PRIMARY KEY(workspace_id,id),
 CONSTRAINT service_interests_identity_key UNIQUE(workspace_id,source_inquiry_id,family_id,person_id,service_type),
 CONSTRAINT service_interests_receipt_key UNIQUE(workspace_id,id,request_digest),
 CONSTRAINT service_interests_family_member_fkey FOREIGN KEY(workspace_id,family_id,person_id,member_role)
  REFERENCES ls_cases.family_members(workspace_id,family_id,person_id,role),
 CONSTRAINT service_interests_person_kind_fkey FOREIGN KEY(workspace_id,person_id,person_kind)
  REFERENCES ls_identity.people(workspace_id,id,kind),
 CONSTRAINT service_interests_source_inquiry_fkey FOREIGN KEY(workspace_id,source_inquiry_id)
  REFERENCES ls_service_interest.inquiries(workspace_id,id),
 CONSTRAINT service_interests_recorded_by_fkey FOREIGN KEY(workspace_id,recorded_by)
  REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE INDEX service_interests_recent
 ON ls_service_interest.service_interests(workspace_id,created_at DESC,id DESC);

CREATE TABLE ls_service_interest.service_interest_operations (
 workspace_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 recorded_by uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^[a-f0-9]{64}$'),
 service_interest_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CONSTRAINT service_interest_operations_pkey PRIMARY KEY(workspace_id,operation_id),
 CONSTRAINT service_interest_operations_interest_fkey
  FOREIGN KEY(workspace_id,service_interest_id,request_digest)
  REFERENCES ls_service_interest.service_interests(workspace_id,id,request_digest),
 CONSTRAINT service_interest_operations_recorded_by_fkey FOREIGN KEY(workspace_id,recorded_by)
  REFERENCES ls_identity.accounts(workspace_id,id)
);

CREATE FUNCTION ls_service_interest.check_service_interest_child() RETURNS trigger
 LANGUAGE plpgsql AS $fn$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM ls_cases.family_members fm
  JOIN ls_identity.people p ON p.workspace_id=fm.workspace_id AND p.id=fm.person_id
  WHERE fm.workspace_id=NEW.workspace_id AND fm.family_id=NEW.family_id
   AND fm.person_id=NEW.person_id AND fm.role='child' AND p.kind='minor'
 ) THEN
  RAISE EXCEPTION 'SERVICE_INTEREST_VERIFIED_CHILD_REQUIRED' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;

CREATE TRIGGER service_interests_verified_child BEFORE INSERT
 ON ls_service_interest.service_interests FOR EACH ROW
 EXECUTE FUNCTION ls_service_interest.check_service_interest_child();

CREATE FUNCTION ls_service_interest.reject_service_interest_mutation() RETURNS trigger
 LANGUAGE plpgsql AS $fn$
BEGIN
 RAISE EXCEPTION 'SERVICE_INTEREST_PROVENANCE_IMMUTABLE' USING ERRCODE='23514';
END;
$fn$;

CREATE TRIGGER service_interests_immutable BEFORE UPDATE OR DELETE
 ON ls_service_interest.service_interests FOR EACH ROW
 EXECUTE FUNCTION ls_service_interest.reject_service_interest_mutation();

CREATE TRIGGER service_interest_operations_immutable BEFORE UPDATE OR DELETE
 ON ls_service_interest.service_interest_operations FOR EACH ROW
 EXECUTE FUNCTION ls_service_interest.reject_service_interest_mutation();

REVOKE ALL ON TABLE ls_service_interest.service_interests FROM PUBLIC;
REVOKE ALL ON TABLE ls_service_interest.service_interest_operations FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_service_interest.check_service_interest_child() FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_service_interest.reject_service_interest_mutation() FROM PUBLIC;
