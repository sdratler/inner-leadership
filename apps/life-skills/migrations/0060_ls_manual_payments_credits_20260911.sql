-- LS-060. Requires 0001,0010,0030. Apply only through the shared transactional migration registry.
-- Integer ILS minor units; manual ledger only. No card processor, renewal, invoice generation or 12-session debt.
CREATE SCHEMA ls_payments;
CREATE TABLE ls_payments.charges (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,case_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind='four_appointment_block'),amount_minor integer NOT NULL CHECK(amount_minor=220000),
 currency text NOT NULL CHECK(currency='ILS'),status text NOT NULL CHECK(status IN ('open','paid')),due_on date NOT NULL,
 created_by uuid NOT NULL,created_at timestamptz NOT NULL,paid_at timestamptz,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id) REFERENCES ls_identity.workspaces(id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,created_by) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK((status='open' AND paid_at IS NULL) OR (status='paid' AND paid_at IS NOT NULL))
);
CREATE TABLE ls_payments.payments (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,case_id uuid NOT NULL,amount_minor integer NOT NULL CHECK(amount_minor>0),
 currency text NOT NULL CHECK(currency='ILS'),method text NOT NULL CHECK(method IN ('cash','bank_transfer')),
 received_at timestamptz NOT NULL,reference_ciphertext text NOT NULL,recorded_by uuid NOT NULL,recorded_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id) REFERENCES ls_cases.cases(workspace_id,id),
 FOREIGN KEY(workspace_id,recorded_by) REFERENCES ls_identity.accounts(workspace_id,id),CHECK(received_at<=recorded_at+interval '5 minutes')
);
CREATE TABLE ls_payments.allocations (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,case_id uuid NOT NULL,payment_id uuid NOT NULL,charge_id uuid NOT NULL,
 amount_minor integer NOT NULL CHECK(amount_minor>0),allocated_by uuid NOT NULL,allocated_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id),
 FOREIGN KEY(workspace_id,case_id,payment_id) REFERENCES ls_payments.payments(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id,charge_id) REFERENCES ls_payments.charges(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,allocated_by) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE INDEX payment_allocation_by_payment ON ls_payments.allocations(workspace_id,payment_id);
CREATE INDEX payment_allocation_by_charge ON ls_payments.allocations(workspace_id,charge_id);
CREATE TABLE ls_payments.credit_blocks (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,case_id uuid NOT NULL,charge_id uuid NOT NULL,
 credits_purchased integer NOT NULL CHECK(credits_purchased=4),purchase_amount_minor integer NOT NULL CHECK(purchase_amount_minor=220000),
 currency text NOT NULL CHECK(currency='ILS'),terms_version text NOT NULL CHECK(terms_version='Product2.3'),purchased_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,case_id,id),UNIQUE(workspace_id,charge_id),
 FOREIGN KEY(workspace_id,case_id,charge_id) REFERENCES ls_payments.charges(workspace_id,case_id,id)
);
CREATE TABLE ls_payments.credit_events (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,case_id uuid NOT NULL,credit_block_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('purchase','consume','restore','refund')),delta_credits integer NOT NULL,value_minor integer NOT NULL,
 appointment_id uuid,reschedule_request_id uuid,event_key text NOT NULL CHECK(length(event_key) BETWEEN 16 AND 160),
 reason_code text NOT NULL CHECK(length(reason_code) BETWEEN 1 AND 80),actor_account_id uuid NOT NULL,occurred_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,event_key),
 FOREIGN KEY(workspace_id,case_id,credit_block_id) REFERENCES ls_payments.credit_blocks(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id,appointment_id) REFERENCES ls_calendar.appointments(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,case_id,reschedule_request_id) REFERENCES ls_calendar.notices(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 CHECK((kind='purchase' AND delta_credits=4 AND value_minor=220000 AND appointment_id IS NULL AND reschedule_request_id IS NULL)
  OR (kind='consume' AND delta_credits=-1 AND value_minor=-55000 AND appointment_id IS NOT NULL)
  OR (kind='restore' AND delta_credits=1 AND value_minor=55000 AND appointment_id IS NOT NULL)
  OR (kind='refund' AND delta_credits BETWEEN -4 AND -1 AND value_minor=delta_credits*55000 AND appointment_id IS NULL AND reschedule_request_id IS NULL))
);
CREATE UNIQUE INDEX one_credit_purchase_per_block ON ls_payments.credit_events(workspace_id,credit_block_id) WHERE kind='purchase';
CREATE UNIQUE INDEX one_credit_consume_per_appointment ON ls_payments.credit_events(workspace_id,appointment_id) WHERE kind='consume';
CREATE UNIQUE INDEX one_credit_restore_per_appointment ON ls_payments.credit_events(workspace_id,appointment_id) WHERE kind='restore';
CREATE INDEX credit_event_case_timeline ON ls_payments.credit_events(workspace_id,case_id,occurred_at,id);
CREATE TABLE ls_payments.refunds (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,case_id uuid NOT NULL,credit_block_id uuid NOT NULL,
 credits integer NOT NULL CHECK(credits BETWEEN 1 AND 4),amount_minor integer NOT NULL CHECK(amount_minor=credits*55000),
 currency text NOT NULL CHECK(currency='ILS'),reason_ciphertext text NOT NULL,recorded_by uuid NOT NULL,recorded_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id),FOREIGN KEY(workspace_id,case_id,credit_block_id) REFERENCES ls_payments.credit_blocks(workspace_id,case_id,id),
 FOREIGN KEY(workspace_id,recorded_by) REFERENCES ls_identity.accounts(workspace_id,id)
);
CREATE TABLE ls_payments.calendar_receipts (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,case_id uuid NOT NULL,appointment_id uuid NOT NULL,
 calendar_event_id uuid NOT NULL REFERENCES ls_calendar.events(id),calendar_sequence integer NOT NULL CHECK(calendar_sequence>0),
 event_key text NOT NULL CHECK(length(event_key) BETWEEN 16 AND 160),effect text NOT NULL CHECK(effect IN ('consume','restore','preserve')),
 event_digest text NOT NULL CHECK(event_digest ~ '^[0-9a-f]{64}$'),applied_at timestamptz NOT NULL,
 UNIQUE(workspace_id,id),UNIQUE(workspace_id,event_key),UNIQUE(workspace_id,calendar_event_id),
 FOREIGN KEY(workspace_id,case_id,appointment_id) REFERENCES ls_calendar.appointments(workspace_id,case_id,id)
);
CREATE TABLE ls_payments.commands (
 workspace_id uuid NOT NULL,account_id uuid NOT NULL,operation text NOT NULL CHECK(length(operation) BETWEEN 1 AND 80),
 command_key text NOT NULL CHECK(length(command_key) BETWEEN 16 AND 100),body_digest text NOT NULL CHECK(body_digest ~ '^[0-9a-f]{64}$'),
 result_json jsonb NOT NULL,created_at timestamptz NOT NULL,PRIMARY KEY(workspace_id,account_id,operation,command_key),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id),CHECK(jsonb_typeof(result_json)='object')
);
CREATE FUNCTION ls_payments.guard_allocation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE payment_total integer;charge_total integer;payment_amount integer;charge_amount integer;
BEGIN
 PERFORM id FROM ls_identity.workspaces WHERE id=NEW.workspace_id FOR UPDATE;
 SELECT amount_minor INTO payment_amount FROM ls_payments.payments WHERE workspace_id=NEW.workspace_id AND case_id=NEW.case_id AND id=NEW.payment_id FOR UPDATE;
 SELECT amount_minor INTO charge_amount FROM ls_payments.charges WHERE workspace_id=NEW.workspace_id AND case_id=NEW.case_id AND id=NEW.charge_id AND status='open' FOR UPDATE;
 SELECT COALESCE(sum(amount_minor),0) INTO payment_total FROM ls_payments.allocations WHERE workspace_id=NEW.workspace_id AND payment_id=NEW.payment_id;
 SELECT COALESCE(sum(amount_minor),0) INTO charge_total FROM ls_payments.allocations WHERE workspace_id=NEW.workspace_id AND charge_id=NEW.charge_id;
 IF payment_amount IS NULL OR charge_amount IS NULL OR payment_total+NEW.amount_minor>payment_amount OR charge_total+NEW.amount_minor>charge_amount THEN RAISE EXCEPTION 'invalid_allocation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_allocation BEFORE INSERT ON ls_payments.allocations FOR EACH ROW EXECUTE FUNCTION ls_payments.guard_allocation();
CREATE FUNCTION ls_payments.guard_credit_event() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE current_balance integer;
BEGIN
 PERFORM id FROM ls_payments.credit_blocks WHERE workspace_id=NEW.workspace_id AND id=NEW.credit_block_id FOR UPDATE;
 SELECT COALESCE(sum(delta_credits),0) INTO current_balance FROM ls_payments.credit_events WHERE workspace_id=NEW.workspace_id AND credit_block_id=NEW.credit_block_id;
 IF current_balance+NEW.delta_credits<0 OR current_balance+NEW.delta_credits>4 THEN RAISE EXCEPTION 'invalid_credit_balance' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_credit_event BEFORE INSERT ON ls_payments.credit_events FOR EACH ROW EXECUTE FUNCTION ls_payments.guard_credit_event();
CREATE FUNCTION ls_payments.guard_charge_update() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable_charge' USING ERRCODE='23514'; END IF;
 IF (NEW.id,NEW.workspace_id,NEW.case_id,NEW.kind,NEW.amount_minor,NEW.currency,NEW.due_on,NEW.created_by,NEW.created_at) IS DISTINCT FROM (OLD.id,OLD.workspace_id,OLD.case_id,OLD.kind,OLD.amount_minor,OLD.currency,OLD.due_on,OLD.created_by,OLD.created_at)
 OR OLD.status='paid' OR NOT(OLD.status='open' AND NEW.status='paid' AND NEW.paid_at IS NOT NULL) THEN RAISE EXCEPTION 'immutable_charge' USING ERRCODE='23514'; END IF;
 IF (SELECT COALESCE(sum(amount_minor),0) FROM ls_payments.allocations WHERE workspace_id=NEW.workspace_id AND charge_id=NEW.id)<>NEW.amount_minor THEN RAISE EXCEPTION 'unpaid_charge' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_charge_update BEFORE UPDATE OR DELETE ON ls_payments.charges FOR EACH ROW EXECUTE FUNCTION ls_payments.guard_charge_update();
CREATE FUNCTION ls_payments.append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$ BEGIN RAISE EXCEPTION 'append_only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER payment_immutable BEFORE UPDATE OR DELETE ON ls_payments.payments FOR EACH ROW EXECUTE FUNCTION ls_payments.append_only();
CREATE TRIGGER allocation_immutable BEFORE UPDATE OR DELETE ON ls_payments.allocations FOR EACH ROW EXECUTE FUNCTION ls_payments.append_only();
CREATE TRIGGER credit_block_immutable BEFORE UPDATE OR DELETE ON ls_payments.credit_blocks FOR EACH ROW EXECUTE FUNCTION ls_payments.append_only();
CREATE TRIGGER credit_event_immutable BEFORE UPDATE OR DELETE ON ls_payments.credit_events FOR EACH ROW EXECUTE FUNCTION ls_payments.append_only();
CREATE TRIGGER refund_immutable BEFORE UPDATE OR DELETE ON ls_payments.refunds FOR EACH ROW EXECUTE FUNCTION ls_payments.append_only();
CREATE TRIGGER calendar_receipt_immutable BEFORE UPDATE OR DELETE ON ls_payments.calendar_receipts FOR EACH ROW EXECUTE FUNCTION ls_payments.append_only();
CREATE TRIGGER payment_command_immutable BEFORE UPDATE OR DELETE ON ls_payments.commands FOR EACH ROW EXECUTE FUNCTION ls_payments.append_only();
REVOKE ALL ON SCHEMA ls_payments FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA ls_payments FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA ls_payments FROM PUBLIC;
