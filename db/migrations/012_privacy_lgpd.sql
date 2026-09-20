CREATE TABLE IF NOT EXISTS privacy_settings (
  tenant_id uuid PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  contact_email text,
  dpo_name text,
  policy_url text,
  retention_notice text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS privacy_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  student_id uuid,
  type text NOT NULL CHECK (type IN ('ACCESS_EXPORT','CORRECTION','ANONYMIZATION','DELETION','PORTABILITY','SHARING_INFO','OPPOSITION','OTHER')),
  status text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','IN_REVIEW','COMPLETED','REJECTED','CANCELED')),
  description text,
  response text,
  decision_reason text,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id),
  FOREIGN KEY (tenant_id,student_id) REFERENCES students(tenant_id,id),
  FOREIGN KEY (tenant_id,reviewed_by) REFERENCES users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_tenant_status
  ON privacy_requests(tenant_id,status,created_at DESC);
CREATE INDEX IF NOT EXISTS idx_privacy_requests_user
  ON privacy_requests(tenant_id,user_id,created_at DESC);

CREATE TABLE IF NOT EXISTS privacy_consents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  kind text NOT NULL CHECK (kind IN ('PRIVACY_POLICY','TERMS_OF_USE','COMMUNICATION')),
  version text NOT NULL,
  accepted boolean NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE,
  UNIQUE (tenant_id,user_id,kind,version)
);
CREATE INDEX IF NOT EXISTS idx_privacy_consents_user
  ON privacy_consents(tenant_id,user_id,accepted_at DESC);
