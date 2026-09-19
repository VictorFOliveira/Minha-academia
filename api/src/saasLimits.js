const resourceConfig = {
  units: { column: 'max_units', sql: "SELECT count(*)::int total FROM units WHERE tenant_id=$1 AND active" },
  students: { column: 'max_students', sql: "SELECT count(*)::int total FROM students WHERE tenant_id=$1 AND status <> 'INACTIVE'" },
  coaches: { column: 'max_coaches', sql: "SELECT count(*)::int total FROM users WHERE tenant_id=$1 AND role='COACH' AND active" },
  accessAgents: { column: 'max_access_agents', sql: "SELECT count(*)::int total FROM access_agents WHERE tenant_id=$1 AND status='ACTIVE'" }
};

export async function assertSaasLimit(query, tenantId, resource) {
  const config = resourceConfig[resource];
  if (!config) throw new Error('Recurso SaaS inválido');
  const product = await query(`SELECT t.saas_plan,p.${config.column} limit_value
    FROM tenants t LEFT JOIN saas_products p ON p.code=t.saas_plan AND p.active
    WHERE t.id=$1`, [tenantId]);
  if (!product.rowCount) throw Object.assign(new Error('Tenant não encontrado'), { statusCode: 404 });
  const limit = product.rows[0].limit_value;
  if (limit == null) return;
  const count = await query(config.sql, [tenantId]);
  if (count.rows[0].total >= Number(limit)) {
    throw Object.assign(new Error(`Limite do plano ${product.rows[0].saas_plan} atingido para ${resource}`), {
      statusCode: 409,
      code: 'SAAS_LIMIT_REACHED',
      resource,
      limit: Number(limit)
    });
  }
}

export async function usageForTenant(query, tenantId) {
  const [product,units,students,coaches,agents] = await Promise.all([
    query(`SELECT t.saas_plan,t.billing_status,t.trial_ends_at,p.*
      FROM tenants t LEFT JOIN saas_products p ON p.code=t.saas_plan WHERE t.id=$1`, [tenantId]),
    query("SELECT count(*)::int total FROM units WHERE tenant_id=$1 AND active", [tenantId]),
    query("SELECT count(*)::int total FROM students WHERE tenant_id=$1 AND status <> 'INACTIVE'", [tenantId]),
    query("SELECT count(*)::int total FROM users WHERE tenant_id=$1 AND role='COACH' AND active", [tenantId]),
    query("SELECT count(*)::int total FROM access_agents WHERE tenant_id=$1 AND status='ACTIVE'", [tenantId])
  ]);
  const p = product.rows[0] || {};
  return {
    plan: p.saas_plan,
    billingStatus: p.billing_status,
    trialEndsAt: p.trial_ends_at,
    limits: {
      units: p.max_units,
      students: p.max_students,
      coaches: p.max_coaches,
      accessAgents: p.max_access_agents
    },
    usage: {
      units: units.rows[0].total,
      students: students.rows[0].total,
      coaches: coaches.rows[0].total,
      accessAgents: agents.rows[0].total
    }
  };
}
