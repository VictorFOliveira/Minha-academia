import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import rateLimit from 'express-rate-limit';
import 'dotenv/config';
import { health as dbHealth, pool, query } from './db.js';
import { migrate } from './migrate.js';
import { bootstrap } from './bootstrap.js';
import { buildAccessRouter } from './accessRouter.js';
import { buildTrainingRouter } from './trainingRouter.js';
import { buildMemberRouter } from './memberRouter.js';
import { buildPlatformRouter } from './platformRouter.js';
import { buildAsaasRouter } from './asaasRouter.js';
import { assertSaasLimit, usageForTenant } from './saasLimits.js';

const app = express();
const secret = process.env.JWT_SECRET || 'dev-only-change-this-secret';
const platformSecret = process.env.PLATFORM_JWT_SECRET || secret;
const allowedOrigins = String(process.env.CORS_ORIGINS || 'http://localhost:8080').split(',').map(v => v.trim()).filter(Boolean);

app.set('trust proxy', process.env.NODE_ENV === 'production' ? 1 : false);
app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
app.use(cors({
  origin(origin, cb) {
    if (!origin || allowedOrigins.includes(origin)) return cb(null, true);
    cb(new Error('Origem não autorizada'));
  }
}));
app.use(express.json({ limit: '512kb' }));
app.use('/api', rateLimit({ windowMs: 60_000, limit: Number(process.env.RATE_LIMIT_API || 300), standardHeaders: true, legacyHeaders: false }));
const loginLimiter = rateLimit({ windowMs: 15 * 60_000, limit: Number(process.env.RATE_LIMIT_LOGIN || 15), standardHeaders: true, legacyHeaders: false });

const roles = (...allowed) => req => !allowed.length || allowed.includes(req.user.role);
const normalizeEmail = value => String(value || '').trim().toLowerCase();
const normalizeCpf = value => {
  const digits = String(value || '').replace(/\D/g, '');
  return digits || null;
};
const money = value => Number.isInteger(value) && value >= 0;
const date = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const todayInTimeZone = timeZone => {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(part => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
};

async function audit(client, user, action, entityType, entityId, metadata = {}) {
  await client.query(
    'INSERT INTO audit_logs(tenant_id,user_id,action,entity_type,entity_id,metadata) VALUES($1,$2,$3,$4,$5,$6)',
    [user.tenantId, user.id, action, entityType, entityId || null, metadata]
  );
}

const auth = (...allowed) => async (req, res, next) => {
  const raw = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!raw) return res.status(401).json({ error: 'Sessão inválida' });
  try {
    const claims = jwt.verify(raw, secret);
    const result = await query(`SELECT u.id,u.tenant_id,u.unit_id,u.name,u.email,u.role,t.trade_name,t.slug,t.billing_status,t.timezone
      FROM users u JOIN tenants t ON t.id=u.tenant_id
      WHERE u.id=$1 AND u.active AND t.active LIMIT 1`, [claims.id]);
    if (!result.rowCount) return res.status(401).json({ error: 'Sessão inválida' });
    const row = result.rows[0];
    if (row.billing_status === 'SUSPENDED' || row.billing_status === 'CANCELED') {
      return res.status(402).json({ error: 'Assinatura da academia indisponível' });
    }
    req.user = {
      id: row.id, tenantId: row.tenant_id, unitId: row.unit_id, name: row.name,
      email: row.email, role: row.role, tenantName: row.trade_name, tenantSlug: row.slug,
      billingStatus: row.billing_status, timezone: row.timezone
    };
    if (allowed.length && !roles(...allowed)(req)) return res.status(403).json({ error: 'Sem permissão' });
    next();
  } catch {
    return res.status(401).json({ error: 'Sessão inválida' });
  }
};

async function canUseUnit(user, unitId) {
  if (!unitId) return true;
  if (['OWNER','ADMIN'].includes(user.role)) {
    const r = await query('SELECT 1 FROM units WHERE tenant_id=$1 AND id=$2 AND active', [user.tenantId, unitId]);
    return Boolean(r.rowCount);
  }
  const r = await query(`SELECT 1 FROM user_units uu
    JOIN units u ON u.tenant_id=uu.tenant_id AND u.id=uu.unit_id AND u.active
    WHERE uu.tenant_id=$1 AND uu.user_id=$2 AND uu.unit_id=$3`, [user.tenantId, user.id, unitId]);
  return Boolean(r.rowCount);
}

app.get('/api/health', async (_req, res) => {
  try {
    await dbHealth();
    res.json({ status: 'ok', database: 'connected', product: 'Minha Academia', version: '0.1.0' });
  } catch {
    res.status(503).json({ status: 'degraded' });
  }
});

app.post('/api/auth/login', loginLimiter, async (req, res, next) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || '');
    const tenant = String(req.body?.tenant || '').trim().toLowerCase();
    if (!email || !password) return res.status(401).json({ error: 'E-mail ou senha inválidos' });

    const params = [email];
    let where = 'lower(u.email)=$1 AND u.active AND t.active';
    if (tenant) {
      params.push(tenant);
      where += ' AND lower(t.slug)=$2';
    }
    const result = await query(`SELECT u.*,t.trade_name,t.slug,t.billing_status FROM users u
      JOIN tenants t ON t.id=u.tenant_id WHERE ${where} ORDER BY u.created_at LIMIT 2`, params);
    if (result.rowCount !== 1) {
      return res.status(result.rowCount > 1 ? 400 : 401).json({ error: result.rowCount > 1 ? 'Informe a academia' : 'E-mail ou senha inválidos' });
    }
    const user = result.rows[0];
    if (!await bcrypt.compare(password, user.password_hash)) return res.status(401).json({ error: 'E-mail ou senha inválidos' });
    if (['SUSPENDED','CANCELED'].includes(user.billing_status)) return res.status(402).json({ error: 'Assinatura da academia indisponível' });
    const publicUser = {
      id: user.id, tenantId: user.tenant_id, unitId: user.unit_id, name: user.name,
      email: user.email, role: user.role, tenantName: user.trade_name, tenantSlug: user.slug
    };
    const token = jwt.sign({ id: user.id }, secret, { expiresIn: '8h', subject: user.id });
    res.json({ token, user: publicUser });
  } catch (error) { next(error); }
});

app.get('/api/me', auth(), (req, res) => res.json(req.user));

app.get('/api/me/branding', auth(), async (req, res, next) => {
  try {
    const r = await query('SELECT trade_name,settings FROM tenants WHERE id=$1', [req.user.tenantId]);
    const branding = r.rows[0]?.settings?.branding || {};
    res.json({
      name: r.rows[0]?.trade_name || req.user.tenantName,
      branding: {
        primaryColor: branding.primaryColor || '#111827',
        accentColor: branding.accentColor || '#22c55e',
        logoUrl: branding.logoUrl || null
      }
    });
  } catch (error) { next(error); }
});


app.get('/api/units', auth(), async (req, res, next) => {
  try {
    const params = [req.user.tenantId];
    let filter = '';
    if (!['OWNER','ADMIN'].includes(req.user.role)) {
      params.push(req.user.id);
      filter = ` AND EXISTS(
        SELECT 1 FROM user_units uu
        WHERE uu.tenant_id=u.tenant_id AND uu.unit_id=u.id AND uu.user_id=$2
      )`;
    }
    const r = await query(`SELECT u.id,u.name,u.address,u.active,u.created_at,
      (SELECT count(*)::int FROM students s WHERE s.tenant_id=u.tenant_id AND s.unit_id=u.id AND s.status='ACTIVE') active_students,
      (SELECT count(*)::int FROM users us JOIN user_units uu ON uu.tenant_id=us.tenant_id AND uu.user_id=us.id
        WHERE us.tenant_id=u.tenant_id AND uu.unit_id=u.id AND us.role='COACH' AND us.active) active_coaches
      FROM units u WHERE u.tenant_id=$1${filter}
      ORDER BY u.active DESC,u.name`, params);
    res.json(r.rows);
  } catch (error) { next(error); }
});

app.post('/api/units', auth('OWNER','ADMIN'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const name = String(req.body?.name || '').trim();
    if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Nome da unidade inválido' });
    await client.query('BEGIN');
    await assertSaasLimit(query, req.user.tenantId, 'units');
    const r = await client.query(`INSERT INTO units(tenant_id,name,address)
      VALUES($1,$2,$3) RETURNING *`, [req.user.tenantId, name, req.body?.address || {}]);
    await audit(client, req.user, 'UNIT_CREATED', 'unit', r.rows[0].id, { name });
    await client.query('COMMIT');
    res.status(201).json(r.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Já existe uma unidade com esse nome' });
    next(error);
  } finally { client.release(); }
});

app.get('/api/dashboard', auth('OWNER','ADMIN','MANAGER','RECEPTION','FINANCE'), async (req, res, next) => {
  try {
    const unitId = String(req.query?.unitId || '').trim() || null;
    if (unitId && !await canUseUnit(req.user, unitId)) return res.status(403).json({ error: 'Sem acesso a esta unidade' });
    const [students, attendance, charges, revenue] = await Promise.all([
      query(`SELECT count(*) FILTER(WHERE status='ACTIVE')::int active,
                    count(*) FILTER(WHERE status='LEAD')::int leads
             FROM students WHERE tenant_id=$1 AND ($2::uuid IS NULL OR unit_id=$2)`, [req.user.tenantId, unitId]),
      query(`SELECT count(*)::int today FROM attendance
             WHERE tenant_id=$1 AND ($2::uuid IS NULL OR unit_id=$2)
               AND (checkin_at AT TIME ZONE (SELECT timezone FROM tenants WHERE id=$1))::date
                 = (now() AT TIME ZONE (SELECT timezone FROM tenants WHERE id=$1))::date`, [req.user.tenantId, unitId]),
      query(`SELECT count(*) FILTER(WHERE ch.status IN ('PENDING','PARTIAL','OVERDUE'))::int open_count,
                    coalesce(sum(ch.amount_cents-ch.paid_cents) FILTER(WHERE ch.status IN ('PENDING','PARTIAL','OVERDUE')),0)::bigint open_cents
             FROM charges ch JOIN students s ON s.tenant_id=ch.tenant_id AND s.id=ch.student_id
             WHERE ch.tenant_id=$1 AND ($2::uuid IS NULL OR s.unit_id=$2)`, [req.user.tenantId, unitId]),
      query(`SELECT coalesce(sum(p.amount_cents),0)::bigint month_cents FROM payments p
             JOIN charges ch ON ch.tenant_id=p.tenant_id AND ch.id=p.charge_id
             JOIN students s ON s.tenant_id=ch.tenant_id AND s.id=ch.student_id
             WHERE p.tenant_id=$1 AND ($2::uuid IS NULL OR s.unit_id=$2)
               AND date_trunc('month', p.paid_at AT TIME ZONE (SELECT timezone FROM tenants WHERE id=$1))
                 = date_trunc('month', now() AT TIME ZONE (SELECT timezone FROM tenants WHERE id=$1))`, [req.user.tenantId, unitId])
    ]);
    res.json({
      activeStudents: students.rows[0].active,
      leads: students.rows[0].leads,
      checkinsToday: attendance.rows[0].today,
      openCharges: charges.rows[0].open_count,
      receivableCents: Number(charges.rows[0].open_cents),
      revenueMonthCents: Number(revenue.rows[0].month_cents)
    });
  } catch (error) { next(error); }
});

app.get('/api/students', auth('OWNER','ADMIN','MANAGER','RECEPTION','COACH','FINANCE'), async (req, res, next) => {
  try {
    const unitId = String(req.query?.unitId || '').trim() || null;
    if (unitId && !await canUseUnit(req.user, unitId)) return res.status(403).json({ error: 'Sem acesso a esta unidade' });
    const r = await query(`SELECT s.*,u.name unit_name,
        wt.id workout_id,wt.title workout_title,wt.ends_on workout_ends_on,
        wt.estimated_minutes workout_minutes,wt.professor_name workout_professor
      FROM students s
      LEFT JOIN units u ON u.id=s.unit_id AND u.tenant_id=s.tenant_id
      LEFT JOIN LATERAL (
        SELECT wp.id,wp.title,v.ends_on,v.estimated_minutes,prof.name professor_name
        FROM workout_plans wp
        JOIN workout_plan_versions v ON v.tenant_id=wp.tenant_id
          AND v.workout_plan_id=wp.id AND v.version_number=wp.current_version
        JOIN users prof ON prof.tenant_id=v.tenant_id AND prof.id=v.created_by_user_id
        WHERE wp.tenant_id=s.tenant_id AND wp.student_id=s.id AND wp.status='ACTIVE'
        ORDER BY wp.updated_at DESC LIMIT 1
      ) wt ON true
      WHERE s.tenant_id=$1 AND ($2::uuid IS NULL OR s.unit_id=$2)
        AND ($3::text <> 'COACH' OR EXISTS(
          SELECT 1 FROM user_units uu WHERE uu.tenant_id=s.tenant_id AND uu.user_id=$4 AND uu.unit_id=s.unit_id
        ))
      ORDER BY s.created_at DESC LIMIT 500`, [req.user.tenantId, unitId, req.user.role, req.user.id]);
    res.json(r.rows);
  } catch (error) { next(error); }
});

app.post('/api/students', auth('OWNER','ADMIN','MANAGER','RECEPTION'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const name = String(req.body?.name || '').trim();
    const cpf = normalizeCpf(req.body?.cpf);
    const email = normalizeEmail(req.body?.email) || null;
    const phone = String(req.body?.phone || '').trim() || null;
    const status = ['LEAD','ACTIVE','PAUSED','INACTIVE'].includes(req.body?.status) ? req.body.status : 'LEAD';
    if (name.length < 2 || name.length > 120) return res.status(400).json({ error: 'Nome inválido' });
    if (cpf && cpf.length !== 11) return res.status(400).json({ error: 'CPF deve conter 11 dígitos' });
    await client.query('BEGIN');
    await assertSaasLimit(query, req.user.tenantId, 'students');
    const targetUnitId = req.body?.unitId || req.user.unitId;
    if (!targetUnitId || !await canUseUnit(req.user, targetUnitId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Sem acesso à unidade selecionada' });
    }
    const r = await client.query(`INSERT INTO students(tenant_id,unit_id,name,cpf,email,phone,birth_date,emergency_contact,status,notes)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [
      req.user.tenantId, targetUnitId, name, cpf, email, phone,
      req.body?.birthDate || null, String(req.body?.emergencyContact || '').trim() || null,
      status, String(req.body?.notes || '').trim() || null
    ]);
    await audit(client, req.user, 'STUDENT_CREATED', 'student', r.rows[0].id);
    await client.query('COMMIT');
    res.status(201).json(r.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'CPF já cadastrado nesta academia' });
    next(error);
  } finally { client.release(); }
});

app.get('/api/plans', auth(), async (req, res, next) => {
  try {
    const r = await query(`SELECT p.*,
      coalesce((SELECT json_agg(json_build_object('id',u.id,'name',u.name) ORDER BY u.name)
        FROM plan_units pu JOIN units u ON u.tenant_id=pu.tenant_id AND u.id=pu.unit_id
        WHERE pu.tenant_id=p.tenant_id AND pu.plan_id=p.id),'[]'::json) access_units
      FROM plans p WHERE p.tenant_id=$1 ORDER BY p.active DESC,p.price_cents,p.name`, [req.user.tenantId]);
    res.json(r.rows);
  } catch (error) { next(error); }
});

app.post('/api/plans', auth('OWNER','ADMIN','MANAGER','FINANCE'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const name = String(req.body?.name || '').trim();
    const priceCents = Number(req.body?.priceCents);
    const interval = ['MONTHLY','QUARTERLY','SEMIANNUAL','ANNUAL','CUSTOM'].includes(req.body?.billingInterval) ? req.body.billingInterval : 'MONTHLY';
    const accessScope = ['PRIMARY_UNIT','SELECTED_UNITS','ALL_UNITS'].includes(req.body?.accessScope) ? req.body.accessScope : 'PRIMARY_UNIT';
    const unitIds = Array.isArray(req.body?.unitIds) ? [...new Set(req.body.unitIds.filter(Boolean))].slice(0,100) : [];
    if (name.length < 2 || !money(priceCents)) return res.status(400).json({ error: 'Plano ou preço inválido' });
    if (accessScope === 'SELECTED_UNITS' && !unitIds.length) return res.status(400).json({ error: 'Selecione ao menos uma unidade para este plano' });
    await client.query('BEGIN');
    if (unitIds.length) {
      const units = await client.query('SELECT id FROM units WHERE tenant_id=$1 AND id = ANY($2::uuid[]) AND active', [req.user.tenantId, unitIds]);
      if (units.rowCount !== unitIds.length) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Uma ou mais unidades são inválidas' });
      }
    }
    const r = await client.query(`INSERT INTO plans(tenant_id,name,description,price_cents,billing_interval,duration_days,access_scope)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [
      req.user.tenantId, name, String(req.body?.description || '').trim() || null,
      priceCents, interval, req.body?.durationDays || null, accessScope
    ]);
    for (const unitId of unitIds) {
      await client.query('INSERT INTO plan_units(tenant_id,plan_id,unit_id) VALUES($1,$2,$3)', [req.user.tenantId, r.rows[0].id, unitId]);
    }
    await audit(client, req.user, 'PLAN_CREATED', 'plan', r.rows[0].id);
    await client.query('COMMIT');
    res.status(201).json(r.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Já existe um plano com esse nome' });
    next(error);
  } finally { client.release(); }
});

app.get('/api/enrollments', auth('OWNER','ADMIN','MANAGER','RECEPTION','FINANCE'), async (req, res, next) => {
  try {
    const r = await query(`SELECT e.*,s.name student_name,p.name plan_name,p.price_cents
      FROM enrollments e JOIN students s ON s.id=e.student_id JOIN plans p ON p.id=e.plan_id
      WHERE e.tenant_id=$1 ORDER BY e.created_at DESC LIMIT 500`, [req.user.tenantId]);
    res.json(r.rows);
  } catch (error) { next(error); }
});

app.post('/api/enrollments', auth('OWNER','ADMIN','MANAGER','RECEPTION'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const { studentId, planId } = req.body || {};
    const startsOn = req.body?.startsOn || todayInTimeZone(req.user.timezone);
    if (!studentId || !planId || !date(startsOn)) return res.status(400).json({ error: 'Aluno, plano e início são obrigatórios' });
    await client.query('BEGIN');
    const [student, plan] = await Promise.all([
      client.query('SELECT id FROM students WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [studentId, req.user.tenantId]),
      client.query('SELECT id,price_cents FROM plans WHERE id=$1 AND tenant_id=$2 AND active', [planId, req.user.tenantId])
    ]);
    if (!student.rowCount || !plan.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Aluno ou plano não encontrado' });
    }
    const billingDay = Math.min(Number(String(startsOn).slice(8,10)) || 1, 28);
    const e = await client.query(`INSERT INTO enrollments(
      tenant_id,student_id,plan_id,starts_on,ends_on,discount_cents,billing_day,next_billing_on
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$4) RETURNING *`, [
      req.user.tenantId, studentId, planId, startsOn, req.body?.endsOn || null, Number(req.body?.discountCents || 0), billingDay
    ]);
    await client.query(`INSERT INTO enrollment_events(
      tenant_id,enrollment_id,actor_user_id,event_type,to_status,metadata
    ) VALUES($1,$2,$3,'CREATED','ACTIVE',$4)`,[
      req.user.tenantId,e.rows[0].id,req.user.id,{studentId,planId,startsOn}
    ]);
    await client.query(`UPDATE students SET status='ACTIVE',updated_at=now() WHERE id=$1 AND tenant_id=$2`, [studentId, req.user.tenantId]);
    await audit(client, req.user, 'ENROLLMENT_CREATED', 'enrollment', e.rows[0].id, { studentId, planId, billingDay });
    await client.query('COMMIT');
    res.status(201).json(e.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
});

app.get('/api/classes', auth(), async (req, res, next) => {
  try {
    const unitId = String(req.query?.unitId || '').trim() || null;
    if (unitId && !await canUseUnit(req.user, unitId)) return res.status(403).json({ error: 'Sem acesso a esta unidade' });
    const r = await query(`SELECT c.*,u.name unit_name,co.name coach_name FROM classes c
      LEFT JOIN units u ON u.id=c.unit_id AND u.tenant_id=c.tenant_id
      LEFT JOIN users co ON co.id=c.coach_user_id AND co.tenant_id=c.tenant_id
      WHERE c.tenant_id=$1 AND ($2::uuid IS NULL OR c.unit_id=$2)
        AND ($3::text <> 'COACH' OR c.coach_user_id=$4)
      ORDER BY c.weekday NULLS LAST,c.starts_at NULLS LAST,c.name`, [req.user.tenantId, unitId, req.user.role, req.user.id]);
    res.json(r.rows);
  } catch (error) { next(error); }
});

app.post('/api/classes', auth('OWNER','ADMIN','MANAGER'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const name = String(req.body?.name || '').trim();
    const modality = String(req.body?.modality || '').trim();
    if (name.length < 2 || modality.length < 2) return res.status(400).json({ error: 'Nome e modalidade são obrigatórios' });
    await client.query('BEGIN');
    const targetUnitId = req.body?.unitId || req.user.unitId;
    if (!targetUnitId || !await canUseUnit(req.user, targetUnitId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Sem acesso à unidade selecionada' });
    }
    if (req.body?.coachUserId) {
      const coachUnit = await client.query(`SELECT 1 FROM users u
        JOIN user_units uu ON uu.tenant_id=u.tenant_id AND uu.user_id=u.id
        WHERE u.tenant_id=$1 AND u.id=$2 AND u.role='COACH' AND u.active AND uu.unit_id=$3`, [
        req.user.tenantId, req.body.coachUserId, targetUnitId
      ]);
      if (!coachUnit.rowCount) {
        await client.query('ROLLBACK');
        return res.status(409).json({ error: 'Professor não está vinculado a esta unidade' });
      }
    }
    const r = await client.query(`INSERT INTO classes(tenant_id,unit_id,coach_user_id,name,modality,capacity,weekday,starts_at,ends_at)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`, [
      req.user.tenantId, targetUnitId, req.body?.coachUserId || null,
      name, modality, req.body?.capacity || null, req.body?.weekday ?? null,
      req.body?.startsAt || null, req.body?.endsAt || null
    ]);
    await audit(client, req.user, 'CLASS_CREATED', 'class', r.rows[0].id);
    await client.query('COMMIT');
    res.status(201).json(r.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
});

app.get('/api/attendance', auth('OWNER','ADMIN','MANAGER','RECEPTION','COACH'), async (req, res, next) => {
  try {
    const unitId = String(req.query?.unitId || '').trim() || null;
    if (unitId && !await canUseUnit(req.user, unitId)) return res.status(403).json({ error: 'Sem acesso a esta unidade' });
    const r = await query(`SELECT a.*,s.name student_name,c.name class_name,u.name unit_name FROM attendance a
      JOIN students s ON s.id=a.student_id AND s.tenant_id=a.tenant_id
      LEFT JOIN classes c ON c.id=a.class_id AND c.tenant_id=a.tenant_id
      LEFT JOIN units u ON u.id=a.unit_id AND u.tenant_id=a.tenant_id
      WHERE a.tenant_id=$1 AND ($2::uuid IS NULL OR a.unit_id=$2)
        AND ($3::text <> 'COACH' OR c.coach_user_id=$4 OR EXISTS(
          SELECT 1 FROM coach_students cs
          WHERE cs.tenant_id=a.tenant_id AND cs.student_id=a.student_id AND cs.coach_user_id=$4 AND cs.active
        ))
      ORDER BY a.checkin_at DESC LIMIT 300`, [req.user.tenantId, unitId, req.user.role, req.user.id]);
    res.json(r.rows);
  } catch (error) { next(error); }
});

app.post('/api/attendance/check-in', auth('OWNER','ADMIN','MANAGER','RECEPTION','COACH'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const studentId = req.body?.studentId;
    const classId = req.body?.classId || null;
    const key = String(req.get('Idempotency-Key') || '').trim();
    if (!studentId) return res.status(400).json({ error: 'Aluno é obrigatório' });
    await client.query('BEGIN');

    if (key) {
      const existing = await client.query(`SELECT response FROM idempotency_keys
        WHERE tenant_id=$1 AND scope='ATTENDANCE_CHECKIN' AND idempotency_key=$2`, [req.user.tenantId, key]);
      if (existing.rowCount) {
        await client.query('ROLLBACK');
        return res.status(200).json(existing.rows[0].response);
      }
    }

    const student = await client.query(`SELECT id,status FROM students WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [studentId, req.user.tenantId]);
    if (!student.rowCount || student.rows[0].status !== 'ACTIVE') {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Aluno inexistente ou inativo' });
    }
    let targetUnitId = req.body?.unitId || req.user.unitId;
    if (classId) {
      const cls = await client.query('SELECT unit_id,coach_user_id FROM classes WHERE id=$1 AND tenant_id=$2 AND active', [classId, req.user.tenantId]);
      if (!cls.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Turma não encontrada' });
      }
      targetUnitId = cls.rows[0].unit_id;
      if (req.user.role === 'COACH' && cls.rows[0].coach_user_id !== req.user.id) {
        await client.query('ROLLBACK');
        return res.status(403).json({ error: 'Professor não está vinculado a esta turma' });
      }
    }
    if (!targetUnitId || !await canUseUnit(req.user, targetUnitId)) {
      await client.query('ROLLBACK');
      return res.status(403).json({ error: 'Sem acesso à unidade selecionada' });
    }
    const enrollment = await client.query(`SELECT 1 FROM enrollments e
      JOIN plans p ON p.tenant_id=e.tenant_id AND p.id=e.plan_id AND p.active
      JOIN students s ON s.tenant_id=e.tenant_id AND s.id=e.student_id
      WHERE e.tenant_id=$1 AND e.student_id=$2
        AND e.status='ACTIVE'
        AND e.starts_on <= (now() AT TIME ZONE (SELECT timezone FROM tenants WHERE id=$1))::date
        AND (e.ends_on IS NULL OR e.ends_on >= (now() AT TIME ZONE (SELECT timezone FROM tenants WHERE id=$1))::date)
        AND (
          p.access_scope='ALL_UNITS'
          OR (p.access_scope='PRIMARY_UNIT' AND s.unit_id=$3)
          OR (p.access_scope='SELECTED_UNITS' AND EXISTS(
            SELECT 1 FROM plan_units pu WHERE pu.tenant_id=p.tenant_id AND pu.plan_id=p.id AND pu.unit_id=$3
          ))
        )
      LIMIT 1`, [req.user.tenantId, studentId, targetUnitId]);
    if (!enrollment.rowCount) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Plano do aluno não permite acesso a esta unidade' });
    }
    const r = await client.query(`INSERT INTO attendance(tenant_id,unit_id,student_id,class_id,source)
      VALUES($1,$2,$3,$4,$5) RETURNING *`, [req.user.tenantId, targetUnitId, studentId, classId, req.body?.source || 'RECEPTION']);
    const response = { attendance: r.rows[0] };
    if (key) await client.query(`INSERT INTO idempotency_keys(tenant_id,scope,idempotency_key,response)
      VALUES($1,'ATTENDANCE_CHECKIN',$2,$3)`, [req.user.tenantId, key, response]);
    await audit(client, req.user, 'CHECKIN_CREATED', 'attendance', r.rows[0].id, { studentId, classId, unitId: targetUnitId });
    await client.query('COMMIT');
    res.status(201).json(response);
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') {
      const existing = await query(`SELECT response FROM idempotency_keys
        WHERE tenant_id=$1 AND scope='ATTENDANCE_CHECKIN' AND idempotency_key=$2`, [req.user.tenantId, String(req.get('Idempotency-Key') || '')]);
      if (existing.rowCount) return res.status(200).json(existing.rows[0].response);
    }
    next(error);
  } finally { client.release(); }
});

app.get('/api/charges', auth('OWNER','ADMIN','MANAGER','RECEPTION','FINANCE'), async (req, res, next) => {
  try {
    const unitId = String(req.query?.unitId || '').trim() || null;
    if (unitId && !await canUseUnit(req.user, unitId)) return res.status(403).json({ error: 'Sem acesso a esta unidade' });
    const r = await query(`SELECT ch.*,s.name student_name,u.name unit_name FROM charges ch
      JOIN students s ON s.id=ch.student_id AND s.tenant_id=ch.tenant_id
      LEFT JOIN units u ON u.id=s.unit_id AND u.tenant_id=s.tenant_id
      WHERE ch.tenant_id=$1 AND ($2::uuid IS NULL OR s.unit_id=$2)
      ORDER BY ch.due_date DESC,ch.created_at DESC LIMIT 500`, [req.user.tenantId, unitId]);
    res.json(r.rows);
  } catch (error) { next(error); }
});

app.post('/api/charges', auth('OWNER','ADMIN','MANAGER','FINANCE'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const amountCents = Number(req.body?.amountCents);
    const dueDate = String(req.body?.dueDate || '');
    const description = String(req.body?.description || '').trim();
    if (!req.body?.studentId || !money(amountCents) || amountCents <= 0 || !date(dueDate) || !description) {
      return res.status(400).json({ error: 'Cobrança inválida' });
    }
    await client.query('BEGIN');
    const student = await client.query('SELECT 1 FROM students WHERE id=$1 AND tenant_id=$2', [req.body.studentId, req.user.tenantId]);
    if (!student.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Aluno não encontrado' });
    }
    const r = await client.query(`INSERT INTO charges(tenant_id,student_id,enrollment_id,description,due_date,amount_cents)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [
      req.user.tenantId, req.body.studentId, req.body?.enrollmentId || null, description, dueDate, amountCents
    ]);
    await audit(client, req.user, 'CHARGE_CREATED', 'charge', r.rows[0].id);
    await client.query('COMMIT');
    res.status(201).json(r.rows[0]);
  } catch (error) {
    await client.query('ROLLBACK');
    next(error);
  } finally { client.release(); }
});

app.post('/api/charges/:id/pay', auth('OWNER','ADMIN','RECEPTION','FINANCE'), async (req, res, next) => {
  const client = await pool.connect();
  try {
    const amountCents = Number(req.body?.amountCents);
    const method = ['PIX','CARD','CASH','BANK_SLIP','TRANSFER','OTHER'].includes(req.body?.method) ? req.body.method : null;
    if (!money(amountCents) || amountCents <= 0 || !method) return res.status(400).json({ error: 'Pagamento inválido' });
    await client.query('BEGIN');
    const charge = await client.query(`SELECT * FROM charges WHERE id=$1 AND tenant_id=$2 FOR UPDATE`, [req.params.id, req.user.tenantId]);
    if (!charge.rowCount) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Cobrança não encontrada' });
    }
    const ch = charge.rows[0];
    const outstanding = ch.amount_cents - ch.paid_cents;
    if (amountCents > outstanding || ['PAID','CANCELED'].includes(ch.status)) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Valor excede o saldo da cobrança ou cobrança encerrada' });
    }
    const payment = await client.query(`INSERT INTO payments(tenant_id,charge_id,amount_cents,method,provider,external_id)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING *`, [
      req.user.tenantId, ch.id, amountCents, method, req.body?.provider || 'MANUAL', req.body?.externalId || null
    ]);
    const newPaid = ch.paid_cents + amountCents;
    const status = newPaid === ch.amount_cents ? 'PAID' : 'PARTIAL';
    await client.query('UPDATE charges SET paid_cents=$1,status=$2 WHERE id=$3 AND tenant_id=$4', [newPaid, status, ch.id, req.user.tenantId]);
    await audit(client, req.user, 'PAYMENT_RECORDED', 'payment', payment.rows[0].id, { chargeId: ch.id, amountCents, method });
    await client.query('COMMIT');
    res.status(201).json({ payment: payment.rows[0], chargeStatus: status, paidCents: newPaid });
  } catch (error) {
    await client.query('ROLLBACK');
    if (error.code === '23505') return res.status(409).json({ error: 'Pagamento externo já processado' });
    next(error);
  } finally { client.release(); }
});

app.get('/api/financial/summary', auth('OWNER','ADMIN','MANAGER','FINANCE'), async (req, res, next) => {
  try {
    const unitId = String(req.query?.unitId || '').trim() || null;
    if (unitId && !await canUseUnit(req.user, unitId)) return res.status(403).json({ error: 'Sem acesso a esta unidade' });
    const r = await query(`SELECT
      coalesce(sum(ch.amount_cents),0)::bigint total_charged_cents,
      coalesce(sum(ch.paid_cents),0)::bigint total_paid_cents,
      coalesce(sum(ch.amount_cents-ch.paid_cents) FILTER(WHERE ch.status IN ('PENDING','PARTIAL','OVERDUE')),0)::bigint receivable_cents
      FROM charges ch JOIN students s ON s.tenant_id=ch.tenant_id AND s.id=ch.student_id
      WHERE ch.tenant_id=$1 AND ($2::uuid IS NULL OR s.unit_id=$2)`, [req.user.tenantId, unitId]);
    res.json({
      totalChargedCents: Number(r.rows[0].total_charged_cents),
      totalPaidCents: Number(r.rows[0].total_paid_cents),
      receivableCents: Number(r.rows[0].receivable_cents)
    });
  } catch (error) { next(error); }
});

app.get('/api/billing/status', auth('OWNER','ADMIN'), async (req, res, next) => {
  try {
    const r = await query('SELECT saas_plan,billing_status FROM tenants WHERE id=$1', [req.user.tenantId]);
    const usage = await usageForTenant(query, req.user.tenantId);
    res.json({ plan: r.rows[0].saas_plan, status: r.rows[0].billing_status, provider: 'not_configured', usage });
  } catch (error) { next(error); }
});

app.use('/api/access', buildAccessRouter({ auth, audit, pool, query }));
app.use('/api/training', buildTrainingRouter({ auth, audit, pool, query }));
app.use('/api/members', buildMemberRouter({ auth, audit, pool, query }));
app.use('/api/platform', buildPlatformRouter({ pool, query, platformSecret }));
app.use('/api/integrations', buildAsaasRouter({ auth, audit, pool, query }));

app.get('/api/audit', auth('OWNER','ADMIN'), async (req, res, next) => {
  try {
    const r = await query(`SELECT a.*,u.name user_name FROM audit_logs a LEFT JOIN users u ON u.id=a.user_id
      WHERE a.tenant_id=$1 ORDER BY a.created_at DESC LIMIT 300`, [req.user.tenantId]);
    res.json(r.rows);
  } catch (error) { next(error); }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  if (error?.message === 'Origem não autorizada') return res.status(403).json({ error: error.message });
  if (error?.statusCode) return res.status(error.statusCode).json({
    error: error.message,
    ...(error.code ? { code: error.code } : {}),
    ...(error.resource ? { resource: error.resource } : {}),
    ...(error.limit != null ? { limit: error.limit } : {})
  });
  res.status(500).json({ error: 'Erro interno' });
});

export async function start() {
  if (process.env.NODE_ENV === 'production' && secret.length < 32) {
    throw new Error('JWT_SECRET deve ter pelo menos 32 caracteres em produção');
  }
  await migrate();
  await bootstrap();
  return app.listen(Number(process.env.PORT || 3333));
}

if (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT) {
  start().catch(error => {
    console.error(error);
    process.exit(1);
  });
}

export default app;
