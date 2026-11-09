-- Proposal only. Preserve the installed purpose predicate and admit only the
-- new signup verification purpose. Numbering and installation belong to Root.
DO $migration$
DECLARE previous_purposes text;
BEGIN
 SELECT pg_get_expr(conbin,conrelid) INTO STRICT previous_purposes
 FROM pg_constraint
 WHERE conrelid='ls_service_interest.inquiry_email_outbox'::regclass
   AND conname='inquiry_email_outbox_purpose_check' AND contype='c';
 ALTER TABLE ls_service_interest.inquiry_email_outbox DROP CONSTRAINT inquiry_email_outbox_purpose_check;
 EXECUTE format('ALTER TABLE ls_service_interest.inquiry_email_outbox ADD CONSTRAINT inquiry_email_outbox_purpose_check CHECK ((%s) OR purpose=%L)',
                previous_purposes,'fishing_inquiry_email_control_v1');
END
$migration$;

ALTER TABLE ls_service_interest.inquiry_email_outbox
 ADD COLUMN control_delivery_ciphertext text,
 ADD CONSTRAINT inquiry_email_control_envelope CHECK (
  (purpose <> 'fishing_inquiry_email_control_v1' AND control_delivery_ciphertext IS NULL)
  OR (purpose='fishing_inquiry_email_control_v1' AND founder_id IS NULL
      AND message_key IS NOT NULL AND message_key='email-control:'||id::text
      AND control_delivery_ciphertext IS NOT NULL AND length(control_delivery_ciphertext)>0)
 );
-- One parent message across the old receipt and its verified-contact successor.
-- An existing owner-notification row is independent.
CREATE UNIQUE INDEX inquiry_email_control_parent_once
 ON ls_service_interest.inquiry_email_outbox(workspace_id,application_id)
 WHERE purpose IN ('academy_inquiry_acknowledgment_v1','fishing_inquiry_email_control_v1');
