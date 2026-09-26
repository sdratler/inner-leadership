-- A real case/account cannot be relabeled as demo after creation. The origin and
-- immutable marker must be written together in the synthetic creation transaction.
ALTER TABLE ls_cases.cases ADD COLUMN demo_batch_id text;
ALTER TABLE ls_identity.accounts ADD COLUMN demo_batch_id text;
ALTER TABLE ls_cases.cases ADD CONSTRAINT demo_case_origin_batch
 FOREIGN KEY(workspace_id,demo_batch_id) REFERENCES ls_demo.batches(workspace_id,batch_id);
ALTER TABLE ls_identity.accounts ADD CONSTRAINT demo_account_origin_batch
 FOREIGN KEY(workspace_id,demo_batch_id) REFERENCES ls_demo.batches(workspace_id,batch_id);

CREATE FUNCTION ls_demo.prevent_origin_change() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.demo_batch_id IS DISTINCT FROM OLD.demo_batch_id
 THEN RAISE EXCEPTION 'LS_DEMO_ORIGIN_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER immutable_demo_case_origin BEFORE UPDATE ON ls_cases.cases
 FOR EACH ROW EXECUTE FUNCTION ls_demo.prevent_origin_change();
CREATE TRIGGER immutable_demo_account_origin BEFORE UPDATE ON ls_identity.accounts
 FOR EACH ROW EXECUTE FUNCTION ls_demo.prevent_origin_change();

CREATE OR REPLACE FUNCTION ls_demo.guard_case_marker() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE origin text;
BEGIN
 PERFORM id FROM ls_identity.workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 SELECT demo_batch_id INTO origin FROM ls_cases.cases WHERE workspace_id=NEW.workspace_id AND id=NEW.case_id;
 IF origin IS DISTINCT FROM NEW.batch_id
 THEN RAISE EXCEPTION 'LS_DEMO_CASE_ORIGIN_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$fn$;
CREATE FUNCTION ls_demo.guard_account_marker() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE origin text;
BEGIN
 PERFORM id FROM ls_identity.workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 SELECT demo_batch_id INTO origin FROM ls_identity.accounts WHERE workspace_id=NEW.workspace_id AND id=NEW.account_id;
 IF origin IS DISTINCT FROM NEW.batch_id
 THEN RAISE EXCEPTION 'LS_DEMO_ACCOUNT_ORIGIN_MISMATCH' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER demo_account_origin_required BEFORE INSERT ON ls_demo.accounts
 FOR EACH ROW EXECUTE FUNCTION ls_demo.guard_account_marker();

CREATE FUNCTION ls_demo.require_case_marker() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.demo_batch_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM ls_demo.cases WHERE workspace_id=NEW.workspace_id AND case_id=NEW.id AND batch_id=NEW.demo_batch_id)
 THEN RAISE EXCEPTION 'LS_DEMO_CASE_MARKER_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$fn$;
CREATE CONSTRAINT TRIGGER demo_case_marker_required AFTER INSERT OR UPDATE ON ls_cases.cases
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ls_demo.require_case_marker();

CREATE FUNCTION ls_demo.require_account_marker() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 IF NEW.demo_batch_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM ls_demo.accounts WHERE workspace_id=NEW.workspace_id AND account_id=NEW.id AND batch_id=NEW.demo_batch_id)
 THEN RAISE EXCEPTION 'LS_DEMO_ACCOUNT_MARKER_REQUIRED' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$fn$;
CREATE CONSTRAINT TRIGGER demo_account_marker_required AFTER INSERT OR UPDATE ON ls_identity.accounts
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION ls_demo.require_account_marker();
