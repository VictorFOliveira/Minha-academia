import { Router } from 'express';
import bcrypt from 'bcryptjs';

const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(String(value || ''));
const clean = (value, max = 255) => String(value || '').trim().slice(0, max);
const normalizeEmail = value => clean(value, 320).toLowerCase();

function localToday(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

async function insertItems(client, tenantId, versionId, items) {
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index] || {};
    const label = clean(item.workoutLabel || 'A', 20) || 'A';
    const sets = item.sets == null || item.sets === '' ? null : Number(item.sets);
    const rest = item.restSeconds == null || item.restSeconds === '' ? null : Number(item.restSeconds);
    if (!item.exerciseId) throw Object.assign(new Error('Exercício é obrigatório'), { status: 400 });
    if (sets != null && (!Number.isInteger(sets) || sets < 1 || sets > 100)) {
      throw Object.assign(new Error('Quantidade de séries inválida'), { status: 400 });
    }
    if (rest != null && (!Number.isInteger(rest) || rest < 0 || rest > 3600)) {
      throw Object.assign(new Error('Descanso inválido'), { status: 400 });
    }
    const exercise = await client.query(
      'SELECT id FROM exercises WHERE id=$1 AND tenant_id=$2 AND active',
      [item.exerciseId, tenantId]
    );
    if (!exercise.rowCount) throw Object.assign(new Error('Exercício não encontrado'), { status: 404 });

    await client.query(`INSERT INTO workout_plan_items(
      tenant_id,workout_version_id,exercise_id,workout_label,position,sets,reps,load,rest_seconds,tempo,notes
    ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
      tenantId, versionId, item.exerciseId, label, index + 1, sets,
      clean(item.reps, 60) || null, clean(item.load, 60) || null, rest,
      clean(item.tempo, 60) || null, clean(item.notes, 500) || null
    ]);
  }
}

export function buildTrainingRouter({ auth, audit, pool, query }) {
  const router = Router();

  router.get('/coaches', auth('OWNER','ADMIN','MANAGER','COACH'), async (req, res, next) => {
    try {
      const params = [req.user.tenantId];
      let filter = '';
      if (req.user.role === 'COACH') {
        params.push(req.user.id);
        filter += ` AND u.id=${params.length}`;
      }
      if (req.query.unitId) {
        params.push(req.query.unitId);
        filter += ` AND EXISTS(
          SELECT 1 FROM user_units uf WHERE uf.tenant_id=u.tenant_id AND uf.user_id=u.id AND uf.unit_id=${params.length}
        )`;
      }
      const r = await query(`SELECT u.id,u.unit_id,u.name,u.email,u.active,u.created_at,un.name unit_name,
        cp.phone,cp.registration_number,cp.specialties,cp.bio,cp.active profile_active,
        coalesce((SELECT json_agg(json_build_object('id',uu.unit_id,'name',ux.name,'isPrimary',uu.is_primary) ORDER BY uu.is_primary DESC,ux.name)
          FROM user_units uu JOIN units ux ON ux.tenant_id=uu.tenant_id AND ux.id=uu.unit_id
          WHERE uu.tenant_id=u.tenant_id AND uu.user_id=u.id),'[]'::json) units,
        (SELECT count(*)::int FROM coach_students cs WHERE cs.tenant_id=u.tenant_id AND cs.coach_user_id=u.id AND cs.active) student_count,
        (SELECT count(*)::int FROM classes c WHERE c.tenant_id=u.tenant_id AND c.coach_user_id=u.id AND c.active) class_count
        FROM users u
        LEFT JOIN coach_profiles cp ON cp.tenant_id=u.tenant_id AND cp.user_id=u.id
        LEFT JOIN units un ON un.tenant_id=u.tenant_id AND un.id=u.unit_id
        WHERE u.tenant_id=$1 AND u.role='COACH'${filter}
        ORDER BY u.active DESC,u.name`, params);
      res.json(r.rows);
    } catch (error) { next(error); }
  });

  router.post('/coaches', auth('OWNER','ADMIN'), async (req, res, next) => {
    const client = await pool.connect();
    try {
      const name = clean(req.body?.name, 120);
      const email = normalizeEmail(req.body?.email);
      const password = String(req.body?.password || '');
      const requestedUnitIds = Array.isArray(req.body?.unitIds) ? req.body.unitIds.filter(Boolean) : [];
      const unitIds = [...new Set(requestedUnitIds.length ? requestedUnitIds : [req.body?.unitId || req.user.unitId].filter(Boolean))].slice(0,100);
      const unitId = req.body?.unitId || unitIds[0] || req.user.unitId;
      const specialties = Array.isArray(req.body?.specialties)
        ? req.body.specialties.map(x => clean(x, 80)).filter(Boolean).slice(0, 20)
        : clean(req.body?.specialties, 500).split(',').map(x => x.trim()).filter(Boolean).slice(0, 20);
      if (name.length < 2 || !email.includes('@') || password.length < 8 || !unitId) {
        return res.status(400).json({ error: 'Nome, e-mail, senha de 8+ caracteres e unidade são obrigatórios' });
      }
      await client.query('BEGIN');
      const units = await client.query('SELECT id FROM units WHERE tenant_id=$1 AND id = ANY($2::uuid[]) AND active', [req.user.tenantId, unitIds]);
      if (!unitIds.length || units.rowCount !== unitIds.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Uma ou mais unidades não foram encontradas' });
      }
      const passwordHash = await bcrypt.hash(password, 12);
      const u = await client.query(`INSERT INTO users(tenant_id,unit_id,name,email,password_hash,role)
        VALUES($1,$2,$3,$4,$5,'COACH') RETURNING id,unit_id,name,email,role,active,created_at`, [
        req.user.tenantId, unitId, name, email, passwordHash
      ]);
      for (const linkedUnitId of unitIds) {
        await client.query(`INSERT INTO user_units(tenant_id,user_id,unit_id,is_primary)
          VALUES($1,$2,$3,$4)`, [req.user.tenantId, u.rows[0].id, linkedUnitId, linkedUnitId === unitId]);
      }
      await client.query(`INSERT INTO coach_profiles(
        tenant_id,user_id,phone,registration_number,specialties,bio
      ) VALUES($1,$2,$3,$4,$5,$6)`, [
        req.user.tenantId, u.rows[0].id, clean(req.body?.phone, 40) || null,
        clean(req.body?.registrationNumber, 80) || null, specialties,
        clean(req.body?.bio, 1000) || null
      ]);
      await audit(client, req.user, 'COACH_CREATED', 'user', u.rows[0].id, { email, unitId, unitIds, specialties });
      await client.query('COMMIT');
      res.status(201).json(u.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'E-mail já cadastrado nesta academia' });
      next(error);
    } finally { client.release(); }
  });

  router.get('/coach/dashboard', auth('COACH'), async (req, res, next) => {
    try {
      const [students, classes, workouts, expiring] = await Promise.all([
        query(`SELECT count(*)::int total FROM coach_students
          WHERE tenant_id=$1 AND coach_user_id=$2 AND active`, [req.user.tenantId, req.user.id]),
        query(`SELECT count(*)::int total FROM classes
          WHERE tenant_id=$1 AND coach_user_id=$2 AND active`, [req.user.tenantId, req.user.id]),
        query(`SELECT count(DISTINCT wp.id)::int total FROM workout_plans wp
          JOIN workout_plan_versions v ON v.tenant_id=wp.tenant_id AND v.workout_plan_id=wp.id
          WHERE wp.tenant_id=$1 AND v.created_by_user_id=$2 AND wp.status='ACTIVE'`, [req.user.tenantId, req.user.id]),
        query(`SELECT count(*)::int total FROM workout_plans wp
          JOIN workout_plan_versions v ON v.tenant_id=wp.tenant_id AND v.workout_plan_id=wp.id AND v.version_number=wp.current_version
          WHERE wp.tenant_id=$1 AND v.created_by_user_id=$2 AND wp.status='ACTIVE'
            AND v.ends_on IS NOT NULL
            AND v.ends_on BETWEEN
              (now() AT TIME ZONE (SELECT timezone FROM tenants WHERE id=$1))::date
              AND ((now() AT TIME ZONE (SELECT timezone FROM tenants WHERE id=$1))::date + 7)`, [
          req.user.tenantId, req.user.id
        ])
      ]);
      res.json({
        assignedStudents: students.rows[0].total,
        activeClasses: classes.rows[0].total,
        activeWorkouts: workouts.rows[0].total,
        workoutsExpiringSoon: expiring.rows[0].total
      });
    } catch (error) { next(error); }
  });

  router.get('/equipment', auth('OWNER','ADMIN','MANAGER','RECEPTION','COACH'), async (req, res, next) => {
    try {
      const unitId = String(req.query?.unitId || '').trim() || null;
      const params = [req.user.tenantId, unitId];
      let coachFilter = '';
      if (req.user.role === 'COACH') {
        params.push(req.user.id);
        coachFilter = ` AND (ge.unit_id IS NULL OR EXISTS(
          SELECT 1 FROM user_units uu WHERE uu.tenant_id=ge.tenant_id AND uu.user_id=$3 AND uu.unit_id=ge.unit_id
        ))`;
      }
      const r = await query(`SELECT ge.*,u.name unit_name,
        (SELECT count(*)::int FROM exercises e WHERE e.tenant_id=ge.tenant_id AND e.equipment_id=ge.id AND e.active) exercise_count
        FROM gym_equipment ge
        LEFT JOIN units u ON u.tenant_id=ge.tenant_id AND u.id=ge.unit_id
        WHERE ge.tenant_id=$1 AND ($2::uuid IS NULL OR ge.unit_id IS NULL OR ge.unit_id=$2)${coachFilter}
        ORDER BY ge.active DESC,ge.name`, params);
      res.json(r.rows);
    } catch (error) { next(error); }
  });

  router.post('/equipment', auth('OWNER','ADMIN','MANAGER'), async (req, res, next) => {
    const client = await pool.connect();
    try {
      const name = clean(req.body?.name, 160);
      const unitId = req.body?.global === true ? null : (req.body?.unitId || req.user.unitId);
      if (name.length < 2) return res.status(400).json({ error: 'Nome do equipamento é obrigatório' });
      await client.query('BEGIN');
      if (unitId) {
        const unit = await client.query('SELECT id FROM units WHERE id=$1 AND tenant_id=$2 AND active', [unitId, req.user.tenantId]);
        if (!unit.rowCount) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Unidade não encontrada' });
        }
      }
      const r = await client.query(`INSERT INTO gym_equipment(
        tenant_id,unit_id,name,category,manufacturer,model,location,instructions
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [
        req.user.tenantId, unitId || null, name, clean(req.body?.category, 100) || null,
        clean(req.body?.manufacturer, 100) || null, clean(req.body?.model, 100) || null,
        clean(req.body?.location, 120) || null, clean(req.body?.instructions, 2000) || null
      ]);
      await audit(client, req.user, 'EQUIPMENT_CREATED', 'gym_equipment', r.rows[0].id);
      await client.query('COMMIT');
      res.status(201).json(r.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'Equipamento com esse nome já existe' });
      next(error);
    } finally { client.release(); }
  });

  router.get('/exercises', auth('OWNER','ADMIN','MANAGER','RECEPTION','COACH'), async (req, res, next) => {
    try {
      const unitId = String(req.query?.unitId || '').trim() || null;
      const params = [req.user.tenantId, unitId];
      let coachFilter = '';
      if (req.user.role === 'COACH') {
        params.push(req.user.id);
        coachFilter = ` AND (ge.id IS NULL OR ge.unit_id IS NULL OR EXISTS(
          SELECT 1 FROM user_units uu WHERE uu.tenant_id=e.tenant_id AND uu.user_id=$3 AND uu.unit_id=ge.unit_id
        ))`;
      }
      const r = await query(`SELECT e.*,ge.name equipment_name,ge.unit_id equipment_unit_id,gu.name equipment_unit_name,u.name created_by_name
        FROM exercises e
        LEFT JOIN gym_equipment ge ON ge.tenant_id=e.tenant_id AND ge.id=e.equipment_id
        LEFT JOIN units gu ON gu.tenant_id=ge.tenant_id AND gu.id=ge.unit_id
        LEFT JOIN users u ON u.tenant_id=e.tenant_id AND u.id=e.created_by_user_id
        WHERE e.tenant_id=$1 AND ($2::uuid IS NULL OR ge.id IS NULL OR ge.unit_id IS NULL OR ge.unit_id=$2)${coachFilter}
        ORDER BY e.active DESC,e.muscle_group NULLS LAST,e.name`, params);
      res.json(r.rows);
    } catch (error) { next(error); }
  });

  router.post('/exercises', auth('OWNER','ADMIN','MANAGER','COACH'), async (req, res, next) => {
    const client = await pool.connect();
    try {
      const name = clean(req.body?.name, 160);
      const instructions = clean(req.body?.instructions, 4000);
      const equipmentId = req.body?.equipmentId || null;
      if (name.length < 2 || instructions.length < 5) {
        return res.status(400).json({ error: 'Nome e instruções do exercício são obrigatórios' });
      }
      await client.query('BEGIN');
      if (equipmentId) {
        const equipment = await client.query(`SELECT ge.id,ge.unit_id FROM gym_equipment ge
          WHERE ge.id=$1 AND ge.tenant_id=$2 AND ge.active
            AND ($3::text <> 'COACH' OR ge.unit_id IS NULL OR EXISTS(
              SELECT 1 FROM user_units uu WHERE uu.tenant_id=ge.tenant_id AND uu.user_id=$4 AND uu.unit_id=ge.unit_id
            ))`, [equipmentId, req.user.tenantId, req.user.role, req.user.id]);
        if (!equipment.rowCount) {
          await client.query('ROLLBACK');
          return res.status(404).json({ error: 'Equipamento não encontrado' });
        }
      }
      const r = await client.query(`INSERT INTO exercises(
        tenant_id,equipment_id,name,muscle_group,instructions,video_url,created_by_user_id
      ) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [
        req.user.tenantId, equipmentId, name, clean(req.body?.muscleGroup, 100) || null,
        instructions, clean(req.body?.videoUrl, 1000) || null, req.user.id
      ]);
      await audit(client, req.user, 'EXERCISE_CREATED', 'exercise', r.rows[0].id, { equipmentId });
      await client.query('COMMIT');
      res.status(201).json(r.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.code === '23505') return res.status(409).json({ error: 'Exercício com esse nome já existe' });
      next(error);
    } finally { client.release(); }
  });

  router.get('/workouts', auth('OWNER','ADMIN','MANAGER','RECEPTION','COACH'), async (req, res, next) => {
    try {
      const params = [req.user.tenantId];
      let filter = '';
      if (req.query.studentId) {
        params.push(req.query.studentId);
        filter += ` AND wp.student_id=${params.length}`;
      }
      if (req.query.unitId) {
        params.push(req.query.unitId);
        filter += ` AND s.unit_id=${params.length}`;
      }
      if (req.user.role === 'COACH') {
        params.push(req.user.id);
        filter += ` AND (
          EXISTS(SELECT 1 FROM coach_students cs WHERE cs.tenant_id=wp.tenant_id AND cs.student_id=wp.student_id AND cs.coach_user_id=${params.length} AND cs.active)
          OR EXISTS(SELECT 1 FROM workout_plan_versions cv WHERE cv.tenant_id=wp.tenant_id AND cv.workout_plan_id=wp.id AND cv.created_by_user_id=${params.length})
          OR EXISTS(SELECT 1 FROM user_units uu WHERE uu.tenant_id=wp.tenant_id AND uu.user_id=${params.length} AND uu.unit_id=s.unit_id)
        )`;
      }
      const r = await query(`SELECT wp.*,s.name student_name,v.id current_version_id,v.starts_on,v.ends_on,v.goal,
        v.notes,v.estimated_minutes,v.created_at version_created_at,u.name prescribed_by_name,u.id prescribed_by_user_id,
        (SELECT count(*)::int FROM workout_plan_versions vh WHERE vh.tenant_id=wp.tenant_id AND vh.workout_plan_id=wp.id) version_count,
        (SELECT count(*)::int FROM workout_plan_items wi WHERE wi.tenant_id=wp.tenant_id AND wi.workout_version_id=v.id) exercise_count
        FROM workout_plans wp
        JOIN students s ON s.tenant_id=wp.tenant_id AND s.id=wp.student_id
        JOIN workout_plan_versions v ON v.tenant_id=wp.tenant_id AND v.workout_plan_id=wp.id AND v.version_number=wp.current_version
        JOIN users u ON u.tenant_id=v.tenant_id AND u.id=v.created_by_user_id
        WHERE wp.tenant_id=$1${filter}
        ORDER BY wp.updated_at DESC LIMIT 500`, params);
      res.json(r.rows);
    } catch (error) { next(error); }
  });

  router.get('/workouts/:id/history', auth('OWNER','ADMIN','MANAGER','RECEPTION','COACH'), async (req, res, next) => {
    try {
      const plan = await query(`SELECT wp.*,s.name student_name FROM workout_plans wp
        JOIN students s ON s.tenant_id=wp.tenant_id AND s.id=wp.student_id
        WHERE wp.id=$1 AND wp.tenant_id=$2 LIMIT 1`, [req.params.id, req.user.tenantId]);
      if (!plan.rowCount) return res.status(404).json({ error: 'Ficha de treino não encontrada' });
      if (req.user.role === 'COACH') {
        const allowed = await query(`SELECT 1 WHERE EXISTS(
          SELECT 1 FROM coach_students WHERE tenant_id=$1 AND student_id=$2 AND coach_user_id=$3 AND active
        ) OR EXISTS(
          SELECT 1 FROM workout_plan_versions WHERE tenant_id=$1 AND workout_plan_id=$4 AND created_by_user_id=$3
        )`, [req.user.tenantId, plan.rows[0].student_id, req.user.id, req.params.id]);
        if (!allowed.rowCount) return res.status(403).json({ error: 'Sem permissão para esta ficha' });
      }
      const versions = await query(`SELECT v.*,u.name prescribed_by_name
        FROM workout_plan_versions v JOIN users u ON u.tenant_id=v.tenant_id AND u.id=v.created_by_user_id
        WHERE v.tenant_id=$1 AND v.workout_plan_id=$2 ORDER BY v.version_number DESC`, [req.user.tenantId, req.params.id]);
      const ids = versions.rows.map(v => v.id);
      const items = ids.length ? await query(`SELECT wi.*,e.name exercise_name,e.muscle_group,ge.name equipment_name
        FROM workout_plan_items wi
        JOIN exercises e ON e.tenant_id=wi.tenant_id AND e.id=wi.exercise_id
        LEFT JOIN gym_equipment ge ON ge.tenant_id=e.tenant_id AND ge.id=e.equipment_id
        WHERE wi.tenant_id=$1 AND wi.workout_version_id = ANY($2::uuid[])
        ORDER BY wi.workout_label,wi.position`, [req.user.tenantId, ids]) : { rows: [] };
      res.json({
        plan: plan.rows[0],
        versions: versions.rows.map(version => ({
          ...version,
          items: items.rows.filter(item => item.workout_version_id === version.id)
        }))
      });
    } catch (error) { next(error); }
  });

  router.post('/workouts', auth('OWNER','ADMIN','MANAGER','COACH'), async (req, res, next) => {
    const client = await pool.connect();
    try {
      const studentId = req.body?.studentId;
      const title = clean(req.body?.title, 160);
      const startsOn = req.body?.startsOn || localToday(req.user.timezone);
      const endsOn = req.body?.endsOn || null;
      const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 100) : [];
      const estimatedMinutes = req.body?.estimatedMinutes == null || req.body?.estimatedMinutes === '' ? null : Number(req.body.estimatedMinutes);
      if (!studentId || title.length < 2 || !validDate(startsOn) || (endsOn && !validDate(endsOn)) || !items.length) {
        return res.status(400).json({ error: 'Aluno, título, vigência e ao menos um exercício são obrigatórios' });
      }
      if (endsOn && endsOn < startsOn) return res.status(400).json({ error: 'Fim da vigência não pode ser anterior ao início' });
      if (estimatedMinutes != null && (!Number.isInteger(estimatedMinutes) || estimatedMinutes < 1 || estimatedMinutes > 600)) {
        return res.status(400).json({ error: 'Duração estimada inválida' });
      }
      await client.query('BEGIN');
      const student = await client.query(`SELECT s.id,s.unit_id FROM students s
        WHERE s.id=$1 AND s.tenant_id=$2 AND s.status IN ('ACTIVE','PAUSED')
          AND ($3::text <> 'COACH' OR EXISTS(
            SELECT 1 FROM user_units uu WHERE uu.tenant_id=s.tenant_id AND uu.user_id=$4 AND uu.unit_id=s.unit_id
          ))`, [studentId, req.user.tenantId, req.user.role, req.user.id]);
      if (!student.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Aluno não encontrado ou inativo' });
      }
      const plan = await client.query(`INSERT INTO workout_plans(
        tenant_id,student_id,title,created_by_user_id
      ) VALUES($1,$2,$3,$4) RETURNING *`, [req.user.tenantId, studentId, title, req.user.id]);
      const version = await client.query(`INSERT INTO workout_plan_versions(
        tenant_id,workout_plan_id,version_number,created_by_user_id,starts_on,ends_on,goal,notes,estimated_minutes,change_reason
      ) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,'Ficha inicial') RETURNING *`, [
        req.user.tenantId, plan.rows[0].id, req.user.id, startsOn, endsOn,
        clean(req.body?.goal, 1000) || null, clean(req.body?.notes, 2000) || null, estimatedMinutes
      ]);
      await insertItems(client, req.user.tenantId, version.rows[0].id, items);
      if (req.user.role === 'COACH') {
        await client.query(`INSERT INTO coach_students(tenant_id,coach_user_id,student_id,assigned_by_user_id,active)
          VALUES($1,$2,$3,$2,true)
          ON CONFLICT(tenant_id,coach_user_id,student_id) DO UPDATE SET active=true`, [
          req.user.tenantId, req.user.id, studentId
        ]);
      }
      await audit(client, req.user, 'WORKOUT_CREATED', 'workout_plan', plan.rows[0].id, {
        studentId, version: 1, exerciseCount: items.length, startsOn, endsOn
      });
      await client.query('COMMIT');
      res.status(201).json({ plan: plan.rows[0], version: version.rows[0] });
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.status) return res.status(error.status).json({ error: error.message });
      next(error);
    } finally { client.release(); }
  });

  router.post('/workouts/:id/versions', auth('OWNER','ADMIN','MANAGER','COACH'), async (req, res, next) => {
    const client = await pool.connect();
    try {
      const items = Array.isArray(req.body?.items) ? req.body.items.slice(0, 100) : [];
      const startsOn = req.body?.startsOn || localToday(req.user.timezone);
      const endsOn = req.body?.endsOn || null;
      const estimatedMinutes = req.body?.estimatedMinutes == null || req.body?.estimatedMinutes === '' ? null : Number(req.body.estimatedMinutes);
      if (!validDate(startsOn) || (endsOn && !validDate(endsOn)) || !items.length) {
        return res.status(400).json({ error: 'Vigência e ao menos um exercício são obrigatórios' });
      }
      if (endsOn && endsOn < startsOn) return res.status(400).json({ error: 'Fim da vigência não pode ser anterior ao início' });
      await client.query('BEGIN');
      const plan = await client.query('SELECT * FROM workout_plans WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [req.params.id, req.user.tenantId]);
      if (!plan.rowCount) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Ficha de treino não encontrada' });
      }
      if (req.user.role === 'COACH') {
        const allowed = await client.query(`SELECT 1 WHERE EXISTS(
          SELECT 1 FROM coach_students WHERE tenant_id=$1 AND student_id=$2 AND coach_user_id=$3 AND active
        ) OR EXISTS(
          SELECT 1 FROM workout_plan_versions WHERE tenant_id=$1 AND workout_plan_id=$4 AND created_by_user_id=$3
        ) OR EXISTS(
          SELECT 1 FROM students s JOIN user_units uu ON uu.tenant_id=s.tenant_id AND uu.unit_id=s.unit_id
          WHERE s.tenant_id=$1 AND s.id=$2 AND uu.user_id=$3
        )`, [req.user.tenantId, plan.rows[0].student_id, req.user.id, req.params.id]);
        if (!allowed.rowCount) {
          await client.query('ROLLBACK');
          return res.status(403).json({ error: 'Sem permissão para alterar esta ficha' });
        }
      }
      const versionNumber = plan.rows[0].current_version + 1;
      const version = await client.query(`INSERT INTO workout_plan_versions(
        tenant_id,workout_plan_id,version_number,created_by_user_id,starts_on,ends_on,goal,notes,estimated_minutes,change_reason
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`, [
        req.user.tenantId, req.params.id, versionNumber, req.user.id, startsOn, endsOn,
        clean(req.body?.goal, 1000) || null, clean(req.body?.notes, 2000) || null, estimatedMinutes,
        clean(req.body?.changeReason, 500) || 'Atualização do treino'
      ]);
      await insertItems(client, req.user.tenantId, version.rows[0].id, items);
      await client.query('UPDATE workout_plans SET current_version=$1,updated_at=now(),status=\'ACTIVE\' WHERE id=$2 AND tenant_id=$3', [
        versionNumber, req.params.id, req.user.tenantId
      ]);
      if (req.user.role === 'COACH') {
        await client.query(`INSERT INTO coach_students(tenant_id,coach_user_id,student_id,assigned_by_user_id,active)
          VALUES($1,$2,$3,$2,true)
          ON CONFLICT(tenant_id,coach_user_id,student_id) DO UPDATE SET active=true`, [
          req.user.tenantId, req.user.id, plan.rows[0].student_id
        ]);
      }
      await audit(client, req.user, 'WORKOUT_VERSION_CREATED', 'workout_plan', req.params.id, {
        version: versionNumber, exerciseCount: items.length, changeReason: req.body?.changeReason || null
      });
      await client.query('COMMIT');
      res.status(201).json(version.rows[0]);
    } catch (error) {
      await client.query('ROLLBACK');
      if (error.status) return res.status(error.status).json({ error: error.message });
      next(error);
    } finally { client.release(); }
  });

  return router;
}
