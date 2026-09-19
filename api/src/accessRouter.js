import { Router } from 'express';
import { assertSaasLimit } from './saasLimits.js';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const hash = value => createHash('sha256').update(String(value)).digest('hex');
const bool = (value, fallback) => typeof value === 'boolean' ? value : fallback;
const typeFrom = value => ['QR','RFID','BIOMETRIC','PIN'].includes(value) ? value : null;
const directionFrom = value => value === 'EXIT' ? 'EXIT' : 'ENTRY';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function secureEqual(a, b) {
  const left = Buffer.from(String(a || ''));
  const right = Buffer.from(String(b || ''));
  return left.length === right.length && timingSafeEqual(left, right);
}

export function buildAccessRouter({ auth, audit, pool, query }) {
  const router = Router();

  const agentAuth = async (req, res, next) => {
    try {
      const id = String(req.get('X-Agent-Id') || '').trim();
      const key = String(req.get('X-Agent-Key') || '').trim();
      if (!UUID_RE.test(id) || !key) return res.status(401).json({ error: 'Agente não autenticado' });
      const r = await query(`SELECT a.id,a.tenant_id,a.unit_id,a.adapter,a.secret_hash,a.status,
        t.billing_status,t.active tenant_active,t.timezone
        FROM access_agents a JOIN tenants t ON t.id=a.tenant_id
        WHERE a.id=$1 LIMIT 1`, [id]);
      if (!r.rowCount || r.rows[0].status !== 'ACTIVE' || !r.rows[0].tenant_active) {
        return res.status(401).json({ error: 'Agente não autenticado' });
      }
      const row = r.rows[0];
      if (!secureEqual(hash(key), row.secret_hash)) return res.status(401).json({ error: 'Agente não autenticado' });
      if (['SUSPENDED','CANCELED'].includes(row.billing_status)) {
        return res.status(402).json({ error: 'Assinatura da academia indisponível' });
      }
      req.agent = {
        id: row.id,
        tenantId: row.tenant_id,
        unitId: row.unit_id,
        adapter: row.adapter,
        timezone: row.timezone
      };
      await query('UPDATE access_agents SET last_seen_at=now(),updated_at=now() WHERE id=$1 AND tenant_id=$2', [row.id, row.tenant_id]);
      next();
    } catch (error) { next(error); }
  };

  router.get('/agents', auth('OWNER','ADMIN'), async (req, res, next) => {
    try {
      const r = await query(`SELECT a.id,a.unit_id,a.name,a.adapter,a.status,a.config,a.last_seen_at,a.created_at,u.name unit_name
        FROM access_agents a JOIN units u ON u.id=a.unit_id AND u.tenant_id=a.tenant_id
        WHERE a.tenant_id=$1 ORDER BY a.created_at DESC`, [req.user.tenantId]);
      res.json(r.rows);
    } catch (error) { next(error); }
  });

  router.post('/agents', auth('OWNER','ADMIN'), async (req, res, next) => {
    const client = await pool.connect();
    try {
      const name = String(req.body?.name || '').trim();
      const unitId = req.body?.unitId || req.user.unitId;
      const adapter = ['GENERIC_HTTP','GENERIC_TCP','CONTROL_ID_ONLINE','VENDOR'].includes(req.body?.adapter) ? req.body.adapter : 'GENERIC_HTTP';
      if (name.length < 2 || !unitId) return res.status(400).json({ error: 'Nome e unidade são obrigatórios' });
      await client.query('BEGIN');
      await assertSaasLimit(query, req.user.tenantId, 'accessAgents');
      const unit = await client.query('SELECT id FROM units WHERE id=$1 AND tenant_id=$2 AND active', [unitId, req.user.tenantId]);
      if (!unit.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Unidade não encontrada' });
      }
      const agentKey = randomBytes(32).toString('base64url');
      const r = await client.query(`INSERT INTO access_agents(tenant_id,unit_id,name,adapter,secret_hash,config)
        VALUES($1,$2,$3,$4,$5,$6) RETURNING id,unit_id,name,adapter,status,config,created_at`, [
        req.user.tenantId, unitId, name, adapter, hash(agentKey), req.body?.config || {}
      ]);
      await client.query(`INSERT INTO access_policies(tenant_id,unit_id) VALUES($1,$2)
        ON CONFLICT(tenant_id,unit_id) DO NOTHING`, [req.user.tenantId, unitId]);
      await audit(client, req.user, 'ACCESS_AGENT_CREATED', 'access_agent', r.rows[0].id, { unitId, adapter });
      await client.query('COMMIT');
      res.status(201).json({ agent: r.rows[0], agentKey, warning: 'A chave é exibida somente nesta resposta.' });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally { client.release(); }
  });

  router.get('/credentials', auth('OWNER','ADMIN','MANAGER','RECEPTION'), async (req, res, next) => {
    try {
      const r = await query(`SELECT c.id,c.student_id,c.credential_type,c.label,c.active,c.created_at,c.revoked_at,s.name student_name
        FROM access_credentials c JOIN students s ON s.id=c.student_id AND s.tenant_id=c.tenant_id
        WHERE c.tenant_id=$1 ORDER BY c.created_at DESC LIMIT 1000`, [req.user.tenantId]);
      res.json(r.rows);
    } catch (error) { next(error); }
  });

  router.post('/credentials', auth('OWNER','ADMIN','MANAGER','RECEPTION'), async (req, res, next) => {
    const client = await pool.connect();
    try {
      const studentId = req.body?.studentId;
      const credentialType = typeFrom(req.body?.credentialType);
      const credential = String(req.body?.credential || '').trim();
      const label = String(req.body?.label || '').trim() || null;
      if (!studentId || !credentialType || credential.length < 3 || credential.length > 512) {
        return res.status(400).json({ error: 'Credencial inválida' });
      }
      await client.query('BEGIN');
      const student = await client.query('SELECT id FROM students WHERE id=$1 AND tenant_id=$2', [studentId, req.user.tenantId]);
      if (!student.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Aluno não encontrado' });
      }
      const r = await client.query(`INSERT INTO access_credentials(tenant_id,student_id,credential_type,credential_hash,label)
        VALUES($1,$2,$3,$4,$5) RETURNING id,student_id,credential_type,label,active,created_at`, [
        req.user.tenantId, studentId, credentialType, hash(credential), label
      ]);
      await audit(client, req.user, 'ACCESS_CREDENTIAL_CREATED', 'access_credential', r.rows[0].id, { studentId, credentialType });
      await client.query('COMMIT');
      res.status(201).json(r.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'Credencial já cadastrada nesta academia' });
      next(error);
    } finally { client.release(); }
  });

  router.delete('/credentials/:id', auth('OWNER','ADMIN','MANAGER'), async (req, res, next) => {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const r = await client.query(`UPDATE access_credentials SET active=false,revoked_at=now()
        WHERE id=$1 AND tenant_id=$2 AND active RETURNING id,student_id,credential_type`, [req.params.id, req.user.tenantId]);
      if (!r.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Credencial não encontrada' });
      }
      await audit(client, req.user, 'ACCESS_CREDENTIAL_REVOKED', 'access_credential', r.rows[0].id, r.rows[0]);
      await client.query('COMMIT');
      res.json({ ok: true });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally { client.release(); }
  });

  router.get('/policy/:unitId', auth('OWNER','ADMIN','MANAGER'), async (req, res, next) => {
    try {
      const r = await query(`SELECT * FROM access_policies WHERE tenant_id=$1 AND unit_id=$2`, [req.user.tenantId, req.params.unitId]);
      if (!r.rowCount) return res.status(404).json({ error: 'Política não encontrada' });
      res.json(r.rows[0]);
    } catch (error) { next(error); }
  });

  router.put('/policy/:unitId', auth('OWNER','ADMIN'), async (req, res, next) => {
    const client = await pool.connect();
    try {
      const unit = await client.query('SELECT id FROM units WHERE id=$1 AND tenant_id=$2 AND active', [req.params.unitId, req.user.tenantId]);
      if (!unit.rowCount) return res.status(404).json({ error: 'Unidade não encontrada' });
      const cacheHours = Number(req.body?.offlineCacheHours ?? 72);
      if (!Number.isInteger(cacheHours) || cacheHours < 1 || cacheHours > 168) {
        return res.status(400).json({ error: 'Cache offline deve ficar entre 1 e 168 horas' });
      }
      await client.query('BEGIN');
      const r = await client.query(`INSERT INTO access_policies(
          tenant_id,unit_id,deny_without_active_enrollment,block_overdue,offline_cache_hours,rules,updated_at
        ) VALUES($1,$2,$3,$4,$5,$6,now())
        ON CONFLICT(tenant_id,unit_id) DO UPDATE SET
          deny_without_active_enrollment=excluded.deny_without_active_enrollment,
          block_overdue=excluded.block_overdue,
          offline_cache_hours=excluded.offline_cache_hours,
          rules=excluded.rules,
          updated_at=now()
        RETURNING *`, [
        req.user.tenantId, req.params.unitId,
        bool(req.body?.denyWithoutActiveEnrollment, true),
        bool(req.body?.blockOverdue, false),
        cacheHours,
        req.body?.rules || {}
      ]);
      await audit(client, req.user, 'ACCESS_POLICY_UPDATED', 'access_policy', r.rows[0].id, { unitId: req.params.unitId });
      await client.query('COMMIT');
      res.json(r.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally { client.release(); }
  });

  router.get('/events', auth('OWNER','ADMIN','MANAGER','RECEPTION'), async (req, res, next) => {
    try {
      const unitId = String(req.query?.unitId || '').trim() || null;
      const r = await query(`SELECT e.*,s.name student_name,a.name agent_name,u.name unit_name
        FROM access_events e
        LEFT JOIN students s ON s.id=e.student_id AND s.tenant_id=e.tenant_id
        JOIN access_agents a ON a.id=e.agent_id AND a.tenant_id=e.tenant_id
        LEFT JOIN units u ON u.id=e.unit_id AND u.tenant_id=e.tenant_id
        WHERE e.tenant_id=$1 AND ($2::uuid IS NULL OR e.unit_id=$2)
        ORDER BY e.occurred_at DESC LIMIT 1000`, [req.user.tenantId, unitId]);
      res.json(r.rows);
    } catch (error) { next(error); }
  });

  router.get('/agent/sync', agentAuth, async (req, res, next) => {
    try {
      const [policyResult, credentials] = await Promise.all([
        query(`SELECT deny_without_active_enrollment,block_overdue,offline_cache_hours,rules
          FROM access_policies WHERE tenant_id=$1 AND unit_id=$2`, [req.agent.tenantId, req.agent.unitId]),
        query(`SELECT c.id,c.student_id,c.credential_type,c.credential_hash,s.status,
          (s.unit_id=$2) is_home_unit,
          EXISTS(
            SELECT 1 FROM enrollments e
            WHERE e.tenant_id=c.tenant_id AND e.student_id=c.student_id
              AND e.status='ACTIVE'
              AND e.starts_on <= (now() AT TIME ZONE (SELECT timezone FROM tenants WHERE id=c.tenant_id))::date
              AND (e.ends_on IS NULL OR e.ends_on >= (now() AT TIME ZONE (SELECT timezone FROM tenants WHERE id=c.tenant_id))::date)
          ) has_active_enrollment,
          EXISTS(
            SELECT 1 FROM enrollments e
            JOIN plans p ON p.tenant_id=e.tenant_id AND p.id=e.plan_id AND p.active
            WHERE e.tenant_id=c.tenant_id AND e.student_id=c.student_id
              AND e.status='ACTIVE'
              AND e.starts_on <= (now() AT TIME ZONE (SELECT timezone FROM tenants WHERE id=c.tenant_id))::date
              AND (e.ends_on IS NULL OR e.ends_on >= (now() AT TIME ZONE (SELECT timezone FROM tenants WHERE id=c.tenant_id))::date)
              AND (
                p.access_scope='ALL_UNITS'
                OR (p.access_scope='PRIMARY_UNIT' AND s.unit_id=$2)
                OR (p.access_scope='SELECTED_UNITS' AND EXISTS(
                  SELECT 1 FROM plan_units pu
                  WHERE pu.tenant_id=p.tenant_id AND pu.plan_id=p.id AND pu.unit_id=$2
                ))
              )
          ) has_unit_access,
          EXISTS(
            SELECT 1 FROM charges ch
            WHERE ch.tenant_id=c.tenant_id AND ch.student_id=c.student_id
              AND ch.status IN ('PENDING','PARTIAL','OVERDUE')
              AND ch.due_date < (now() AT TIME ZONE (SELECT timezone FROM tenants WHERE id=c.tenant_id))::date
              AND ch.amount_cents>ch.paid_cents
          ) has_overdue
          FROM access_credentials c
          JOIN students s ON s.id=c.student_id AND s.tenant_id=c.tenant_id
          WHERE c.tenant_id=$1 AND c.active`, [req.agent.tenantId, req.agent.unitId])
      ]);
      const policy = policyResult.rows[0] || {
        deny_without_active_enrollment: true,
        block_overdue: false,
        offline_cache_hours: 72,
        rules: {}
      };
      const rows = credentials.rows.map(row => {
        let allowed = row.status === 'ACTIVE';
        let reason = allowed ? 'ACTIVE' : 'STUDENT_INACTIVE';
        if (allowed && policy.deny_without_active_enrollment && !row.has_active_enrollment) {
          allowed = false;
          reason = 'NO_ACTIVE_ENROLLMENT';
        }
        if (allowed && row.has_active_enrollment && !row.has_unit_access) {
          allowed = false;
          reason = 'UNIT_NOT_ALLOWED';
        }
        if (allowed && !policy.deny_without_active_enrollment && !row.has_active_enrollment && !row.is_home_unit) {
          allowed = false;
          reason = 'UNIT_NOT_ALLOWED';
        }
        if (allowed && policy.block_overdue && row.has_overdue) {
          allowed = false;
          reason = 'OVERDUE';
        }
        return {
          credentialId: row.id,
          studentId: row.student_id,
          credentialType: row.credential_type,
          credentialHash: row.credential_hash,
          allowed,
          reason
        };
      });
      res.json({
        syncedAt: new Date().toISOString(),
        timezone: req.agent.timezone,
        policy: {
          denyWithoutActiveEnrollment: policy.deny_without_active_enrollment,
          blockOverdue: policy.block_overdue,
          offlineCacheHours: policy.offline_cache_hours,
          rules: policy.rules
        },
        credentials: rows
      });
    } catch (error) { next(error); }
  });

  router.post('/agent/events', agentAuth, async (req, res, next) => {
    const events = Array.isArray(req.body?.events) ? req.body.events.slice(0, 100) : [];
    if (!events.length) return res.status(400).json({ error: 'Envie ao menos um evento' });
    const client = await pool.connect();
    let accepted = 0;
    let duplicates = 0;
    try {
      await client.query('BEGIN');
      for (const event of events) {
        const eventId = String(event?.eventId || '').trim();
        const credentialHash = String(event?.credentialHash || '').trim().toLowerCase();
        const credentialType = typeFrom(event?.credentialType);
        const decision = event?.decision === 'GRANTED' ? 'GRANTED' : 'DENIED';
        const reason = String(event?.reason || 'UNKNOWN').slice(0, 120);
        const occurredAt = new Date(event?.occurredAt || 0);
        if (!eventId || eventId.length > 120 || !/^[0-9a-f]{64}$/.test(credentialHash) || !credentialType || Number.isNaN(occurredAt.getTime())) {
          continue;
        }
        const credential = await client.query(`SELECT id,student_id FROM access_credentials
          WHERE tenant_id=$1 AND credential_type=$2 AND credential_hash=$3 LIMIT 1`, [
          req.agent.tenantId, credentialType, credentialHash
        ]);
        const credentialId = credential.rows[0]?.id || null;
        const studentId = credential.rows[0]?.student_id || null;
        const inserted = await client.query(`INSERT INTO access_events(
          tenant_id,unit_id,agent_id,event_id,credential_id,student_id,credential_type,direction,
          decision,reason,device_id,occurred_at,metadata
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        ON CONFLICT(tenant_id,agent_id,event_id) DO NOTHING RETURNING id`, [
          req.agent.tenantId, req.agent.unitId, req.agent.id, eventId, credentialId, studentId,
          credentialType, directionFrom(event?.direction), decision, reason,
          String(event?.deviceId || '').slice(0,120) || null, occurredAt.toISOString(), event?.metadata || {}
        ]);
        if (!inserted.rowCount) {
          duplicates += 1;
          continue;
        }
        accepted += 1;
        if (decision === 'GRANTED' && directionFrom(event?.direction) === 'ENTRY' && studentId) {
          const source = ['QR','RFID','BIOMETRIC'].includes(credentialType) ? credentialType : 'ACCESS_AGENT';
          await client.query(`INSERT INTO attendance(tenant_id,unit_id,student_id,source,checkin_at,metadata)
            VALUES($1,$2,$3,$4,$5,$6)`, [
            req.agent.tenantId, req.agent.unitId, studentId, source, occurredAt.toISOString(),
            { accessEventId: inserted.rows[0].id, agentId: req.agent.id }
          ]);
        }
      }
      await client.query('COMMIT');
      res.status(202).json({ accepted, duplicates, ignored: events.length - accepted - duplicates });
    } catch (error) {
      await client.query('ROLLBACK');
      next(error);
    } finally { client.release(); }
  });

  return router;
}
