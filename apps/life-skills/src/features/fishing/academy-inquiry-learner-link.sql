-- ROOT UNNUMBERED LOCAL CANDIDATE TEXT ONLY. No migration entry or execution.
-- Requires existing native program baseline and public inquiry table.
-- Explicit current operator correlation of EXISTING records, never auto-match.
CREATE TABLE ls_fishing_stage.academy_inquiry_learner_links (
 workspace_id uuid NOT NULL,
 id uuid NOT NULL,
 application_id uuid NOT NULL,
 learner_index smallint NOT NULL CHECK(learner_index BETWEEN 0 AND 9),
 learner_id uuid NOT NULL,
 household_id uuid NOT NULL,
 payer_account_id uuid NOT NULL,
 initial_enrollment_id uuid NOT NULL,
 initial_enrollment_revision integer NOT NULL CHECK(initial_enrollment_revision>0),
 purchase_id uuid NOT NULL,
 purchase_line_id text NOT NULL CHECK(length(purchase_line_id) BETWEEN 1 AND 160),
 offer_id text NOT NULL CHECK(length(offer_id) BETWEEN 1 AND 160),
 intake_version text NOT NULL CHECK(length(intake_version) BETWEEN 1 AND 120),
 terms_version text NOT NULL CHECK(length(terms_version) BETWEEN 1 AND 120),
 inquiry_request_digest text NOT NULL CHECK(inquiry_request_digest ~ '^[a-f0-9]{64}$'),
 inquiry_fields_digest text NOT NULL CHECK(inquiry_fields_digest ~ '^[a-f0-9]{64}$'),
 guardian_digest text NOT NULL CHECK(guardian_digest ~ '^[a-f0-9]{64}$'),
 binding_digest text NOT NULL CHECK(binding_digest ~ '^[a-f0-9]{64}$'),
 actor_account_id uuid NOT NULL,
 operation_id uuid NOT NULL,
 command_digest text NOT NULL CHECK(command_digest ~ '^[a-f0-9]{64}$'),
 linked_at timestamptz NOT NULL,
 PRIMARY KEY(workspace_id,id),
 UNIQUE(workspace_id,application_id,learner_index),
 UNIQUE(workspace_id,application_id,learner_id),
 UNIQUE(workspace_id,actor_account_id,operation_id),
 FOREIGN KEY(workspace_id,application_id) REFERENCES ls_service_interest.public_applications(workspace_id,id),
 FOREIGN KEY(workspace_id,learner_id) REFERENCES ls_identity.people(workspace_id,id),
 FOREIGN KEY(workspace_id,household_id) REFERENCES ls_cases.families(workspace_id,id),
 FOREIGN KEY(workspace_id,payer_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,actor_account_id) REFERENCES ls_identity.accounts(workspace_id,id),
 FOREIGN KEY(workspace_id,initial_enrollment_id) REFERENCES ls_fishing_stage.enrollments(workspace_id,id),
 FOREIGN KEY(workspace_id,purchase_id) REFERENCES ls_fishing_payments.purchases(workspace_id,id),
 FOREIGN KEY(workspace_id,offer_id) REFERENCES ls_fishing_stage.offer_approvals(workspace_id,id)
);
CREATE TRIGGER immutable_academy_inquiry_links BEFORE UPDATE OR DELETE
 ON ls_fishing_stage.academy_inquiry_learner_links FOR EACH ROW
 EXECUTE FUNCTION ls_fishing_stage.reject_program_history_rewrite();
-- Historical link is NOT current guardian authority or undelivered obligation.
-- Consumers must reload native enrollment/guardian/purchase/source facts.
-- No silent overwrite/remap or alias. Corrections need their own reviewed flow.
