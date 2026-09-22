-- Additive, private first-session ledger. No live application is authorized by this file.
CREATE SCHEMA ls_onboarding;
CREATE TABLE ls_onboarding.first_session_orders (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 order_id text NOT NULL, case_id uuid NOT NULL, child_id uuid NOT NULL,
 amount_minor integer NOT NULL CHECK(amount_minor=55000), currency text NOT NULL CHECK(currency='ILS'),
 purpose text NOT NULL CHECK(purpose='first_session'),
 PRIMARY KEY(workspace_id,order_id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,child_id) REFERENCES ls_identity.people(workspace_id,id),
 UNIQUE(workspace_id,case_id,child_id)
);
CREATE TABLE ls_onboarding.provider_receipts (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id), provider_account_id text NOT NULL,
 event_key text NOT NULL, receipt_id text NOT NULL, raw_digest text NOT NULL CHECK(raw_digest ~ '^[a-f0-9]{64}$'),
 received_at timestamptz NOT NULL, event_json jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('pending','paid','failed','refunded','unmatched','duplicate')),
 allocations_json jsonb NOT NULL DEFAULT '[]'::jsonb,
 PRIMARY KEY(workspace_id,provider_account_id,event_key), CHECK(jsonb_typeof(event_json)='object'),
 CHECK(jsonb_typeof(allocations_json)='array')
);
CREATE TABLE ls_onboarding.payment_allocations (
 workspace_id uuid NOT NULL, provider_account_id text NOT NULL, transaction_id text NOT NULL,
 order_id text NOT NULL, child_id uuid NOT NULL, amount_minor integer NOT NULL CHECK(amount_minor=55000),
 PRIMARY KEY(workspace_id,provider_account_id,transaction_id), UNIQUE(workspace_id,order_id),
 FOREIGN KEY(workspace_id,order_id) REFERENCES ls_onboarding.first_session_orders(workspace_id,order_id)
);
CREATE TABLE ls_onboarding.payment_reversals (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id), provider_account_id text NOT NULL,
 transaction_id text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,provider_account_id,transaction_id)
);
CREATE TABLE ls_onboarding.staff_allocation_audits (
 workspace_id uuid NOT NULL, provider_account_id text NOT NULL, event_key text NOT NULL,
 transaction_id text NOT NULL, order_id text NOT NULL, actor_id text NOT NULL CHECK(length(trim(actor_id))>0),
 audit_record_id text NOT NULL CHECK(length(trim(audit_record_id))>0), recorded_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workspace_id,audit_record_id),
 FOREIGN KEY(workspace_id,provider_account_id,event_key) REFERENCES ls_onboarding.provider_receipts(workspace_id,provider_account_id,event_key),
 FOREIGN KEY(workspace_id,provider_account_id,transaction_id) REFERENCES ls_onboarding.payment_allocations(workspace_id,provider_account_id,transaction_id),
 FOREIGN KEY(workspace_id,order_id) REFERENCES ls_onboarding.first_session_orders(workspace_id,order_id)
);
CREATE FUNCTION ls_onboarding.check_order_child() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_cases.cases c JOIN ls_cases.clients cl ON cl.workspace_id=c.workspace_id AND cl.id=c.client_id
 JOIN ls_identity.people p ON p.workspace_id=cl.workspace_id AND p.id=cl.person_id
 WHERE c.workspace_id=NEW.workspace_id AND c.id=NEW.case_id AND p.id=NEW.child_id AND p.kind='minor')
 THEN RAISE EXCEPTION 'order_case_child_mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER order_case_child BEFORE INSERT ON ls_onboarding.first_session_orders
 FOR EACH ROW EXECUTE FUNCTION ls_onboarding.check_order_child();
CREATE FUNCTION ls_onboarding.append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'append_only_payment_record' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_orders BEFORE UPDATE OR DELETE ON ls_onboarding.first_session_orders
 FOR EACH ROW EXECUTE FUNCTION ls_onboarding.append_only();
CREATE TRIGGER immutable_allocations BEFORE UPDATE OR DELETE ON ls_onboarding.payment_allocations
 FOR EACH ROW EXECUTE FUNCTION ls_onboarding.append_only();
CREATE TRIGGER immutable_reversals BEFORE UPDATE OR DELETE ON ls_onboarding.payment_reversals
 FOR EACH ROW EXECUTE FUNCTION ls_onboarding.append_only();
CREATE TRIGGER immutable_staff_audit BEFORE UPDATE OR DELETE ON ls_onboarding.staff_allocation_audits
 FOR EACH ROW EXECUTE FUNCTION ls_onboarding.append_only();
CREATE FUNCTION ls_onboarding.immutable_receipt() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' OR (NEW.workspace_id,NEW.provider_account_id,NEW.event_key,NEW.receipt_id,NEW.raw_digest,NEW.received_at,NEW.event_json)
 IS DISTINCT FROM (OLD.workspace_id,OLD.provider_account_id,OLD.event_key,OLD.receipt_id,OLD.raw_digest,OLD.received_at,OLD.event_json)
 THEN RAISE EXCEPTION 'immutable_provider_evidence' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_provider_evidence BEFORE UPDATE OR DELETE ON ls_onboarding.provider_receipts
 FOR EACH ROW EXECUTE FUNCTION ls_onboarding.immutable_receipt();
REVOKE ALL ON SCHEMA ls_onboarding FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ls_onboarding FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ls_onboarding FROM PUBLIC;
