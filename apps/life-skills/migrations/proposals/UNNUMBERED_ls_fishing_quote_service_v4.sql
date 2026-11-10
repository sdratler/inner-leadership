-- UNNUMBERED additive successor; disposable rehearsal ONLY. Root owns exact
-- catalog/numbered/manifest/recovery/apply. No legacy row/ciphertext backfill.
ALTER TABLE ls_fishing_billing.quotes ADD COLUMN material_version text
 CHECK(material_version IS NULL OR material_version='JLFA-FISHING-BILLING-SERVICE-v4');
ALTER TABLE ls_fishing_billing.quotes ADD CONSTRAINT service_quote_time_precision_v4 CHECK(material_version IS NULL OR
 (isfinite(created_at) AND created_at=date_trunc('milliseconds',created_at)));
CREATE FUNCTION ls_fishing_billing.protect_quote_material_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.material_version IS NOT NULL OR NEW.material_version IS NOT NULL) AND
  (NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.id IS DISTINCT FROM OLD.id OR NEW.family_id IS DISTINCT FROM OLD.family_id
   OR NEW.definition_id IS DISTINCT FROM OLD.definition_id OR NEW.created_at IS DISTINCT FROM OLD.created_at)
 THEN RAISE EXCEPTION 'FISHING_QUOTE_ORIGIN_INDEX_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF OLD.material_version IS NOT NULL AND NEW.material_version IS DISTINCT FROM OLD.material_version
 THEN RAISE EXCEPTION 'FISHING_QUOTE_VERSION_DOWNGRADE' USING ERRCODE='23514'; END IF;
 IF OLD.material_version IS NULL AND NEW.material_version IS NOT NULL THEN
  IF NEW.revision<>OLD.revision+1 OR EXISTS(SELECT 1 FROM ls_fishing_billing.guest_grants WHERE workspace_id=OLD.workspace_id AND quote_id=OLD.id)
   OR EXISTS(SELECT 1 FROM ls_fishing_billing.guest_operations WHERE workspace_id=OLD.workspace_id AND quote_id=OLD.id)
   OR EXISTS(SELECT 1 FROM ls_fishing_billing.obligations WHERE workspace_id=OLD.workspace_id AND quote_id=OLD.id)
   OR EXISTS(SELECT 1 FROM ls_fishing_billing.receipts WHERE workspace_id=OLD.workspace_id AND quote_id=OLD.id)
  THEN RAISE EXCEPTION 'FISHING_QUOTE_NOT_PRISTINE' USING ERRCODE='23514'; END IF;
 END IF;
 -- The actual native writer must additionally authenticate and reject an
 -- issued/cancelled/accepted/paused encrypted V3 quote; SQL cannot inspect AEAD.
 RETURN NEW;
END; $$;
CREATE TRIGGER quote_service_material_version BEFORE UPDATE ON ls_fishing_billing.quotes
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.protect_quote_material_version();
REVOKE ALL ON FUNCTION ls_fishing_billing.protect_quote_material_version() FROM PUBLIC;
CREATE UNIQUE INDEX one_service_issue_origin_per_quote_v4 ON ls_fishing_billing.commands(workspace_id,quote_id) WHERE action='guest_service_issue_v4';
ALTER TABLE ls_fishing_billing.commands ADD CONSTRAINT service_issue_time_scope_v4 CHECK(action<>'guest_service_issue_v4' OR
 (quote_id IS NOT NULL AND isfinite(created_at) AND created_at=date_trunc('milliseconds',created_at)));
CREATE FUNCTION ls_fishing_billing.protect_service_issue_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN
  IF EXISTS(SELECT 1 FROM ls_fishing_billing.commands WHERE action='guest_service_issue_v4')
  THEN RAISE EXCEPTION 'FISHING_SERVICE_ISSUE_IMMUTABLE' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 IF OLD.action='guest_service_issue_v4' OR (TG_OP='UPDATE' AND NEW.action='guest_service_issue_v4')
 THEN RAISE EXCEPTION 'FISHING_SERVICE_ISSUE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER service_issue_journal_immutable BEFORE UPDATE OR DELETE ON ls_fishing_billing.commands
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.protect_service_issue_journal();
CREATE TRIGGER service_issue_journal_no_truncate BEFORE TRUNCATE ON ls_fishing_billing.commands
 FOR EACH STATEMENT EXECUTE FUNCTION ls_fishing_billing.protect_service_issue_journal();
REVOKE ALL ON FUNCTION ls_fishing_billing.protect_service_issue_journal() FROM PUBLIC;
