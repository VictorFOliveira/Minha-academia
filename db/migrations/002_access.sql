CREATE TABLE IF NOT EXISTS access_agents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL,
  name text NOT NULL,
  adapter text NOT NULL DEFAULT 'GENERIC_HTTP' CHECK (adapter IN ('GENERIC_HTTP','GENERIC_TCP','VENDOR')),
  secret_hash text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED')),
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_seen_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_access_agents_tenant_unit ON access_agents(tenant_id, unit_id, status);

CREATE TABLE IF NOT EXISTS access_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  credential_type text NOT NULL CHECK (credential_type IN ('QR','RFID','BIOMETRIC','PIN')),
  credential_hash text NOT NULL CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  label text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, credential_type, credential_hash),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_access_credentials_student ON access_credentials(tenant_id, student_id, active);

CREATE TABLE IF NOT EXISTS access_policies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL,
  deny_without_active_enrollment boolean NOT NULL DEFAULT true,
  block_overdue boolean NOT NULL DEFAULT false,
  offline_cache_hours integer NOT NULL DEFAULT 72 CHECK (offline_cache_hours BETWEEN 1 AND 168),
  rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, unit_id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS access_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id uuid NOT NULL,
  agent_id uuid NOT NULL,
  event_id text NOT NULL,
  credential_id uuid,
  student_id uuid,
  credential_type text CHECK (credential_type IN ('QR','RFID','BIOMETRIC','PIN')),
  direction text NOT NULL DEFAULT 'ENTRY' CHECK (direction IN ('ENTRY','EXIT')),
  decision text NOT NULL CHECK (decision IN ('GRANTED','DENIED')),
  reason text NOT NULL,
  device_id text,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, agent_id, event_id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, agent_id) REFERENCES access_agents(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, credential_id) REFERENCES access_credentials(tenant_id, id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_access_events_tenant_time ON access_events(tenant_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS idx_access_events_student_time ON access_events(tenant_id, student_id, occurred_at DESC);

ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_source_check;
ALTER TABLE attendance ADD CONSTRAINT attendance_source_check
  CHECK (source IN ('RECEPTION','QR','RFID','BIOMETRIC','APP','IMPORT','ACCESS_AGENT'));
