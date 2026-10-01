-- Admit only the private, versioned speaker-correction command receipt.
-- Existing source/cleaned transcripts, tables, indexes, FKs and ACLs are unchanged.
ALTER TABLE ls_sessions.command_receipts DROP CONSTRAINT command_receipts_operation_check;
ALTER TABLE ls_sessions.command_receipts ADD CONSTRAINT command_receipts_operation_check
 CHECK(operation IN ('upload','save_observations','save_recap','share_recap','record_consent','withdraw_consent','authorize_disclosure','revoke_disclosure','record_disclosure_use','save_speakers'));
