-- LOCAL PROPOSAL ONLY. Root owns numbering, manifest, review and application.
-- Inquiry mailbox control only: no account, legal guardian or financial grant.
-- Existing append-only inquiry rows and historical ACK payloads stay unchanged.
CREATE TABLE ls_service_interest.inquiry_email_control_verifications (
 workspace_id uuid NOT NULL,
 id uuid NOT NULL,
 application_id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose='fishing_inquiry_email_control_v1'),
 version text NOT NULL CHECK(version='JLFA-INQUIRY-EMAIL-CONTROL-v1'),
 source_kind text NOT NULL CHECK(source_kind='public_group_application'),
 source_request_digest text NOT NULL CHECK(source_request_digest ~ '^[a-f0-9]{64}$'),
 request_version text NOT NULL CHECK(length(request_version) BETWEEN 1 AND 100),
 offer_version text NOT NULL CHECK(length(offer_version) BETWEEN 1 AND 100),
 email_blind text NOT NULL CHECK(email_blind ~ '^[a-f0-9]{64}$'),
 message_language text NOT NULL CHECK(message_language IN ('en','he')),
 token_digest text NOT NULL CHECK(token_digest ~ '^[a-f0-9]{64}$'),
 delivery_intent_id uuid NOT NULL,
 -- Server-keyring AEAD: original issuance and one-way lifecycle respectively.
 -- Plain indexes/flags alone never constitute mailbox evidence.
 issuance_ciphertext text NOT NULL CHECK(octet_length(issuance_ciphertext) BETWEEN 1 AND 100000),
 lifecycle_ciphertext text NOT NULL CHECK(octet_length(lifecycle_ciphertext) BETWEEN 1 AND 100000),
 issued_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL CHECK(expires_at>issued_at AND expires_at-issued_at<=interval '1 day'),
 consumed_at timestamptz CHECK(consumed_at IS NULL OR consumed_at>=issued_at AND consumed_at<expires_at),
 revoked_at timestamptz CHECK(revoked_at IS NULL OR revoked_at>=issued_at),
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,application_id,purpose),
 UNIQUE(workspace_id,token_digest),
 UNIQUE(workspace_id,delivery_intent_id),
 FOREIGN KEY(workspace_id,application_id) REFERENCES ls_service_interest.public_applications(workspace_id,id)
);
REVOKE ALL ON ls_service_interest.inquiry_email_control_verifications FROM PUBLIC;
