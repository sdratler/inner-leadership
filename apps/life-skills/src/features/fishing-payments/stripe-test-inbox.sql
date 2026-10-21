-- Stripe-only native receipt storage in the existing database. Install with the
-- separately bound operator transaction, not the broad application migrator.
-- The general migration ledger remains unchanged; no other pending migration
-- or whole payment/program schema is implied to be installed.
CREATE SCHEMA ls_fishing_payments;
CREATE TABLE ls_fishing_payments.inbox (
 provider_account_id text NOT NULL, livemode boolean NOT NULL, event_id text NOT NULL, digest text NOT NULL,
 receipt_json jsonb NOT NULL, received_at timestamptz NOT NULL, processed_at timestamptz,
 PRIMARY KEY(provider_account_id,livemode,event_id)
);
COMMENT ON TABLE ls_fishing_payments.inbox IS 'ls-stripe-test-inbox-v1';
ALTER TABLE ls_fishing_payments.inbox ENABLE ROW LEVEL SECURITY;
ALTER TABLE ls_fishing_payments.inbox FORCE ROW LEVEL SECURITY;
