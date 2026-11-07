-- UNNUMBERED ADDITIVE PROPOSAL for an explicitly disposable database.
-- Integrator alone adopts/renumbers production migration and existing outbox
-- composition. No production URL, data reset, existing-table edit or cascade.
CREATE SCHEMA ls_fishing_billing;
CREATE TABLE ls_fishing_billing.definitions(
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 id uuid NOT NULL,payload_ciphertext text NOT NULL,published_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE ls_fishing_billing.quotes(
 workspace_id uuid NOT NULL,id uuid NOT NULL,family_id uuid NOT NULL,definition_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),payload_ciphertext text NOT NULL,created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),
 FOREIGN KEY(workspace_id,definition_id) REFERENCES ls_fishing_billing.definitions(workspace_id,id)
);
CREATE TABLE ls_fishing_billing.commands(
 workspace_id uuid NOT NULL,operation_id uuid NOT NULL,actor_id uuid NOT NULL,action text NOT NULL,
 quote_id uuid,request_digest text NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 result_ciphertext text NOT NULL,created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,quote_id) REFERENCES ls_fishing_billing.quotes(workspace_id,id)
);
CREATE TABLE ls_fishing_billing.obligations(
 workspace_id uuid NOT NULL,quote_id uuid NOT NULL,line_id uuid NOT NULL,family_id uuid NOT NULL,
 child_id uuid NOT NULL,period_id uuid NOT NULL,starts_at timestamptz NOT NULL,ends_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,line_id),UNIQUE(workspace_id,child_id,period_id),
 UNIQUE(workspace_id,child_id,starts_at,ends_at),CHECK(ends_at>starts_at),
 FOREIGN KEY(workspace_id,quote_id) REFERENCES ls_fishing_billing.quotes(workspace_id,id)
);
CREATE TABLE ls_fishing_billing.receipts(
 workspace_id uuid NOT NULL,id uuid NOT NULL,quote_id uuid NOT NULL,operation_id uuid NOT NULL,
 original_receipt_id uuid,payload_ciphertext text NOT NULL,recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,quote_id) REFERENCES ls_fishing_billing.quotes(workspace_id,id),
 FOREIGN KEY(workspace_id,original_receipt_id) REFERENCES ls_fishing_billing.receipts(workspace_id,id)
);
CREATE TABLE ls_fishing_billing.reminders(
 workspace_id uuid NOT NULL,id uuid NOT NULL,quote_id uuid NOT NULL,
 intent_key text NOT NULL CHECK(intent_key~'^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN('queued','unknown','provider_accepted','delivered','suppressed','failed')),
 payload_ciphertext text NOT NULL,policy_ciphertext text NOT NULL,
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,intent_key),
 FOREIGN KEY(workspace_id,quote_id) REFERENCES ls_fishing_billing.quotes(workspace_id,id)
);
-- Signed minimal durable intake; not settlement or provider acknowledgment.
CREATE TABLE ls_fishing_billing.stripe_events(
 account_id text NOT NULL,livemode boolean NOT NULL CHECK(livemode=false),event_id text NOT NULL,
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),body_digest text NOT NULL CHECK(body_digest~'^[a-f0-9]{64}$'),
 receipt_ciphertext text NOT NULL,received_at timestamptz NOT NULL,
 state text NOT NULL CHECK(state IN('pending','processed','review_required')),
 PRIMARY KEY(account_id,livemode,event_id)
);
