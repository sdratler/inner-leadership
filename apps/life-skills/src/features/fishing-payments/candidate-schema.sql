-- UNNUMBERED PROPOSAL. MAIN owns registration, isolated execution and migration.
-- No ILS/auth/clinical schema changes. IDs/JSON contain opaque references only.
CREATE SCHEMA ls_fishing_payments;
CREATE TABLE ls_fishing_payments.offers (
 workspace_id uuid NOT NULL, id text NOT NULL, revision integer NOT NULL CHECK(revision>0),
 digest text NOT NULL, offer_json jsonb NOT NULL,campaign_id text, state text NOT NULL CHECK(state IN('approved','cancelled')),
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE ls_fishing_payments.purchases (
 workspace_id uuid NOT NULL, id uuid NOT NULL, offer_id text NOT NULL, line_id text NOT NULL,
 revision integer NOT NULL CHECK(revision>0), state_json jsonb NOT NULL,
 PRIMARY KEY(workspace_id,id), UNIQUE(workspace_id,offer_id,line_id),
 FOREIGN KEY(workspace_id,offer_id) REFERENCES ls_fishing_payments.offers(workspace_id,id)
);
CREATE TABLE ls_fishing_payments.commands (
 workspace_id uuid NOT NULL, actor_id uuid NOT NULL, action text NOT NULL, command_id text NOT NULL,
 digest text NOT NULL,result_json jsonb NOT NULL,created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,actor_id,action,command_id)
);
CREATE TABLE ls_fishing_payments.operations (
 workspace_id uuid NOT NULL,id uuid NOT NULL,purchase_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN('hosted_invoice','refund')),
 due_id text,request_digest text NOT NULL,operation_json jsonb NOT NULL,
 PRIMARY KEY(workspace_id,id),FOREIGN KEY(workspace_id,purchase_id) REFERENCES ls_fishing_payments.purchases(workspace_id,id)
);
CREATE UNIQUE INDEX fishing_one_hosted_due ON ls_fishing_payments.operations(workspace_id,purchase_id,due_id) WHERE kind='hosted_invoice';
CREATE TABLE ls_fishing_payments.inbox (
 provider_account_id text NOT NULL,livemode boolean NOT NULL,event_id text NOT NULL,digest text NOT NULL,
 receipt_json jsonb NOT NULL,received_at timestamptz NOT NULL,processed_at timestamptz,
 PRIMARY KEY(provider_account_id,livemode,event_id)
);
CREATE TABLE ls_fishing_payments.settlements (
 provider_account_id text NOT NULL,livemode boolean NOT NULL,kind text NOT NULL CHECK(kind IN('payment','refund','dispute')),
 transaction_id text NOT NULL,workspace_id uuid NOT NULL,purchase_id uuid NOT NULL,digest text NOT NULL,fact_json jsonb NOT NULL,
 PRIMARY KEY(provider_account_id,livemode,kind,transaction_id),
 FOREIGN KEY(workspace_id,purchase_id) REFERENCES ls_fishing_payments.purchases(workspace_id,id)
);
CREATE TABLE ls_fishing_payments.campaigns (
 workspace_id uuid NOT NULL,id text NOT NULL,policy_json jsonb NOT NULL,
 PRIMARY KEY(workspace_id,id)
);
CREATE TABLE ls_fishing_payments.founder_households (
 workspace_id uuid NOT NULL,campaign_id text NOT NULL,household_id text NOT NULL,
 state text NOT NULL CHECK(state IN('reserved','claimed','reconciliation_required')),offer_id text NOT NULL,
 PRIMARY KEY(workspace_id,campaign_id,household_id),
 FOREIGN KEY(workspace_id,campaign_id) REFERENCES ls_fishing_payments.campaigns(workspace_id,id)
);
CREATE TABLE ls_fishing_payments.reminders (
 workspace_id uuid NOT NULL,id uuid NOT NULL,purchase_id uuid NOT NULL,due_id text NOT NULL,policy_id text NOT NULL,
 draft_json jsonb NOT NULL,state text NOT NULL CHECK(state IN('draft','suppressed')),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,purchase_id,due_id,policy_id),
 FOREIGN KEY(workspace_id,purchase_id) REFERENCES ls_fishing_payments.purchases(workspace_id,id)
);
CREATE TABLE ls_fishing_payments.outbox (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,topic text NOT NULL,aggregate_id text NOT NULL,
 revision integer NOT NULL,recorded_at timestamptz NOT NULL,
 UNIQUE(workspace_id,topic,aggregate_id,revision)
);
