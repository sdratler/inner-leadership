-- Demo appointments remain visible in the ordinary calendar, but must never occupy
-- practitioner capacity. A demo case can only be marked before its first booking.
CREATE FUNCTION ls_demo.guard_case_marker() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
BEGIN
 PERFORM id FROM ls_identity.workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM ls_calendar.appointments WHERE workspace_id=NEW.workspace_id AND case_id=NEW.case_id)
 THEN RAISE EXCEPTION 'LS_DEMO_CASE_HAS_BOOKINGS' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER demo_case_must_be_new BEFORE INSERT ON ls_demo.cases FOR EACH ROW EXECUTE FUNCTION ls_demo.guard_case_marker();

CREATE OR REPLACE FUNCTION ls_calendar.guard_appointment() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $fn$
DECLARE c record; e record; parent_kind text; participant uuid; is_demo boolean;
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
 SELECT EXISTS(SELECT 1 FROM ls_demo.cases d WHERE d.workspace_id=NEW.workspace_id AND d.case_id=NEW.case_id) INTO is_demo;
 IF NEW.status='scheduled' AND NOT is_demo THEN
  IF EXISTS(SELECT 1 FROM ls_calendar.appointments a WHERE a.workspace_id=NEW.workspace_id AND a.practitioner_id=NEW.practitioner_id AND a.id<>NEW.id AND a.status='scheduled'
   AND NOT EXISTS(SELECT 1 FROM ls_demo.cases d WHERE d.workspace_id=a.workspace_id AND d.case_id=a.case_id)
   AND a.starts_at-a.buffer_before*interval '1 minute'<NEW.ends_at+NEW.buffer_after*interval '1 minute'
   AND NEW.starts_at-NEW.buffer_before*interval '1 minute'<a.ends_at+a.buffer_after*interval '1 minute') THEN RAISE EXCEPTION 'slot_conflict' USING ERRCODE='23P01'; END IF;
  IF NOT EXISTS(SELECT 1 FROM ls_calendar.availability v WHERE v.workspace_id=NEW.workspace_id AND v.practitioner_id=NEW.practitioner_id AND v.active AND v.kind='open'
   AND v.starts_at<=NEW.starts_at-NEW.buffer_before*interval '1 minute' AND v.ends_at>=NEW.ends_at+NEW.buffer_after*interval '1 minute')
   OR EXISTS(SELECT 1 FROM ls_calendar.availability v WHERE v.workspace_id=NEW.workspace_id AND v.practitioner_id=NEW.practitioner_id AND v.active AND v.kind='blocked'
   AND v.starts_at<NEW.ends_at+NEW.buffer_after*interval '1 minute' AND NEW.starts_at-NEW.buffer_before*interval '1 minute'<v.ends_at)
  THEN RAISE EXCEPTION 'outside_availability' USING ERRCODE='23P01'; END IF;
 END IF;
 RETURN NEW;
END;
$fn$;
