-- Additive disposable proposal only; no runtime bootstrap/numbered adoption.
-- Every provisional membership blocks capacity, including unknown delivery.
-- Lifecycle, send-clock, release and settled-paid admission are NOT implemented
-- by this first membership table. Never delete a row to invent available seats.
CREATE TABLE ls_fishing_billing.seat_reservation_locks (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),
 kind text NOT NULL CHECK(kind IN ('quote','pool','child')),entity_id uuid NOT NULL,
 PRIMARY KEY(workspace_id,kind,entity_id)
);
CREATE TABLE ls_fishing_billing.seat_reservations (
 workspace_id uuid NOT NULL REFERENCES ls_identity.workspaces(id),quote_id uuid NOT NULL,family_id uuid NOT NULL,
 offer_sha256 text NOT NULL CHECK(offer_sha256~'^[a-f0-9]{64}$'),
 record_digest text NOT NULL CHECK(record_digest~'^[a-f0-9]{64}$'),created_at timestamptz(3) NOT NULL,
 payload_ciphertext text NOT NULL CHECK(length(payload_ciphertext) BETWEEN 1 AND 2000000),
 PRIMARY KEY(workspace_id,quote_id),UNIQUE(workspace_id,quote_id,record_digest),
 FOREIGN KEY(workspace_id,quote_id) REFERENCES ls_fishing_billing.quotes(workspace_id,id)
);
CREATE TABLE ls_fishing_billing.seat_reservation_claims (
 workspace_id uuid NOT NULL,quote_id uuid NOT NULL,record_digest text NOT NULL,
 pool_id uuid NOT NULL,child_id uuid NOT NULL,resource_kind text NOT NULL CHECK(resource_kind IN ('lesson','departure')),
 resource_id uuid NOT NULL,starts_at timestamptz(3) NOT NULL,ends_at timestamptz(3) NOT NULL CHECK(ends_at>starts_at),
 PRIMARY KEY(workspace_id,quote_id,pool_id,child_id,resource_kind,resource_id),
 FOREIGN KEY(workspace_id,quote_id,record_digest) REFERENCES ls_fishing_billing.seat_reservations(workspace_id,quote_id,record_digest)
);
CREATE INDEX seat_reservation_pool_window ON ls_fishing_billing.seat_reservation_claims(workspace_id,pool_id,starts_at,ends_at);
CREATE INDEX seat_reservation_child_window ON ls_fishing_billing.seat_reservation_claims(workspace_id,child_id,starts_at,ends_at);
CREATE FUNCTION ls_fishing_billing.protect_seat_reservation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'FISHING_SEAT_RESERVATION_IMMUTABLE' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER seat_locks_no_change BEFORE UPDATE OR DELETE ON ls_fishing_billing.seat_reservation_locks
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.protect_seat_reservation();
CREATE TRIGGER seat_locks_no_truncate BEFORE TRUNCATE ON ls_fishing_billing.seat_reservation_locks
 FOR EACH STATEMENT EXECUTE FUNCTION ls_fishing_billing.protect_seat_reservation();
CREATE TRIGGER seat_reservation_no_change BEFORE UPDATE OR DELETE ON ls_fishing_billing.seat_reservations
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.protect_seat_reservation();
CREATE TRIGGER seat_reservation_no_truncate BEFORE TRUNCATE ON ls_fishing_billing.seat_reservations
 FOR EACH STATEMENT EXECUTE FUNCTION ls_fishing_billing.protect_seat_reservation();
CREATE TRIGGER seat_claim_no_change BEFORE UPDATE OR DELETE ON ls_fishing_billing.seat_reservation_claims
 FOR EACH ROW EXECUTE FUNCTION ls_fishing_billing.protect_seat_reservation();
CREATE TRIGGER seat_claim_no_truncate BEFORE TRUNCATE ON ls_fishing_billing.seat_reservation_claims
 FOR EACH STATEMENT EXECUTE FUNCTION ls_fishing_billing.protect_seat_reservation();
REVOKE ALL ON ls_fishing_billing.seat_reservation_locks,ls_fishing_billing.seat_reservations,ls_fishing_billing.seat_reservation_claims FROM PUBLIC;
REVOKE ALL ON FUNCTION ls_fishing_billing.protect_seat_reservation() FROM PUBLIC;
