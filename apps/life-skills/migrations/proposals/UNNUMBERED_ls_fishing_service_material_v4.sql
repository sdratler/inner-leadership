-- ADDITIVE UNNUMBERED PROPOSAL for disposable rehearsal ONLY. Integrator owns
-- catalog validation, numbered adoption, manifest/recovery and production apply.
-- No backfill, ciphertext rewrite, new quote/money/receipt ledger or activation.
-- NULL metadata is reserved for the unchanged exact V3 actions/decoders.
ALTER TABLE ls_fishing_billing.guest_grants ADD COLUMN material_version text;
ALTER TABLE ls_fishing_billing.guest_operations ADD COLUMN material_version text;
ALTER TABLE ls_fishing_billing.guest_financial_acceptances ADD COLUMN material_version text;
ALTER TABLE ls_fishing_billing.guest_grants DROP CONSTRAINT guest_grants_action_check;
ALTER TABLE ls_fishing_billing.guest_operations DROP CONSTRAINT guest_operations_action_check;
ALTER TABLE ls_fishing_billing.guest_financial_acceptances DROP CONSTRAINT guest_financial_acceptances_action_check;
ALTER TABLE ls_fishing_billing.guest_grants ADD CONSTRAINT guest_grants_action_check CHECK(action IN('submit_private_completion','accept_financial_offer','accept_service_financial_offer_v4')),
 ADD CONSTRAINT guest_grants_material_version_check CHECK((material_version IS NULL AND action IN('submit_private_completion','accept_financial_offer')) OR
  (material_version IS NOT NULL AND material_version='JLFA-FISHING-BILLING-SERVICE-v4' AND action='accept_service_financial_offer_v4')),
 ADD UNIQUE(workspace_id,id,quote_id,action,material_version);
ALTER TABLE ls_fishing_billing.guest_operations ADD CONSTRAINT guest_operations_action_check CHECK(action IN('submit_private_completion','accept_financial_offer','accept_service_financial_offer_v4')),
 ADD CONSTRAINT guest_operations_material_version_check CHECK((material_version IS NULL AND action IN('submit_private_completion','accept_financial_offer')) OR
  (material_version IS NOT NULL AND material_version='JLFA-FISHING-BILLING-SERVICE-v4' AND action='accept_service_financial_offer_v4')),
 ADD UNIQUE(workspace_id,operation_id,grant_id,quote_id,action,receipt_id,material_version),
 ADD FOREIGN KEY(workspace_id,grant_id,quote_id,action,material_version) REFERENCES ls_fishing_billing.guest_grants(workspace_id,id,quote_id,action,material_version);
ALTER TABLE ls_fishing_billing.guest_financial_acceptances ADD CONSTRAINT guest_financial_acceptances_action_check CHECK(action IN('accept_financial_offer','accept_service_financial_offer_v4')),
 ADD CONSTRAINT guest_acceptance_material_version_check CHECK((material_version IS NULL AND action='accept_financial_offer') OR
  (material_version IS NOT NULL AND material_version='JLFA-FISHING-BILLING-SERVICE-v4' AND action='accept_service_financial_offer_v4')),
 ADD FOREIGN KEY(workspace_id,operation_id,grant_id,quote_id,action,id,material_version) REFERENCES ls_fishing_billing.guest_operations(workspace_id,operation_id,grant_id,quote_id,action,receipt_id,material_version);
CREATE FUNCTION ls_fishing_billing.protect_guest_material_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.material_version IS DISTINCT FROM OLD.material_version OR NEW.action IS DISTINCT FROM OLD.action
 THEN RAISE EXCEPTION 'FISHING_GUEST_MATERIAL_VERSION_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER guest_grant_material_version_immutable BEFORE UPDATE ON ls_fishing_billing.guest_grants
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.protect_guest_material_version();
REVOKE ALL ON FUNCTION ls_fishing_billing.protect_guest_material_version() FROM PUBLIC;
