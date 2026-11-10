-- UNNUMBERED additive proposal. Disposable/synthetic admission only until the
-- existing integrator reviews, registers and separately admits this schema.
-- Actual Florida schedule/progression data, never payment/seat/activation authority.
CREATE TABLE ls_fishing_billing.program_source_versions (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 group_id uuid NOT NULL,kind text NOT NULL CHECK(kind IN ('group','lesson','progression')),source_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision>0),operation_id uuid NOT NULL,
 recorded_by uuid NOT NULL,recorded_at timestamptz(3) NOT NULL,
 request_digest text NOT NULL CHECK(request_digest~'^[a-f0-9]{64}$'),
 record_digest text NOT NULL CHECK(record_digest~'^[a-f0-9]{64}$'),
 previous_revision integer GENERATED ALWAYS AS(CASE WHEN revision>1 THEN revision-1 END) STORED,
 previous_digest text CHECK(previous_digest~'^[a-f0-9]{64}$'),payload_ciphertext text NOT NULL,
 PRIMARY KEY(workspace_id,group_id,kind,source_id,revision),UNIQUE(workspace_id,operation_id),
 UNIQUE(workspace_id,group_id,kind,source_id,revision,record_digest),
 FOREIGN KEY(workspace_id,recorded_by) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,group_id) REFERENCES ls_fishing_billing.group_preparation_heads(workspace_id,group_id),
 FOREIGN KEY(workspace_id,group_id,kind,source_id,previous_revision,previous_digest)
  REFERENCES ls_fishing_billing.program_source_versions(workspace_id,group_id,kind,source_id,revision,record_digest),
 CHECK((revision=1)=(previous_digest IS NULL)),CHECK(kind<>'group' OR source_id=group_id),
 CHECK(length(payload_ciphertext) BETWEEN 1 AND 100000)
);
CREATE TABLE ls_fishing_billing.program_source_heads (
 workspace_id uuid NOT NULL,group_id uuid NOT NULL,kind text NOT NULL,source_id uuid NOT NULL,
 revision integer NOT NULL,record_digest text NOT NULL,
 PRIMARY KEY(workspace_id,group_id,kind,source_id),
 FOREIGN KEY(workspace_id,group_id,kind,source_id,revision,record_digest)
  REFERENCES ls_fishing_billing.program_source_versions(workspace_id,group_id,kind,source_id,revision,record_digest)
);
CREATE FUNCTION ls_fishing_billing.protect_program_source_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'FISHING_PROGRAM_SOURCE_IMMUTABLE' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER program_source_version_no_change BEFORE UPDATE OR DELETE ON ls_fishing_billing.program_source_versions
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.protect_program_source_history();
CREATE TRIGGER program_source_version_no_truncate BEFORE TRUNCATE ON ls_fishing_billing.program_source_versions
 FOR EACH STATEMENT EXECUTE FUNCTION ls_fishing_billing.protect_program_source_history();
CREATE TRIGGER program_source_head_no_delete BEFORE DELETE OR TRUNCATE ON ls_fishing_billing.program_source_heads
 FOR EACH STATEMENT EXECUTE FUNCTION ls_fishing_billing.protect_program_source_history();
CREATE FUNCTION ls_fishing_billing.advance_program_source_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.revision=1 THEN RETURN NEW; END IF;
 ELSE
  IF NEW.workspace_id=OLD.workspace_id AND NEW.group_id=OLD.group_id AND NEW.kind=OLD.kind AND NEW.source_id=OLD.source_id
   AND NEW.revision=OLD.revision+1 AND EXISTS(SELECT 1 FROM ls_fishing_billing.program_source_versions v
    WHERE v.workspace_id=NEW.workspace_id AND v.group_id=NEW.group_id AND v.kind=NEW.kind AND v.source_id=NEW.source_id
     AND v.revision=NEW.revision AND v.record_digest=NEW.record_digest AND v.previous_digest=OLD.record_digest)
  THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'FISHING_PROGRAM_SOURCE_HEAD_CONFLICT' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER program_source_head_monotonic BEFORE INSERT OR UPDATE ON ls_fishing_billing.program_source_heads
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.advance_program_source_head();
REVOKE ALL ON ls_fishing_billing.program_source_versions,ls_fishing_billing.program_source_heads FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_fishing_billing.protect_program_source_history(),ls_fishing_billing.advance_program_source_head() FROM PUBLIC;
