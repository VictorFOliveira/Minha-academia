ALTER TABLE access_agents DROP CONSTRAINT IF EXISTS access_agents_adapter_check;
ALTER TABLE access_agents ADD CONSTRAINT access_agents_adapter_check
  CHECK (adapter IN ('GENERIC_HTTP','GENERIC_TCP','CONTROL_ID_ONLINE','VENDOR'));
