ALTER TABLE users
  ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS password_changed_at timestamptz;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS custom_domain text,
  ADD COLUMN IF NOT EXISTS saas_customer_external_id text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_custom_domain
  ON tenants(lower(custom_domain))
  WHERE custom_domain IS NOT NULL;

CREATE TABLE IF NOT EXISTS user_security (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  mfa_enabled boolean NOT NULL DEFAULT false,
  totp_secret_ciphertext text,
  totp_secret_iv text,
  totp_secret_tag text,
  recovery_code_hashes jsonb NOT NULL DEFAULT '[]'::jsonb,
  mfa_confirmed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,user_id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS password_reset_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_password_reset_active
  ON password_reset_tokens(tenant_id,user_id,expires_at DESC)
  WHERE used_at IS NULL;

ALTER TABLE platform_admins
  ADD COLUMN IF NOT EXISTS auth_version integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS mfa_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS totp_secret_ciphertext text,
  ADD COLUMN IF NOT EXISTS totp_secret_iv text,
  ADD COLUMN IF NOT EXISTS totp_secret_tag text,
  ADD COLUMN IF NOT EXISTS recovery_code_hashes jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS tenant_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain text NOT NULL,
  kind text NOT NULL DEFAULT 'CUSTOM' CHECK (kind IN ('CUSTOM','SUBDOMAIN')),
  verification_token text NOT NULL,
  verified_at timestamptz,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain),
  UNIQUE (tenant_id,domain)
);

CREATE TABLE IF NOT EXISTS tenant_saas_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  product_code text REFERENCES saas_products(code),
  cycle_key text NOT NULL,
  description text NOT NULL,
  due_date date NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PAID','OVERDUE','CANCELED','REFUNDED')),
  provider text NOT NULL DEFAULT 'MANUAL',
  external_id text,
  invoice_url text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,cycle_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_saas_invoice_provider_external
  ON tenant_saas_invoices(provider,external_id)
  WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_saas_invoices_due
  ON tenant_saas_invoices(status,due_date);

CREATE TABLE IF NOT EXISTS platform_webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text NOT NULL,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider,event_id)
);
