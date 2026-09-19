ALTER TABLE audit_logs
  DROP CONSTRAINT IF EXISTS audit_logs_tenant_id_user_id_fkey;

ALTER TABLE audit_logs
  ADD CONSTRAINT audit_logs_tenant_id_user_id_fkey
  FOREIGN KEY (tenant_id,user_id)
  REFERENCES users(tenant_id,id)
  ON DELETE SET NULL (user_id);
