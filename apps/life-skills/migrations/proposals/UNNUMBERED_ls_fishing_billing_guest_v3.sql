-- ADDITIVE UNNUMBERED PROPOSAL ONLY. Not manifested, installed or activated.
-- Same quote/family/obligation/money ledger; no account, CRM or import created.
-- Root must bind actual current schema/policy/readiness before adoption.
CREATE TABLE ls_fishing_billing.guest_grants(
 workspace_id uuid NOT NULL,id uuid NOT NULL,quote_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN('submit_private_completion','accept_financial_offer')),
 token_digest text NOT NULL CHECK(token_digest~'^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN('active','consumed','revoked')),
 issued_at timestamptz NOT NULL CHECK(isfinite(issued_at)),
 expires_at timestamptz NOT NULL CHECK(isfinite(expires_at)),
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,token_digest),UNIQUE(workspace_id,id,quote_id,action),CHECK(expires_at>issued_at),
 FOREIGN KEY(workspace_id,quote_id) REFERENCES ls_fishing_billing.quotes(workspace_id,id)
);
CREATE TABLE ls_fishing_billing.guest_operations(
 workspace_id uuid NOT NULL,operation_id uuid NOT NULL,grant_id uuid NOT NULL,quote_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN('submit_private_completion','accept_financial_offer')),
 request_digest text NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 receipt_id uuid NOT NULL,receipt_ciphertext text NOT NULL CHECK(length(receipt_ciphertext)>0),
 recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)),
 PRIMARY KEY(workspace_id,operation_id),UNIQUE(workspace_id,receipt_id),UNIQUE(workspace_id,grant_id),
 UNIQUE(workspace_id,operation_id,grant_id,quote_id,action,receipt_id),
 FOREIGN KEY(workspace_id,grant_id,quote_id,action) REFERENCES ls_fishing_billing.guest_grants(workspace_id,id,quote_id,action),
 FOREIGN KEY(workspace_id,quote_id) REFERENCES ls_fishing_billing.quotes(workspace_id,id)
);
CREATE TABLE ls_fishing_billing.guest_financial_acceptances(
 workspace_id uuid NOT NULL,id uuid NOT NULL,quote_id uuid NOT NULL,grant_id uuid NOT NULL,operation_id uuid NOT NULL,
 action text NOT NULL DEFAULT 'accept_financial_offer' CHECK(action='accept_financial_offer'),
 issued_revision integer NOT NULL CHECK(issued_revision>0),
 evidence_ciphertext text NOT NULL CHECK(length(evidence_ciphertext)>0),
 accepted_at timestamptz NOT NULL CHECK(isfinite(accepted_at)),
 PRIMARY KEY(workspace_id,id),UNIQUE(workspace_id,quote_id),UNIQUE(workspace_id,grant_id),UNIQUE(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,quote_id) REFERENCES ls_fishing_billing.quotes(workspace_id,id),
 FOREIGN KEY(workspace_id,grant_id) REFERENCES ls_fishing_billing.guest_grants(workspace_id,id),
 FOREIGN KEY(workspace_id,operation_id,grant_id,quote_id,action,id) REFERENCES ls_fishing_billing.guest_operations(workspace_id,operation_id,grant_id,quote_id,action,receipt_id)
);
-- Account-era commands/acceptance actor IDs remain unchanged. A guest grant is
-- never inserted in an accepting-account column or used as an owner session.
CREATE FUNCTION ls_fishing_billing.reject_guest_evidence_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable guest financial evidence'; END;
$$;
CREATE TRIGGER guest_operation_immutable BEFORE UPDATE OR DELETE ON ls_fishing_billing.guest_operations
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.reject_guest_evidence_mutation();
CREATE TRIGGER guest_acceptance_immutable BEFORE UPDATE OR DELETE ON ls_fishing_billing.guest_financial_acceptances
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.reject_guest_evidence_mutation();
REVOKE ALL ON ls_fishing_billing.guest_grants,ls_fishing_billing.guest_operations,ls_fishing_billing.guest_financial_acceptances FROM PUBLIC;
