-- UNNUMBERED disposable rehearsal ONLY. Root owns numbering/catalog/apply.
-- Append to the SAME commands/receipt ledger. No history conversion/backfill.
ALTER TABLE ls_fishing_billing.commands ADD CONSTRAINT service_money_time_scope_v4 CHECK(action NOT IN ('service_cash_date_v4','service_reverse_cash_v4') OR
 (quote_id IS NOT NULL AND isfinite(created_at) AND created_at=date_trunc('milliseconds',created_at)));
CREATE FUNCTION ls_fishing_billing.protect_service_money_journal() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='TRUNCATE' THEN
  IF EXISTS(SELECT 1 FROM ls_fishing_billing.commands WHERE action IN ('service_cash_date_v4','service_reverse_cash_v4'))
  THEN RAISE EXCEPTION 'FISHING_SERVICE_MONEY_IMMUTABLE' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 IF OLD.action IN ('service_cash_date_v4','service_reverse_cash_v4') OR (TG_OP='UPDATE' AND NEW.action IN ('service_cash_date_v4','service_reverse_cash_v4'))
 THEN RAISE EXCEPTION 'FISHING_SERVICE_MONEY_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END; $$;
CREATE TRIGGER service_money_journal_immutable BEFORE UPDATE OR DELETE ON ls_fishing_billing.commands
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.protect_service_money_journal();
CREATE TRIGGER service_money_journal_no_truncate BEFORE TRUNCATE ON ls_fishing_billing.commands
 FOR EACH STATEMENT EXECUTE FUNCTION ls_fishing_billing.protect_service_money_journal();
REVOKE ALL ON FUNCTION ls_fishing_billing.protect_service_money_journal() FROM PUBLIC;
