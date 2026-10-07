/**
 * Additive candidate awaiting final migration-number allocation after the
 * retained 0124/0125 integration chain. Tests apply this only to a disposable
 * loopback database; release migration registration is intentionally absent.
 */
export const audienceInterestCandidateSql=`
CREATE TABLE IF NOT EXISTS ls_contact_ops.audience_profiles (
 workspace_id uuid NOT NULL,
 person_id uuid NOT NULL,
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 record_mode text NOT NULL CHECK(record_mode='live'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,person_id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_identity.people(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_contact_ops.audience_interests (
 workspace_id uuid NOT NULL,
 person_id uuid NOT NULL,
 topic text NOT NULL CHECK(topic='bna_content'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 actor_account_id uuid NOT NULL,
 observed_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,person_id,topic),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_contact_ops.audience_profiles(workspace_id,person_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_contact_ops.audience_observations (
 workspace_id uuid NOT NULL,
 observation_id uuid NOT NULL,
 person_id uuid NOT NULL,
 topic text NOT NULL CHECK(topic='bna_content'),
 source_digest text NOT NULL CHECK(source_digest ~ '^[a-f0-9]{64}$'),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 actor_account_id uuid NOT NULL,
 observed_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,observation_id),
 UNIQUE(workspace_id,person_id,topic,source_digest),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_contact_ops.audience_profiles(workspace_id,person_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE IF NOT EXISTS ls_contact_ops.audience_operation_receipts (
 workspace_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 person_id uuid NOT NULL,
 actor_account_id uuid NOT NULL,
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 result_version integer NOT NULL CHECK(result_version>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_contact_ops.audience_profiles(workspace_id,person_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
REVOKE ALL ON ls_contact_ops.audience_profiles,ls_contact_ops.audience_interests,
 ls_contact_ops.audience_observations,ls_contact_ops.audience_operation_receipts FROM PUBLIC;
`;
