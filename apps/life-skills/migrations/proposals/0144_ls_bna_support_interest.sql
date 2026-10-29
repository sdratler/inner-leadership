-- Proposal only: not in the manifest and not authorized for execution by itself.
-- Preserve every historical BNA/co-op row while admitting a distinct adult
-- support purpose. Existing encrypted payloads and follow-up guards are unchanged.
ALTER TABLE ls_service_interest.bna_inquiries DROP CONSTRAINT bna_inquiries_program_key_check;
ALTER TABLE ls_service_interest.bna_inquiries ADD CONSTRAINT bna_inquiries_program_key_check
 CHECK(program_key IN ('bna_torah_mornings','bna_learning_coop','bna_support_interest'));
