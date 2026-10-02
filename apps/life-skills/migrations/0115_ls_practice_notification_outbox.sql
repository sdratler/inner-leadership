-- Forward, neutral metadata only. No historical clocks, messages or provider effects.
CREATE SCHEMA ls_notifications;
REVOKE ALL ON SCHEMA ls_notifications FROM PUBLIC;
CREATE TABLE ls_notifications.notification_outbox (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, case_id uuid NOT NULL, audience_id uuid NOT NULL,
 occurrence_id uuid NOT NULL, recipient_account_id uuid NOT NULL, source_id uuid NOT NULL,
 source_version_id uuid NOT NULL, coordination_version_id uuid NOT NULL,
 message_key text NOT NULL CHECK(message_key='practice_due'),
 purpose text NOT NULL CHECK(purpose IN ('self','support','remind_child')),
 channel text NOT NULL CHECK(channel IN ('in_app','email','push','whatsapp')),
 due_at timestamptz NOT NULL CHECK(isfinite(due_at)),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
 state text NOT NULL CHECK(state IN ('queued','available','blocked','suppressed','expired')),
 reason text CHECK(reason IN ('provider_not_configured','channel_not_verified','do_not_disturb','opted_out',
  'completed','cancelled','stale_source','revoked','inactive','expired','demo_external_denied')),
 next_attempt_at timestamptz NOT NULL CHECK(isfinite(next_attempt_at)), attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 1),
 created_at timestamptz NOT NULL CHECK(isfinite(created_at)), updated_at timestamptz NOT NULL CHECK(isfinite(updated_at)), available_at timestamptz, read_at timestamptz,
 UNIQUE(workspace_id,id), UNIQUE(workspace_id,idempotency_key),
 UNIQUE(workspace_id,occurrence_id,recipient_account_id,channel),
 FOREIGN KEY(workspace_id,case_id,audience_id) REFERENCES ls_cases.audiences(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,recipient_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,occurrence_id) REFERENCES ls_practice.practice_occurrences(workspace_id,id),
 FOREIGN KEY(workspace_id,source_id) REFERENCES ls_practice.practice_assignments(workspace_id,id),
 FOREIGN KEY(workspace_id,source_version_id) REFERENCES ls_practice.practice_assignment_versions(workspace_id,id),
 FOREIGN KEY(workspace_id,coordination_version_id) REFERENCES ls_practice.task_coordination_versions(workspace_id,id),
 CHECK(state<>'available' OR (channel='in_app' AND available_at IS NOT NULL AND attempts=1)),
 CHECK((available_at IS NULL AND attempts=0) OR (available_at IS NOT NULL AND attempts=1 AND channel='in_app')),
 CHECK(available_at IS NULL OR (isfinite(available_at) AND available_at>=due_at AND available_at<=due_at+interval '1 hour')),
 CHECK(read_at IS NULL OR (isfinite(read_at) AND available_at IS NOT NULL AND read_at>=available_at AND read_at<=updated_at)),
 CHECK(created_at<=updated_at),
 CHECK(reason IS NOT NULL OR state IN ('queued','available')),
 CHECK((state='queued' AND reason IS NULL)
  OR (state='available' AND reason IS NULL)
  OR (state='blocked' AND channel<>'in_app' AND reason IN ('provider_not_configured','channel_not_verified','do_not_disturb','demo_external_denied'))
  OR (state='suppressed' AND reason IN ('opted_out','completed','cancelled','stale_source','revoked','inactive'))
  OR (state='expired' AND reason='expired'))
);
CREATE INDEX practice_notice_due ON ls_notifications.notification_outbox(workspace_id,next_attempt_at,id)
  WHERE state IN ('queued','blocked','available');
CREATE INDEX practice_notice_recipient ON ls_notifications.notification_outbox(workspace_id,recipient_account_id,due_at,id);
CREATE TABLE ls_notifications.message_deliveries (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, outbox_id uuid NOT NULL,
 channel text NOT NULL CHECK(channel='in_app'), provider text NOT NULL CHECK(provider='in_app'),
 recorded_at timestamptz NOT NULL CHECK(isfinite(recorded_at)), UNIQUE(workspace_id,outbox_id),
 FOREIGN KEY(workspace_id,outbox_id) REFERENCES ls_notifications.notification_outbox(workspace_id,id)
);
REVOKE ALL ON ALL TABLES IN SCHEMA ls_notifications FROM PUBLIC;

CREATE FUNCTION ls_notifications.check_practice_notice_scope()
RETURNS trigger LANGUAGE plpgsql AS $fn$
DECLARE expected_purpose text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'LS_NOTICE_EVIDENCE_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(OLD)-ARRAY['state','reason','next_attempt_at','attempts','updated_at','available_at','read_at'])
   IS DISTINCT FROM (to_jsonb(NEW)-ARRAY['state','reason','next_attempt_at','attempts','updated_at','available_at','read_at'])
   OR (OLD.available_at IS NOT NULL AND NEW.available_at IS DISTINCT FROM OLD.available_at)
   OR (OLD.read_at IS NOT NULL AND NEW.read_at IS DISTINCT FROM OLD.read_at)
   OR (OLD.state IN ('suppressed','expired') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD))
   OR NEW.updated_at<OLD.updated_at
   OR (OLD.state='available' AND NEW.state NOT IN ('available','suppressed')) THEN
   RAISE EXCEPTION 'LS_NOTICE_EVIDENCE_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF NEW.state='available' AND NOT EXISTS(SELECT 1 FROM ls_notifications.message_deliveries d
   WHERE d.workspace_id=NEW.workspace_id AND d.outbox_id=NEW.id AND d.recorded_at=NEW.available_at) THEN
   RAISE EXCEPTION 'LS_NOTICE_RECEIPT_REQUIRED' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 SELECT coalesce((SELECT value->>'purpose' FROM jsonb_array_elements(v.responsibility->'reminderRecipients')
  WHERE value->>'accountId'=NEW.recipient_account_id::text),
  CASE WHEN NEW.recipient_account_id=ANY(c.assignee_account_ids) THEN 'self' END)
 INTO expected_purpose
 FROM ls_practice.practice_occurrences o
 JOIN ls_practice.practice_assignments a ON a.workspace_id=o.workspace_id AND a.id=o.assignment_id
 JOIN ls_practice.practice_assignment_versions v ON v.workspace_id=a.workspace_id AND v.assignment_id=a.id AND v.id=o.practice_version_id
 JOIN ls_practice.task_coordination_versions c ON c.workspace_id=o.workspace_id AND c.id=o.coordination_version_id
  AND c.assignment_id=a.id AND c.case_id=a.case_id AND c.audience_id=a.audience_id AND c.responsibility_version_id=v.id
 WHERE o.workspace_id=NEW.workspace_id AND o.id=NEW.occurrence_id AND o.occurs_at=NEW.due_at
  AND a.case_id=NEW.case_id AND a.audience_id=NEW.audience_id AND a.id=NEW.source_id
  AND v.id=NEW.source_version_id AND v.responsibility IS NOT NULL AND c.id=NEW.coordination_version_id
   AND o.state='open' AND a.state='published' AND v.state='published' AND a.active_version_id=v.id
   AND NEW.recipient_account_id=ANY(c.reminder_candidate_account_ids);
 IF NOT FOUND OR expected_purpose IS DISTINCT FROM NEW.purpose
  OR NEW.idempotency_key IS DISTINCT FROM 'practice_due:'||NEW.occurrence_id::text||':'||NEW.recipient_account_id::text||':'||NEW.channel
   OR NEW.state<>'queued' OR NEW.reason IS NOT NULL OR NEW.next_attempt_at IS DISTINCT FROM NEW.due_at
   OR NEW.updated_at IS DISTINCT FROM NEW.created_at OR NEW.attempts<>0 OR NEW.available_at IS NOT NULL OR NEW.read_at IS NOT NULL THEN
  RAISE EXCEPTION 'LS_NOTICE_SOURCE_INVALID' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER check_practice_notice_scope BEFORE INSERT OR UPDATE OR DELETE ON ls_notifications.notification_outbox
 FOR EACH ROW EXECUTE FUNCTION ls_notifications.check_practice_notice_scope();
CREATE FUNCTION ls_notifications.preserve_delivery_evidence()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 RAISE EXCEPTION 'LS_NOTICE_DELIVERY_IMMUTABLE' USING ERRCODE='23514';
END;
$fn$;
CREATE TRIGGER preserve_delivery_evidence BEFORE UPDATE OR DELETE ON ls_notifications.message_deliveries
 FOR EACH ROW EXECUTE FUNCTION ls_notifications.preserve_delivery_evidence();
CREATE FUNCTION ls_notifications.check_delivery_scope()
RETURNS trigger LANGUAGE plpgsql AS $fn$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM ls_notifications.notification_outbox o WHERE o.workspace_id=NEW.workspace_id
  AND o.id=NEW.outbox_id AND o.channel='in_app' AND o.state='queued'
  AND NEW.recorded_at>=o.due_at AND NEW.recorded_at<=o.due_at+interval '1 hour') THEN
  RAISE EXCEPTION 'LS_NOTICE_DELIVERY_SCOPE_INVALID' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
CREATE TRIGGER check_delivery_scope BEFORE INSERT ON ls_notifications.message_deliveries
 FOR EACH ROW EXECUTE FUNCTION ls_notifications.check_delivery_scope();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ls_notifications FROM PUBLIC;
