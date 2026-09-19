ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS trial_ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS subscription_external_id text;

CREATE TABLE IF NOT EXISTS saas_products (
  code text PRIMARY KEY,
  name text NOT NULL,
  price_cents integer CHECK (price_cents IS NULL OR price_cents >= 0),
  max_units integer CHECK (max_units IS NULL OR max_units > 0),
  max_students integer CHECK (max_students IS NULL OR max_students > 0),
  max_coaches integer CHECK (max_coaches IS NULL OR max_coaches > 0),
  max_access_agents integer CHECK (max_access_agents IS NULL OR max_access_agents > 0),
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO saas_products(code,name,price_cents,max_units,max_students,max_coaches,max_access_agents,features)
VALUES
  ('STARTER','Starter',NULL,1,300,10,2,'{"multiUnit":false,"accessAgent":true,"studentPortal":true}'::jsonb),
  ('PRO','Pro',NULL,5,3000,100,20,'{"multiUnit":true,"accessAgent":true,"studentPortal":true}'::jsonb),
  ('ENTERPRISE','Enterprise',NULL,NULL,NULL,NULL,NULL,'{"multiUnit":true,"accessAgent":true,"studentPortal":true,"customLimits":true}'::jsonb)
ON CONFLICT(code) DO UPDATE SET
  name=EXCLUDED.name,
  max_units=EXCLUDED.max_units,
  max_students=EXCLUDED.max_students,
  max_coaches=EXCLUDED.max_coaches,
  max_access_agents=EXCLUDED.max_access_agents,
  features=EXCLUDED.features;

CREATE TABLE IF NOT EXISTS platform_admins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS tenant_subscription_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_platform_admin_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('TRIAL_STARTED','PLAN_CHANGED','ACTIVATED','OVERDUE','SUSPENDED','CANCELED','REACTIVATED')),
  from_plan text,
  to_plan text,
  from_status text,
  to_status text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (actor_platform_admin_id) REFERENCES platform_admins(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_subscription_events_tenant ON tenant_subscription_events(tenant_id,created_at DESC);
