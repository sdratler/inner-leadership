-- One durable owner-only notification for each saved Fishing Academy form.
-- Parent transactional mail remains a separate purpose and authorization lane.
ALTER TABLE ls_service_interest.inquiry_email_outbox
 DROP CONSTRAINT inquiry_email_outbox_purpose_check;

ALTER TABLE ls_service_interest.inquiry_email_outbox
 ADD CONSTRAINT inquiry_email_outbox_purpose_check CHECK(
  purpose='academy_inquiry_acknowledgment_v1'
  OR purpose IN(
   'academy_founder_interest','academy_founder_ack','academy_founder_offer',
   'academy_founder_interest_reminder','academy_founder_payment_reminder',
   'academy_founder_interest_deadline_receipt','academy_founder_payment_deadline_receipt',
   'academy_owner_signup_notification'
  )
 );

CREATE UNIQUE INDEX inquiry_email_owner_signup_once
 ON ls_service_interest.inquiry_email_outbox(workspace_id,application_id)
 WHERE purpose='academy_owner_signup_notification';
