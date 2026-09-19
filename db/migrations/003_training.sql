CREATE TABLE IF NOT EXISTS coach_profiles (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  phone text,
  registration_number text,
  specialties text[] NOT NULL DEFAULT '{}',
  bio text,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS coach_students (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  coach_user_id uuid NOT NULL,
  student_id uuid NOT NULL,
  assigned_by_user_id uuid,
  active boolean NOT NULL DEFAULT true,
  assigned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, coach_user_id, student_id),
  FOREIGN KEY (tenant_id, coach_user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, assigned_by_user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_coach_students_student ON coach_students(tenant_id, student_id, active);

CREATE TABLE IF NOT EXISTS gym_equipment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  unit_id uuid,
  name text NOT NULL,
  category text,
  manufacturer text,
  model text,
  location text,
  instructions text,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name),
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_gym_equipment_tenant_active ON gym_equipment(tenant_id, active, name);

CREATE TABLE IF NOT EXISTS exercises (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  equipment_id uuid,
  name text NOT NULL,
  muscle_group text,
  instructions text NOT NULL,
  video_url text,
  active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_by_user_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, name),
  FOREIGN KEY (tenant_id, equipment_id) REFERENCES gym_equipment(tenant_id, id) ON DELETE SET NULL,
  FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_exercises_tenant_active ON exercises(tenant_id, active, muscle_group, name);

CREATE TABLE IF NOT EXISTS workout_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  student_id uuid NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','PAUSED','COMPLETED','CANCELED')),
  current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0),
  created_by_user_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  FOREIGN KEY (tenant_id, student_id) REFERENCES students(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_workout_plans_student ON workout_plans(tenant_id, student_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS workout_plan_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workout_plan_id uuid NOT NULL,
  version_number integer NOT NULL CHECK (version_number > 0),
  created_by_user_id uuid NOT NULL,
  starts_on date NOT NULL,
  ends_on date,
  goal text,
  notes text,
  estimated_minutes integer CHECK (estimated_minutes IS NULL OR estimated_minutes BETWEEN 1 AND 600),
  change_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, workout_plan_id, version_number),
  FOREIGN KEY (tenant_id, workout_plan_id) REFERENCES workout_plans(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, created_by_user_id) REFERENCES users(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_workout_versions_plan ON workout_plan_versions(tenant_id, workout_plan_id, version_number DESC);

CREATE TABLE IF NOT EXISTS workout_plan_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  workout_version_id uuid NOT NULL,
  exercise_id uuid NOT NULL,
  workout_label text NOT NULL DEFAULT 'A',
  position integer NOT NULL DEFAULT 1 CHECK (position > 0),
  sets integer CHECK (sets IS NULL OR sets BETWEEN 1 AND 100),
  reps text,
  load text,
  rest_seconds integer CHECK (rest_seconds IS NULL OR rest_seconds BETWEEN 0 AND 3600),
  tempo text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, id),
  UNIQUE (tenant_id, workout_version_id, workout_label, position),
  FOREIGN KEY (tenant_id, workout_version_id) REFERENCES workout_plan_versions(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, exercise_id) REFERENCES exercises(tenant_id, id)
);
CREATE INDEX IF NOT EXISTS idx_workout_items_version ON workout_plan_items(tenant_id, workout_version_id, workout_label, position);
