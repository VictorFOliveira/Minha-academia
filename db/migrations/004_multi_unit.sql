CREATE TABLE IF NOT EXISTS user_units (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, user_id, unit_id),
  FOREIGN KEY (tenant_id, user_id) REFERENCES users(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_user_units_unit ON user_units(tenant_id, unit_id, user_id);

ALTER TABLE plans
  ADD COLUMN IF NOT EXISTS access_scope text NOT NULL DEFAULT 'PRIMARY_UNIT'
  CHECK (access_scope IN ('PRIMARY_UNIT','SELECTED_UNITS','ALL_UNITS'));

CREATE TABLE IF NOT EXISTS plan_units (
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, plan_id, unit_id),
  FOREIGN KEY (tenant_id, plan_id) REFERENCES plans(tenant_id, id) ON DELETE CASCADE,
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_plan_units_unit ON plan_units(tenant_id, unit_id, plan_id);

ALTER TABLE attendance ADD COLUMN IF NOT EXISTS unit_id uuid;
ALTER TABLE attendance DROP CONSTRAINT IF EXISTS attendance_unit_fk;
ALTER TABLE attendance ADD CONSTRAINT attendance_unit_fk
  FOREIGN KEY (tenant_id, unit_id) REFERENCES units(tenant_id, id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_attendance_tenant_unit_time ON attendance(tenant_id, unit_id, checkin_at DESC);

INSERT INTO user_units(tenant_id,user_id,unit_id,is_primary)
SELECT tenant_id,id,unit_id,true FROM users WHERE unit_id IS NOT NULL
ON CONFLICT(tenant_id,user_id,unit_id) DO UPDATE SET is_primary=true;

UPDATE attendance a
SET unit_id=s.unit_id
FROM students s
WHERE a.unit_id IS NULL AND s.tenant_id=a.tenant_id AND s.id=a.student_id;
