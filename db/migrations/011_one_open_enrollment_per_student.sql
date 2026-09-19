DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM enrollments
    WHERE status IN ('ACTIVE','PAUSED')
    GROUP BY tenant_id,student_id
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'Duplicate active/paused enrollments found; resolve data before applying uniqueness constraint';
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS uq_enrollments_one_open_per_student
  ON enrollments(tenant_id,student_id)
  WHERE status IN ('ACTIVE','PAUSED');
