ALTER TABLE charges
  ADD COLUMN IF NOT EXISTS provider text NOT NULL DEFAULT 'MANUAL',
  ADD COLUMN IF NOT EXISTS provider_status text,
  ADD COLUMN IF NOT EXISTS billing_type text,
  ADD COLUMN IF NOT EXISTS invoice_url text;

CREATE TABLE IF NOT EXISTS tenant_integrations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','DISABLED','ERROR')),
  environment text,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret_ciphertext text,
  secret_iv text,
  secret_tag text,
  webhook_token_hash text,
  last_error text,
  last_sync_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,provider)
);

CREATE TABLE IF NOT EXISTS provider_customers (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  provider text NOT NULL,
  external_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,student_id,provider),
  UNIQUE (provider,external_id),
  FOREIGN KEY (tenant_id,student_id) REFERENCES students(tenant_id,id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_charges_provider_external
  ON charges(tenant_id,provider,external_id)
  WHERE external_id IS NOT NULL;
