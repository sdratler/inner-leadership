-- UNNUMBERED ISOLATED PROPOSAL. Requires the separately pinned payment candidate.
-- No migration registration, runtime writer, credentials or provider activation.
-- These provenance references are records, not verification of a real provider.
CREATE TABLE ls_fishing_payments.customer_bindings (
 workspace_id uuid NOT NULL, id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 payer_account_id uuid NOT NULL, provider_account_id text NOT NULL CHECK(provider_account_id ~ '^acct_[A-Za-z0-9_]{1,150}$'),
 livemode boolean NOT NULL CHECK(livemode=false), customer_id text NOT NULL CHECK(customer_id ~ '^cus_[A-Za-z0-9_]{1,150}$'),
 merchant_binding_id text NOT NULL CHECK(length(merchant_binding_id) BETWEEN 1 AND 160),
 api_version text NOT NULL CHECK(length(api_version) BETWEEN 1 AND 80),
 provenance_reference text NOT NULL CHECK(length(provenance_reference) BETWEEN 1 AND 160),
 verified_at timestamptz NOT NULL, revoked_at timestamptz,
 PRIMARY KEY(workspace_id,id), UNIQUE(provider_account_id,livemode,customer_id),
 UNIQUE(workspace_id,id,provider_account_id,livemode),
 FOREIGN KEY(workspace_id,payer_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(revoked_at IS NULL OR revoked_at>=verified_at)
);
CREATE UNIQUE INDEX fishing_one_active_customer_binding ON ls_fishing_payments.customer_bindings
 (workspace_id,payer_account_id,provider_account_id,livemode) WHERE revoked_at IS NULL;
CREATE TABLE ls_fishing_payments.object_bindings (
 workspace_id uuid NOT NULL, id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 provider_account_id text NOT NULL, livemode boolean NOT NULL CHECK(livemode=false),
 customer_binding_id uuid NOT NULL, purchase_id uuid NOT NULL, hosted_operation_id uuid NOT NULL, operation_id uuid NOT NULL,
 invoice_id text NOT NULL CHECK(invoice_id ~ '^in_[A-Za-z0-9_]{1,150}$'),
 object_kind text NOT NULL CHECK(object_kind IN('invoice','payment_intent','checkout_session','charge','refund')),
 object_id text NOT NULL CHECK(length(object_id)<=160),
 provenance_reference text NOT NULL CHECK(length(provenance_reference) BETWEEN 1 AND 160),
 verified_at timestamptz NOT NULL, revoked_at timestamptz,
 PRIMARY KEY(workspace_id,id), UNIQUE(provider_account_id,livemode,object_id),
 FOREIGN KEY(workspace_id,customer_binding_id,provider_account_id,livemode)
  REFERENCES ls_fishing_payments.customer_bindings(workspace_id,id,provider_account_id,livemode),
 FOREIGN KEY(workspace_id,purchase_id) REFERENCES ls_fishing_payments.purchases(workspace_id,id),
 FOREIGN KEY(workspace_id,hosted_operation_id) REFERENCES ls_fishing_payments.operations(workspace_id,id),
 FOREIGN KEY(workspace_id,operation_id) REFERENCES ls_fishing_payments.operations(workspace_id,id),
 CHECK((object_kind='invoice' AND object_id=invoice_id) OR
  (object_kind='payment_intent' AND object_id ~ '^pi_[A-Za-z0-9_]{1,150}$') OR
  (object_kind='checkout_session' AND object_id ~ '^cs_[A-Za-z0-9_]{1,150}$') OR
  (object_kind='charge' AND object_id ~ '^ch_[A-Za-z0-9_]{1,150}$') OR
  (object_kind='refund' AND object_id ~ '^re_[A-Za-z0-9_]{1,150}$')),
 CHECK(object_kind='refund' OR operation_id=hosted_operation_id),
 CHECK(revoked_at IS NULL OR revoked_at>=verified_at)
);
-- The read adapter deliberately supports one current PI/session per invoice.
-- Multiple allocations need explicit reconciliation, not silent truncation.
CREATE UNIQUE INDEX fishing_single_invoice_object_kind ON ls_fishing_payments.object_bindings
 (workspace_id,hosted_operation_id,object_kind) WHERE object_kind<>'refund';
CREATE INDEX fishing_native_invoice_objects ON ls_fishing_payments.object_bindings
 (workspace_id,hosted_operation_id,invoice_id,object_kind);
CREATE FUNCTION ls_fishing_payments.preserve_stripe_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_STRIPE_BINDING'; END IF;
 IF (to_jsonb(NEW)-'revision'-'revoked_at') IS DISTINCT FROM (to_jsonb(OLD)-'revision'-'revoked_at')
  OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL OR NEW.revision<>OLD.revision+1
 THEN RAISE EXCEPTION 'IMMUTABLE_STRIPE_BINDING'; END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER preserve_customer_binding BEFORE UPDATE OR DELETE ON ls_fishing_payments.customer_bindings
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_payments.preserve_stripe_binding();
CREATE TRIGGER preserve_object_binding BEFORE UPDATE OR DELETE ON ls_fishing_payments.object_bindings
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_payments.preserve_stripe_binding();
