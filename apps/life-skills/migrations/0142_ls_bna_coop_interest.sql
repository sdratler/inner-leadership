-- Add an explicit co-op interest purpose without changing historical inquiries.
ALTER TABLE ls_service_interest.bna_inquiries DROP CONSTRAINT bna_inquiries_program_key_check;
ALTER TABLE ls_service_interest.bna_inquiries ADD CONSTRAINT bna_inquiries_program_key_check
 CHECK(program_key IN ('bna_torah_mornings','bna_learning_coop'));
