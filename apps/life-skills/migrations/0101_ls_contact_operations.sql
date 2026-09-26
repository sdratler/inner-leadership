-- Native administrative CRM foundation. Additive only: the Sheets bridge remains the
-- live writer until a separately verified snapshot, import and receiver fence.
-- No clinical notes, provider messages or real rows are created here.
CREATE SCHEMA ls_contact_ops;

-- Existing person markers must already be canonical, and future marker inserts
-- cannot bypass exact text lookups through an uppercase UUID spelling.
ALTER TABLE ls_demo.records ADD CONSTRAINT canonical_demo_person_key
 CHECK(entity_kind<>'person' OR entity_key=entity_key::uuid::text);

CREATE TABLE ls_contact_ops.profiles (
 workspace_id uuid NOT NULL,
 person_id uuid NOT NULL,
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext)>0),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 record_mode text NOT NULL CHECK(record_mode IN ('live','demo')),
 demo_batch_id text,
 archived_at timestamptz,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,person_id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_identity.people(workspace_id,id),
 FOREIGN KEY(workspace_id,demo_batch_id) REFERENCES ls_demo.batches(workspace_id,batch_id),
 CHECK((record_mode='demo')=(demo_batch_id IS NOT NULL))
);

-- Demo provenance is a database invariant, not a display-name or request-body flag.
CREATE FUNCTION ls_contact_ops.require_profile_provenance() RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE marked_batch text;
BEGIN
 -- The reciprocal marker trigger takes the same per-person transaction lock.
 -- Neither transaction may decide from a stale absence while the other writes.
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text||':contact-person:'||NEW.person_id::text,0));
 SELECT batch_id INTO marked_batch FROM ls_demo.records
  WHERE workspace_id=NEW.workspace_id AND entity_kind='person' AND entity_key=NEW.person_id::text;
 IF (NEW.record_mode='demo' AND marked_batch IS DISTINCT FROM NEW.demo_batch_id)
    OR (NEW.record_mode='live' AND marked_batch IS NOT NULL) THEN
  RAISE EXCEPTION 'CONTACT_PROFILE_DEMO_PROVENANCE_REQUIRED' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (NEW.record_mode,NEW.demo_batch_id) IS DISTINCT FROM (OLD.record_mode,OLD.demo_batch_id) THEN
  RAISE EXCEPTION 'CONTACT_PROFILE_MODE_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER profile_provenance BEFORE INSERT OR UPDATE ON ls_contact_ops.profiles
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.require_profile_provenance();

CREATE FUNCTION ls_contact_ops.require_marker_compatibility() RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF NEW.entity_kind='person' THEN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.workspace_id::text||':contact-person:'||NEW.entity_key::uuid::text,0));
  IF EXISTS(
   SELECT 1 FROM ls_contact_ops.profiles p
    WHERE p.workspace_id=NEW.workspace_id AND p.person_id=NEW.entity_key::uuid
      AND (p.record_mode<>'demo' OR p.demo_batch_id IS DISTINCT FROM NEW.batch_id)
  ) THEN
   RAISE EXCEPTION 'CONTACT_PROFILE_DEMO_PROVENANCE_CONFLICT' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER contact_person_marker_compatibility BEFORE INSERT ON ls_demo.records
 FOR EACH ROW EXECUTE FUNCTION ls_contact_ops.require_marker_compatibility();

-- The immutable numeric sheet ID, not a mutable tab title, identifies legacy rows.
-- Full legacy snapshots and notes remain encrypted; digests are keyed by the app.
CREATE TABLE ls_contact_ops.legacy_links (
 workspace_id uuid NOT NULL,
 source_file_id text NOT NULL CHECK(length(source_file_id)>0),
 source_sheet_id integer NOT NULL CHECK(source_sheet_id>=0),
 source_tab_title text NOT NULL,
 legacy_lead_id text NOT NULL CHECK(legacy_lead_id ~ '^LS-(LEAD|WAPI)-[A-Za-z0-9_-]+$'),
 person_id uuid NOT NULL,
 source_revision text NOT NULL CHECK(length(source_revision)>0),
 row_digest text NOT NULL CHECK(row_digest ~ '^[a-f0-9]{64}$'),
 snapshot_ciphertext text NOT NULL CHECK(length(snapshot_ciphertext)>0),
 imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,source_file_id,source_sheet_id,legacy_lead_id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_contact_ops.profiles(workspace_id,person_id)
);
CREATE INDEX legacy_links_by_person ON ls_contact_ops.legacy_links(workspace_id,person_id);

CREATE TABLE ls_contact_ops.command_receipts (
 workspace_id uuid NOT NULL,
 operation_id text NOT NULL CHECK(length(operation_id) BETWEEN 1 AND 128),
 person_id uuid NOT NULL,
 actor_account_id uuid NOT NULL,
 payload_digest text NOT NULL CHECK(payload_digest ~ '^[a-f0-9]{64}$'),
 result_version integer NOT NULL CHECK(result_version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,operation_id),
 FOREIGN KEY(workspace_id,person_id) REFERENCES ls_contact_ops.profiles(workspace_id,person_id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);

REVOKE ALL ON SCHEMA ls_contact_ops FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ls_contact_ops FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ls_contact_ops FROM PUBLIC;
