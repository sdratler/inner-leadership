-- Additive intake-to-payment/booking correlation. The Sheet remains an admin
-- projection; only authenticated provider allocations can make payment verified.
CREATE TABLE ls_onboarding.prospect_journeys (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 stable_lead_ref text NOT NULL CHECK(stable_lead_ref ~ '^LS-(LEAD|WAPI)-[A-Za-z0-9_-]+$'),
 intake_receipt_id uuid NOT NULL,
 first_session_order_id text,
 account_id uuid,
 confirmed_appointment_id uuid,
 state text NOT NULL CHECK(state IN ('intake_submitted','awaiting_payment','payment_verified','awaiting_booking','active','hold')),
 created_at timestamptz NOT NULL,
 updated_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,stable_lead_ref),
 UNIQUE(workspace_id,intake_receipt_id),
 FOREIGN KEY(workspace_id,intake_receipt_id) REFERENCES ls_intake.pre_enrollment_receipts(workspace_id,receipt_id),
 FOREIGN KEY(workspace_id,first_session_order_id) REFERENCES ls_onboarding.first_session_orders(workspace_id,order_id),
 FOREIGN KEY(workspace_id,account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,confirmed_appointment_id) REFERENCES ls_calendar.appointments(workspace_id,id)
);
CREATE TABLE ls_onboarding.prospect_journey_history (
 event_id uuid PRIMARY KEY, workspace_id uuid NOT NULL, stable_lead_ref text NOT NULL,
 state text NOT NULL, event_key text NOT NULL, actor_account_id uuid,
 occurred_at timestamptz NOT NULL,
 UNIQUE(workspace_id,event_key),
 FOREIGN KEY(workspace_id,stable_lead_ref) REFERENCES ls_onboarding.prospect_journeys(workspace_id,stable_lead_ref)
);
CREATE INDEX prospect_journeys_state_idx ON ls_onboarding.prospect_journeys(workspace_id,state,updated_at);
REVOKE ALL ON ls_onboarding.prospect_journeys FROM PUBLIC;
REVOKE ALL ON ls_onboarding.prospect_journey_history FROM PUBLIC;
