-- LS-030 only. Requires 0001 + 0010. Run through the shared transactional registry.
-- No identity, billing or therapeutic-report tables are created or rewritten.
CREATE SCHEMA ls_calendar;
CREATE SCHEMA ls_attendance;
CREATE TABLE ls_calendar.availability (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 practitioner_id uuid NOT NULL, starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 kind text NOT NULL CHECK (kind IN ('open','blocked')), active boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,practitioner_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(ends_at>starts_at AND ends_at-starts_at<=interval '31 days'), UNIQUE(workspace_id,id)
);
CREATE INDEX availability_window ON ls_calendar.availability(workspace_id,practitioner_id,starts_at,ends_at) WHERE active;
CREATE TABLE ls_calendar.appointments (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, audience_id uuid NOT NULL,
 engagement_id uuid NOT NULL, practitioner_id uuid NOT NULL, terms_version text NOT NULL CHECK(length(terms_version) BETWEEN 1 AND 100),
 kind text NOT NULL CHECK(kind IN ('individual','parent_guidance')),
 starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 status text NOT NULL DEFAULT 'scheduled' CHECK(status IN ('scheduled','completed','canceled_family','canceled_practitioner','rescheduled')),
 parent_for_id uuid, original_id uuid, parent_ids uuid[] NOT NULL DEFAULT '{}',
 buffer_before integer NOT NULL CHECK(buffer_before BETWEEN 0 AND 120),
 buffer_after integer NOT NULL CHECK(buffer_after BETWEEN 0 AND 120),
 location_ciphertext text NOT NULL, checkin_exception_ciphertext text,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), created_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,audience_id) REFERENCES ls_cases.audiences(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,engagement_id) REFERENCES ls_cases.engagements(workspace_id,id),
 FOREIGN KEY(workspace_id,practitioner_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,parent_for_id) REFERENCES ls_calendar.appointments(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id,original_id) REFERENCES ls_calendar.appointments(workspace_id,case_id,id),
 CHECK((kind='individual' AND ends_at-starts_at=interval '60 minutes' AND parent_for_id IS NULL AND cardinality(parent_ids)=0)
    OR (kind='parent_guidance' AND ends_at-starts_at=interval '15 minutes' AND parent_for_id IS NOT NULL AND cardinality(parent_ids) BETWEEN 1 AND 2)),
 CHECK(parent_for_id IS DISTINCT FROM id AND original_id IS DISTINCT FROM id)
);
CREATE INDEX appointment_agenda ON ls_calendar.appointments(workspace_id,starts_at,id);
CREATE INDEX appointment_case_agenda ON ls_calendar.appointments(workspace_id,case_id,starts_at,id);
CREATE UNIQUE INDEX one_live_checkin_per_child ON ls_calendar.appointments(workspace_id,parent_for_id) WHERE kind='parent_guidance' AND status='scheduled';
CREATE UNIQUE INDEX one_replacement_per_original ON ls_calendar.appointments(workspace_id,original_id) WHERE original_id IS NOT NULL;
CREATE TABLE ls_calendar.notices (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, appointment_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('cancel','reschedule')),
 source text NOT NULL CHECK(source IN ('app','phone','whatsapp_manual')),
 received_at timestamptz NOT NULL, recorded_at timestamptz NOT NULL,
 original_start timestamptz NOT NULL, notice_milliseconds bigint NOT NULL,
 requested_by uuid NOT NULL, entered_by uuid NOT NULL, terms_version text NOT NULL,
 eligibility text NOT NULL CHECK(eligibility IN ('credit_preserved','late_notice')),
 state text NOT NULL CHECK(state IN ('pending','confirmed','closed')),
 replacement_id uuid, proposed_windows jsonb NOT NULL DEFAULT '[]',
 UNIQUE(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id,appointment_id) REFERENCES ls_calendar.appointments(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id,replacement_id) REFERENCES ls_calendar.appointments(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,requested_by) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,entered_by) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(received_at<=recorded_at),
 CHECK(notice_milliseconds=round(extract(epoch FROM (original_start-received_at))*1000)),
 CHECK((notice_milliseconds>=86400000 AND eligibility='credit_preserved') OR (notice_milliseconds<86400000 AND eligibility='late_notice')),
 CHECK((state='confirmed' AND replacement_id IS NOT NULL AND kind='reschedule') OR (state<>'confirmed' AND replacement_id IS NULL)),
 CHECK(jsonb_typeof(proposed_windows)='array' AND jsonb_array_length(proposed_windows)<=3)
);
CREATE INDEX notice_earliest ON ls_calendar.notices(workspace_id,appointment_id,received_at,id);
CREATE TABLE ls_calendar.credit_exceptions (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, appointment_id uuid NOT NULL,
 reason_code text NOT NULL CHECK(reason_code IN ('practitioner_exception','provider_unavailable')),
 reason_ciphertext text NOT NULL, recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL,
 UNIQUE(workspace_id,appointment_id),
 FOREIGN KEY(workspace_id,case_id,appointment_id) REFERENCES ls_calendar.appointments(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,recorded_by) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_attendance.records (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, appointment_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('present','late','no_show','canceled')),
 attended boolean NOT NULL, arrived_at timestamptz, version integer NOT NULL CHECK(version>0),
 recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,appointment_id),
 FOREIGN KEY(workspace_id,case_id,appointment_id) REFERENCES ls_calendar.appointments(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,recorded_by) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(attended=(state IN ('present','late'))), CHECK((attended AND arrived_at IS NOT NULL) OR (NOT attended AND arrived_at IS NULL))
);
CREATE TABLE ls_attendance.history (
 workspace_id uuid NOT NULL, case_id uuid NOT NULL, appointment_id uuid NOT NULL, version integer NOT NULL,
 state text NOT NULL CHECK(state IN ('present','late','no_show','canceled')), attended boolean NOT NULL,
 arrived_at timestamptz, recorded_by uuid NOT NULL, recorded_at timestamptz NOT NULL,
 correction_ciphertext text, PRIMARY KEY(workspace_id,appointment_id,version),
 FOREIGN KEY(workspace_id,case_id,appointment_id) REFERENCES ls_calendar.appointments(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,recorded_by) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK(attended=(state IN ('present','late'))), CHECK(version=1 OR correction_ciphertext IS NOT NULL)
);
CREATE TABLE ls_calendar.events (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, appointment_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence>0), topic text NOT NULL CHECK(topic IN ('notice_received','credit_effect','attendance_recorded','appointment_changed')),
 event_key text NOT NULL CHECK(length(event_key)<=160), payload jsonb NOT NULL,
 created_at timestamptz NOT NULL, delivered_at timestamptz,
 UNIQUE(workspace_id,event_key), UNIQUE(workspace_id,appointment_id,sequence),
 FOREIGN KEY(workspace_id,case_id,appointment_id) REFERENCES ls_calendar.appointments(workspace_id,case_id,id),
 CHECK(jsonb_typeof(payload)='object')
);
CREATE INDEX calendar_pending_events ON ls_calendar.events(workspace_id,appointment_id,sequence) WHERE delivered_at IS NULL;
CREATE TABLE ls_calendar.commands (
 workspace_id uuid NOT NULL, account_id uuid NOT NULL, operation text NOT NULL,
 command_key text NOT NULL CHECK(length(command_key) BETWEEN 16 AND 100),
 body_digest text NOT NULL CHECK(body_digest ~ '^[0-9a-f]{64}$'),
 result_ciphertext text NOT NULL, created_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,account_id,operation,command_key),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_calendar.history (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid, appointment_id uuid,
 action text NOT NULL CHECK(action IN ('booked','notice_received','notice_resolved','logistics_changed','provider_canceled','credit_exception','availability_changed')),
 actor_id uuid NOT NULL, recorded_at timestamptz NOT NULL, reason_ciphertext text,
 FOREIGN KEY(workspace_id,actor_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,appointment_id) REFERENCES ls_calendar.appointments(workspace_id,case_id,id)
);
-- Serialize writes with the same workspace lock used by the identity owner.
-- This avoids a case-revocation/appointment write race without creating a second identity system.
CREATE FUNCTION ls_calendar.guard_appointment() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE c record; e record; parent_kind text; participant uuid;
BEGIN
 PERFORM id FROM ls_identity.workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 SELECT * INTO c FROM ls_cases.cases WHERE workspace_id=NEW.workspace_id AND id=NEW.case_id;
 SELECT * INTO e FROM ls_cases.engagements WHERE workspace_id=NEW.workspace_id AND id=NEW.engagement_id;
 IF c.practitioner_account_id IS DISTINCT FROM NEW.practitioner_id OR e.case_id IS DISTINCT FROM NEW.case_id OR e.terms_version IS DISTINCT FROM NEW.terms_version THEN RAISE EXCEPTION 'calendar_scope' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (NEW.id,NEW.workspace_id,NEW.case_id,NEW.engagement_id,NEW.audience_id,NEW.kind,NEW.starts_at,NEW.ends_at,NEW.parent_for_id,NEW.original_id,NEW.parent_ids,NEW.created_by,NEW.created_at,NEW.terms_version)
 IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.case_id,OLD.engagement_id,OLD.audience_id,OLD.kind,OLD.starts_at,OLD.ends_at,OLD.parent_for_id,OLD.original_id,OLD.parent_ids,OLD.created_by,OLD.created_at,OLD.terms_version) THEN RAISE EXCEPTION 'immutable_booking' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.parent_for_id IS NOT NULL THEN
   SELECT kind INTO parent_kind FROM ls_calendar.appointments WHERE workspace_id=NEW.workspace_id AND case_id=NEW.case_id AND id=NEW.parent_for_id;
   IF parent_kind IS DISTINCT FROM 'individual' THEN RAISE EXCEPTION 'invalid_checkin_link' USING ERRCODE='23514'; END IF;
  END IF;
  IF cardinality(NEW.parent_ids)<>(SELECT count(DISTINCT x) FROM unnest(NEW.parent_ids) x) THEN RAISE EXCEPTION 'duplicate_participant' USING ERRCODE='23514'; END IF;
  FOREACH participant IN ARRAY NEW.parent_ids LOOP
   IF NOT EXISTS(SELECT 1 FROM ls_cases.case_guardians g JOIN ls_identity.accounts a ON a.workspace_id=g.workspace_id AND a.id=g.account_id
    JOIN ls_cases.audience_accounts aa ON aa.workspace_id=g.workspace_id AND aa.case_id=g.case_id AND aa.account_id=g.account_id AND aa.audience_id=NEW.audience_id AND aa.revoked_at IS NULL
    WHERE g.workspace_id=NEW.workspace_id AND g.case_id=NEW.case_id AND g.account_id=participant AND g.revoked_at IS NULL AND a.state='active' AND a.role='parent')
   THEN RAISE EXCEPTION 'invalid_participant' USING ERRCODE='23514'; END IF;
  END LOOP;
 END IF;
 IF NEW.status='scheduled' THEN
  IF EXISTS(SELECT 1 FROM ls_calendar.appointments a WHERE a.workspace_id=NEW.workspace_id AND a.practitioner_id=NEW.practitioner_id AND a.id<>NEW.id AND a.status='scheduled'
   AND a.starts_at-a.buffer_before*interval '1 minute'<NEW.ends_at+NEW.buffer_after*interval '1 minute'
   AND NEW.starts_at-NEW.buffer_before*interval '1 minute'<a.ends_at+a.buffer_after*interval '1 minute') THEN RAISE EXCEPTION 'slot_conflict' USING ERRCODE='23P01'; END IF;
  IF NOT EXISTS(SELECT 1 FROM ls_calendar.availability v WHERE v.workspace_id=NEW.workspace_id AND v.practitioner_id=NEW.practitioner_id AND v.active AND v.kind='open'
   AND v.starts_at<=NEW.starts_at-NEW.buffer_before*interval '1 minute' AND v.ends_at>=NEW.ends_at+NEW.buffer_after*interval '1 minute')
   OR EXISTS(SELECT 1 FROM ls_calendar.availability v WHERE v.workspace_id=NEW.workspace_id AND v.practitioner_id=NEW.practitioner_id AND v.active AND v.kind='blocked'
   AND v.starts_at<NEW.ends_at+NEW.buffer_after*interval '1 minute' AND NEW.starts_at-NEW.buffer_before*interval '1 minute'<v.ends_at)
  THEN RAISE EXCEPTION 'outside_availability' USING ERRCODE='23P01'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER calendar_booking_guard BEFORE INSERT OR UPDATE ON ls_calendar.appointments FOR EACH ROW EXECUTE FUNCTION ls_calendar.guard_appointment();
CREATE FUNCTION ls_calendar.immutable_notice() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable_notice' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.workspace_id,NEW.case_id,NEW.appointment_id,NEW.kind,NEW.source,NEW.received_at,NEW.recorded_at,NEW.original_start,NEW.notice_milliseconds,NEW.requested_by,NEW.entered_by,NEW.terms_version,NEW.eligibility,NEW.proposed_windows)
 IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.case_id,OLD.appointment_id,OLD.kind,OLD.source,OLD.received_at,OLD.recorded_at,OLD.original_start,OLD.notice_milliseconds,OLD.requested_by,OLD.entered_by,OLD.terms_version,OLD.eligibility,OLD.proposed_windows)
 THEN RAISE EXCEPTION 'immutable_notice' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preserve_notice BEFORE UPDATE OR DELETE ON ls_calendar.notices FOR EACH ROW EXECUTE FUNCTION ls_calendar.immutable_notice();
CREATE FUNCTION ls_calendar.append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN RAISE EXCEPTION 'append_only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER attendance_history_immutable BEFORE UPDATE OR DELETE ON ls_attendance.history FOR EACH ROW EXECUTE FUNCTION ls_calendar.append_only();
CREATE TRIGGER calendar_history_immutable BEFORE UPDATE OR DELETE ON ls_calendar.history FOR EACH ROW EXECUTE FUNCTION ls_calendar.append_only();
CREATE TRIGGER exception_immutable BEFORE UPDATE OR DELETE ON ls_calendar.credit_exceptions FOR EACH ROW EXECUTE FUNCTION ls_calendar.append_only();
CREATE TRIGGER command_immutable BEFORE UPDATE OR DELETE ON ls_calendar.commands FOR EACH ROW EXECUTE FUNCTION ls_calendar.append_only();
CREATE FUNCTION ls_calendar.guard_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable_event' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.workspace_id,NEW.case_id,NEW.appointment_id,NEW.sequence,NEW.topic,NEW.event_key,NEW.payload,NEW.created_at) IS DISTINCT FROM
 (OLD.id,OLD.workspace_id,OLD.case_id,OLD.appointment_id,OLD.sequence,OLD.topic,OLD.event_key,OLD.payload,OLD.created_at)
 OR (OLD.delivered_at IS NOT NULL AND NEW.delivered_at IS DISTINCT FROM OLD.delivered_at)
 THEN RAISE EXCEPTION 'immutable_event' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER calendar_event_immutable BEFORE UPDATE OR DELETE ON ls_calendar.events FOR EACH ROW EXECUTE FUNCTION ls_calendar.guard_event();
REVOKE ALL ON SCHEMA ls_calendar,ls_attendance FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ls_calendar,ls_attendance FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ls_calendar FROM PUBLIC;
