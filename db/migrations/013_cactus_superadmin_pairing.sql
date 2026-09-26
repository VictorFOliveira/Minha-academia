CREATE TABLE IF NOT EXISTS platform_control_plane_credentials (
  id integer PRIMARY KEY CHECK (id=1),
  key_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  paired_at timestamptz NOT NULL DEFAULT now(),
  rotated_at timestamptz
);
