-- ADDITIVE UNNUMBERED PROPOSAL ONLY. Not in the migration manifest; not applied.
-- Existing inquiry, founder and owner-notification purposes remain unchanged.
-- Root must bind a reviewed numbered migration to actual target/readiness.
ALTER TABLE ls_service_interest.inquiry_email_outbox
 ADD COLUMN monthly_receipt_ciphertext text;
ALTER TABLE ls_service_interest.inquiry_email_outbox
 DROP CONSTRAINT inquiry_email_outbox_purpose_check;
ALTER TABLE ls_service_interest.inquiry_email_outbox
 ADD CONSTRAINT inquiry_email_outbox_purpose_check CHECK(
  purpose='academy_inquiry_acknowledgment_v1'
  OR purpose IN(
   'academy_founder_interest','academy_founder_ack','academy_founder_offer',
   'academy_founder_interest_reminder','academy_founder_payment_reminder',
   'academy_founder_interest_deadline_receipt','academy_founder_payment_deadline_receipt',
   'academy_owner_signup_notification','academy_monthly_payment_reminder_v1'
  )
 );
ALTER TABLE ls_service_interest.inquiry_email_outbox
 ADD CONSTRAINT monthly_reminder_dispatch_identity CHECK(
  purpose<>'academy_monthly_payment_reminder_v1'
  OR (founder_id IS NULL AND message_key IS NOT NULL AND message_key='monthly:'||id::text
   AND (state<>'sent' OR (monthly_receipt_ciphertext IS NOT NULL AND length(monthly_receipt_ciphertext)>0)))
 );
CREATE UNIQUE INDEX monthly_reminder_dispatch_once
 ON ls_service_interest.inquiry_email_outbox(workspace_id,purpose,message_key)
 WHERE purpose='academy_monthly_payment_reminder_v1';
