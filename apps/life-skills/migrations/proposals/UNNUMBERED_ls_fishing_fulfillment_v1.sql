-- UNNUMBERED additive proposal for disposable rehearsal only. Root owns
-- numbered adoption/manifest/recovery/apply. No automatic app bootstrap.
CREATE TABLE ls_fishing_billing.fulfillment_versions (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 kind text NOT NULL CHECK(kind IN ('departure','plan')),entity_id uuid NOT NULL,
 group_id uuid,quote_id uuid,revision integer NOT NULL CHECK(revision>0),operation_id uuid NOT NULL,
 recorded_by uuid NOT NULL,recorded_at timestamptz(3) NOT NULL,
 request_digest text NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),record_digest text NOT NULL CHECK(record_digest~'^[a-f0-9]{64}$'),
 previous_revision integer GENERATED ALWAYS AS(CASE WHEN revision>1 THEN revision-1 END) STORED,
 previous_digest text CHECK(previous_digest~'^[a-f0-9]{64}$'),payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext) BETWEEN 1 AND 200000),
 PRIMARY KEY(workspace_id,kind,entity_id,revision),UNIQUE(workspace_id,operation_id),
 UNIQUE(workspace_id,kind,entity_id,revision,record_digest),
 FOREIGN KEY(workspace_id,group_id) REFERENCES ls_fishing_billing.group_preparation_heads(workspace_id,group_id),
 FOREIGN KEY(workspace_id,quote_id) REFERENCES ls_fishing_billing.quotes(workspace_id,id),
 FOREIGN KEY(workspace_id,recorded_by) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,kind,entity_id,previous_revision,previous_digest)
  REFERENCES ls_fishing_billing.fulfillment_versions(workspace_id,kind,entity_id,revision,record_digest),
 CHECK((revision=1)=(previous_digest IS NULL)),
 CHECK((kind='departure' AND group_id IS NOT NULL AND quote_id IS NULL) OR (kind='plan' AND group_id IS NULL AND quote_id=entity_id))
);
CREATE TABLE ls_fishing_billing.fulfillment_heads (
 workspace_id uuid NOT NULL,kind text NOT NULL,entity_id uuid NOT NULL,revision integer NOT NULL,record_digest text NOT NULL,
 PRIMARY KEY(workspace_id,kind,entity_id),
 FOREIGN KEY(workspace_id,kind,entity_id,revision,record_digest)
  REFERENCES ls_fishing_billing.fulfillment_versions(workspace_id,kind,entity_id,revision,record_digest)
);
CREATE FUNCTION ls_fishing_billing.protect_fulfillment_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'FISHING_FULFILLMENT_IMMUTABLE' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER fulfillment_version_no_change BEFORE UPDATE OR DELETE ON ls_fishing_billing.fulfillment_versions
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.protect_fulfillment_history();
CREATE TRIGGER fulfillment_version_no_truncate BEFORE TRUNCATE ON ls_fishing_billing.fulfillment_versions
 FOR EACH STATEMENT EXECUTE FUNCTION ls_fishing_billing.protect_fulfillment_history();
CREATE TRIGGER fulfillment_head_no_delete BEFORE DELETE OR TRUNCATE ON ls_fishing_billing.fulfillment_heads
 FOR EACH STATEMENT EXECUTE FUNCTION ls_fishing_billing.protect_fulfillment_history();
CREATE FUNCTION ls_fishing_billing.advance_fulfillment_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN IF NEW.revision=1 THEN RETURN NEW; END IF;
 ELSIF NEW.workspace_id=OLD.workspace_id AND NEW.kind=OLD.kind AND NEW.entity_id=OLD.entity_id AND NEW.revision=OLD.revision+1
  AND EXISTS(SELECT 1 FROM ls_fishing_billing.fulfillment_versions v WHERE v.workspace_id=NEW.workspace_id AND v.kind=NEW.kind
   AND v.entity_id=NEW.entity_id AND v.revision=NEW.revision AND v.record_digest=NEW.record_digest AND v.previous_digest=OLD.record_digest)
 THEN RETURN NEW;
 END IF;
 RAISE EXCEPTION 'FISHING_FULFILLMENT_HEAD_CONFLICT' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER fulfillment_head_monotonic BEFORE INSERT OR UPDATE ON ls_fishing_billing.fulfillment_heads
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.advance_fulfillment_head();
REVOKE ALL ON ls_fishing_billing.fulfillment_versions,ls_fishing_billing.fulfillment_heads FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_fishing_billing.protect_fulfillment_history(),ls_fishing_billing.advance_fulfillment_head() FROM PUBLIC;
