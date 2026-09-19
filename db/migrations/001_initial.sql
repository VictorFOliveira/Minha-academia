CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS tenants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  legal_name text NOT NULL,
  trade_name text NOT NULL,
  cnpj text,
  timezone text NOT NULL DEFAULT 'America/Fortaleza',
  saas_plan text NOT NULL DEFAULT 'STARTER',
  billing_status text NOT NULL DEFAULT 'TRIAL' CHECK (billing_status IN ('TRIAL','ACTIVE','OVERDUE','SUSPENDED','CANCELED')),
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_tenants_cnpj ON tenants(cnpj) WHERE cnpj IS NOT NULL;

CREATE TABLE IF NOT EXISTS units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  address jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id uuid,
  name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  role text NOT NULL CHECK (role IN ('OWNER','ADMIN','MANAGER','RECEPTION','COACH','FINANCE','STUDENT')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, email),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id uuid,
  name text NOT NULL,
  cpf text,
  email text,
  phone text,
  birth_date date,
  emergency_contact text,
  status text NOT NULL DEFAULT 'LEAD' CHECK (status IN ('LEAD','ACTIVE','PAUSED','INACTIVE')),
  notes text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id) ON DELETE SET NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_students_cpf ON students(tenant_id, cpf) WHERE cpf IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_students_tenant_status ON students(tenant_id, status, name);

CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  price_cents integer NOT NULL CHECK (price_cents >= 0),
  billing_interval text NOT NULL DEFAULT 'MONTHLY' CHECK (billing_interval IN ('MONTHLY','QUARTERLY','SEMIANNUAL','ANNUAL','CUSTOM')),
  duration_days integer,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name)
);

CREATE TABLE IF NOT EXISTS enrollments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  plan_id uuid NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','CANCELED','EXPIRED')),
  discount_cents integer NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, plan_id) REFERENCES plans(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_enrollments_tenant_student ON enrollments(tenant_id, student_id, status);

CREATE TABLE IF NOT EXISTS classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id uuid,
  coach_user_id uuid,
  name text NOT NULL,
  modality text NOT NULL,
  capacity integer CHECK (capacity IS NULL OR capacity > 0),
  weekday smallint CHECK (weekday BETWEEN 0 AND 6),
  starts_at time,
  ends_at time,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, coach_user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_classes_tenant_weekday ON classes(tenant_id, weekday, active);

CREATE TABLE IF NOT EXISTS attendance (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  class_id uuid,
  source text NOT NULL DEFAULT 'RECEPTION' CHECK (source IN ('RECEPTION','QR','RFID','BIOMETRIC','APP','IMPORT')),
  checkin_at timestamptz NOT NULL DEFAULT now(),
  checkout_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, class_id) REFERENCES classes(tenant_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_attendance_tenant_time ON attendance(tenant_id, checkin_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_student_time ON attendance(tenant_id, student_id, checkin_at DESC);

CREATE TABLE IF NOT EXISTS charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  enrollment_id uuid,
  description text NOT NULL,
  due_date date NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  paid_cents integer NOT NULL DEFAULT 0 CHECK (paid_cents >= 0 AND paid_cents <= amount_cents),
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','PARTIAL','PAID','OVERDUE','CANCELED')),
  external_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, enrollment_id) REFERENCES enrollments(tenant_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_charges_tenant_due ON charges(tenant_id, status, due_date);

CREATE TABLE IF NOT EXISTS payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  charge_id uuid NOT NULL,
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  method text NOT NULL CHECK (method IN ('PIX','CARD','CASH','BANK_SLIP','TRANSFER','OTHER')),
  provider text NOT NULL DEFAULT 'MANUAL',
  external_id text,
  paid_at timestamptz NOT NULL DEFAULT now(),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  FOREIGN KEY (tenant_id, charge_id) REFERENCES charges(tenant_id, id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_payments_external ON payments(tenant_id, provider, external_id) WHERE external_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS idempotency_keys (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  scope text NOT NULL,
  idempotency_key text NOT NULL,
  response jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, scope, idempotency_key)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_tenant_time ON audit_logs(tenant_id, created_at DESC);

CREATE TABLE IF NOT EXISTS webhook_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid REFERENCES tenants(id) ON DELETE CASCADE,
  provider text NOT NULL,
  event_id text NOT NULL,
  event_type text,
  payload jsonb NOT NULL,
  processed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(provider, event_id)
);
