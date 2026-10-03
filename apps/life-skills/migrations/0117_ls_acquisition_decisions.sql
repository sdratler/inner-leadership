-- Owner decisions are distinct from immutable provider metadata. This migration
-- neither changes authority nor calls/queues an external provider.
CREATE TABLE ls_contact_ops.lead_promotion_operations (
 workspace_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 candidate_id uuid NOT NULL,
 actor_account_id uuid NOT NULL,
 authority_epoch bigint NOT NULL CHECK(authority_epoch>=0),
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN ('PROMOTED','MATCHED','NOT_A_LEAD')),
 person_id uuid,
 result_ciphertext text NOT NULL CHECK(length(result_ciphertext)>0),
 provenance text NOT NULL DEFAULT 'owner_ui' CHECK(provenance='owner_ui'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,operation_id),
 UNIQUE(workspace_id,candidate_id),
 FOREIGN KEY(workspace_id,candidate_id) REFERENCES ls_contact_ops.inbound_activity_candidates(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_contact_ops.profiles(workspace_id,person_id),
 CHECK((state='NOT_A_LEAD')=(person_id IS NULL))
);
CREATE TABLE ls_contact_ops.acquisition_projection_status (
 workspace_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 channel text NOT NULL CHECK(channel IN ('google_contacts','whatsapp')),
 state text NOT NULL CHECK(state IN ('applied','no_chat','pending','failed')),
 reason text NOT NULL CHECK(reason IN ('provider_not_verified','provider_applied','no_chat','provider_failed')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,operation_id,channel),
 FOREIGN KEY(workspace_id,operation_id) REFERENCES ls_contact_ops.lead_promotion_operations(workspace_id,operation_id),
 CHECK((state='applied')=(reason='provider_applied')),
 CHECK((state='no_chat')=(reason='no_chat')),
 CHECK((state='failed')=(reason='provider_failed')),
 CHECK((state='pending')=(reason='provider_not_verified'))
);
CREATE TRIGGER acquisition_decisions_no_edit BEFORE UPDATE OR DELETE ON ls_contact_ops.lead_promotion_operations
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
CREATE TRIGGER acquisition_decisions_no_truncate BEFORE TRUNCATE ON ls_contact_ops.lead_promotion_operations
 FOR EACH STATEMENT EXECUTE FUNCTION ls_contact_ops.deny_acquisition_receipt_mutation();
REVOKE ALL ON ls_contact_ops.lead_promotion_operations,ls_contact_ops.acquisition_projection_status FROM PUBLIC;
