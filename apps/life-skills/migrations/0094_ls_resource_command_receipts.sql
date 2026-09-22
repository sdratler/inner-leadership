CREATE TABLE ls_resources.command_receipts (
 workspace_id uuid NOT NULL, actor_account_id uuid NOT NULL,
 operation text NOT NULL CHECK(operation IN ('create_resource','assign_resource')),
 idempotency_key uuid NOT NULL, body_digest text NOT NULL CHECK(body_digest ~ '^[a-f0-9]{64}$'),
 result_ciphertext text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,actor_account_id,operation,idempotency_key),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
