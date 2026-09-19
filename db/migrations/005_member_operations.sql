ALTER TABLE enrollments
  ADD COLUMN IF NOT EXISTS paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS canceled_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancellation_reason text,
  ADD COLUMN IF NOT EXISTS billing_day smallint CHECK (billing_day IS NULL OR billing_day BETWEEN 1 AND 28),
  ADD COLUMN IF NOT EXISTS next_billing_on date;

ALTER TABLE charges
  ADD COLUMN IF NOT EXISTS cycle_key text;

CREATE UNIQUE INDEX IF NOT EXISTS uq_charges_enrollment_cycle
  ON charges(tenant_id,enrollment_id,cycle_key)
  WHERE enrollment_id IS NOT NULL AND cycle_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS enrollment_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  enrollment_id uuid NOT NULL,
  actor_user_id uuid,
  event_type text NOT NULL CHECK (event_type IN ('CREATED','PAUSED','RESUMED','CANCELED','RENEWED','PLAN_CHANGED','EXPIRED')),
  from_status text,
  to_status text,
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (tenant_id,enrollment_id) REFERENCES enrollments(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,actor_user_id) REFERENCES users(tenant_id,id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_enrollment_events_history ON enrollment_events(tenant_id,enrollment_id,created_at DESC);

CREATE TABLE IF NOT EXISTS physical_assessments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  assessed_at timestamptz NOT NULL DEFAULT now(),
  weight_kg numeric(6,2) CHECK (weight_kg IS NULL OR weight_kg > 0),
  height_cm numeric(6,2) CHECK (height_cm IS NULL OR height_cm > 0),
  body_fat_percent numeric(5,2) CHECK (body_fat_percent IS NULL OR body_fat_percent BETWEEN 0 AND 100),
  muscle_mass_kg numeric(6,2) CHECK (muscle_mass_kg IS NULL OR muscle_mass_kg >= 0),
  resting_heart_rate integer CHECK (resting_heart_rate IS NULL OR resting_heart_rate BETWEEN 20 AND 250),
  blood_pressure text,
  objective text,
  notes text,
  measurements jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,student_id) REFERENCES students(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,created_by_user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_assessments_student ON physical_assessments(tenant_id,student_id,assessed_at DESC);

CREATE TABLE IF NOT EXISTS anamnesis_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  created_by_user_id uuid NOT NULL,
  has_medical_clearance boolean,
  medications text,
  injuries text,
  surgeries text,
  chronic_conditions text,
  pain_or_limitations text,
  exercise_history text,
  smoking boolean,
  alcohol_notes text,
  emergency_notes text,
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,student_id) REFERENCES students(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,created_by_user_id) REFERENCES users(tenant_id,id)
);
CREATE INDEX IF NOT EXISTS idx_anamnesis_student ON anamnesis_records(tenant_id,student_id,created_at DESC);

CREATE TABLE IF NOT EXISTS workout_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  workout_plan_id uuid,
  workout_version_id uuid,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes BETWEEN 1 AND 600),
  perceived_effort smallint CHECK (perceived_effort IS NULL OR perceived_effort BETWEEN 1 AND 10),
  notes text,
  status text NOT NULL DEFAULT 'IN_PROGRESS' CHECK (status IN ('IN_PROGRESS','COMPLETED','ABANDONED')),
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,student_id) REFERENCES students(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,workout_plan_id) REFERENCES workout_plans(tenant_id,id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id,workout_version_id) REFERENCES workout_plan_versions(tenant_id,id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id,created_by_user_id) REFERENCES users(tenant_id,id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_workout_sessions_student ON workout_sessions(tenant_id,student_id,started_at DESC);

CREATE TABLE IF NOT EXISTS workout_session_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workout_session_id uuid NOT NULL,
  exercise_id uuid NOT NULL,
  workout_item_id uuid,
  performed_sets integer CHECK (performed_sets IS NULL OR performed_sets BETWEEN 0 AND 100),
  performed_reps text,
  load text,
  perceived_effort smallint CHECK (perceived_effort IS NULL OR perceived_effort BETWEEN 1 AND 10),
  notes text,
  completed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,workout_session_id) REFERENCES workout_sessions(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,exercise_id) REFERENCES exercises(tenant_id,id),
  FOREIGN KEY (tenant_id,workout_item_id) REFERENCES workout_plan_items(tenant_id,id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_session_items_session ON workout_session_items(tenant_id,workout_session_id);

CREATE TABLE IF NOT EXISTS student_accounts (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id,student_id),
  UNIQUE (tenant_id,user_id),
  FOREIGN KEY (tenant_id,student_id) REFERENCES students(tenant_id,id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id,user_id) REFERENCES users(tenant_id,id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS communication_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id uuid,
  channel text NOT NULL CHECK (channel IN ('EMAIL','WHATSAPP','IN_APP')),
  template_key text NOT NULL,
  destination text,
  subject text,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','FAILED','CANCELED')),
  scheduled_for timestamptz NOT NULL DEFAULT now(),
  sent_at timestamptz,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  idempotency_key text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id,id),
  FOREIGN KEY (tenant_id,student_id) REFERENCES students(tenant_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_communication_idempotency
  ON communication_queue(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_communication_pending ON communication_queue(tenant_id,status,scheduled_for);

UPDATE enrollments e
SET billing_day = LEAST(EXTRACT(DAY FROM starts_on)::int,28),
    next_billing_on = COALESCE(next_billing_on, starts_on)
WHERE billing_day IS NULL OR next_billing_on IS NULL;

INSERT INTO enrollment_events(tenant_id,enrollment_id,event_type,to_status,metadata)
SELECT e.tenant_id,e.id,'CREATED',e.status,jsonb_build_object('backfilled',true)
FROM enrollments e
WHERE NOT EXISTS (
  SELECT 1 FROM enrollment_events ev
  WHERE ev.tenant_id=e.tenant_id AND ev.enrollment_id=e.id AND ev.event_type='CREATED'
);
