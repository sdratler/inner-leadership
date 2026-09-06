-- LS-000 infrastructure only; no client, account, case, financial or clinical tables.
CREATE TABLE ls_control.foundation_metadata (
  key text PRIMARY KEY,
  value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO ls_control.foundation_metadata (key, value)
VALUES ('foundation_version', '1');
