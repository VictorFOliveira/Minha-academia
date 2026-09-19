import { Router } from 'express';
import bcrypt from 'bcryptjs';

const clean = (value, max = 1000) => String(value ?? '').trim().slice(0, max);
const dateRe = /^\d{4}-\d{2}-\d{2}$/;

function dbDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0,10);
  const text = String(value || '');
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0,10);
  throw new Error('Data de banco inválida');
}

function addMonths(dateText, months) {
  const [y,m,d] = String(dateText).split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, 1));
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(d || 1, last);
  return [year, String(month + 1).padStart(2,'0'), String(day).padStart(2,'0')].join('-');
}

function addDays(dateText, days) {
  const [y,m,d] = String(dateText).split('-').map(Number);
  const date = new Date(Date.UTC(y,m-1,d));
  date.setUTCDate(date.getUTCDate()+days);
  return date.toISOString().slice(0,10);
}

function nextCycle(dateText, interval, durationDays) {
  if (interval === 'QUARTERLY') return addMonths(dateText,3);
  if (interval === 'SEMIANNUAL') return addMonths(dateText,6);
  if (interval === 'ANNUAL') return addMonths(dateText,12);
  if (interval === 'CUSTOM' && Number(durationDays)>0) return addDays(dateText,Number(durationDays));
  return addMonths(dateText,1);
}

function localToday(timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date());
  const get = type => parts.find(p => p.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

function bmi(weightKg, heightCm) {
  const w = Number(weightKg), h = Number(heightCm) / 100;
  if (!w || !h) return null;
  return Math.round((w / (h*h)) * 100) / 100;
}

export async function generateRecurringBilling({ pool, tenantId, timeZone='UTC', actorUserId=null, asOf=null }) {
  const client=await pool.connect();
  const runDate=dateRe.test(String(asOf||''))?asOf:localToday(timeZone);
  try {
    await client.query('BEGIN');
    const due=await client.query(`SELECT e.*,p.name plan_name,p.price_cents,p.billing_interval,p.duration_days,s.email,s.phone
      FROM enrollments e
      JOIN plans p ON p.tenant_id=e.tenant_id AND p.id=e.plan_id
      JOIN students s ON s.tenant_id=e.tenant_id AND s.id=e.student_id
      WHERE e.tenant_id=$1 AND e.status='ACTIVE' AND e.next_billing_on IS NOT NULL AND e.next_billing_on <= $2
      ORDER BY e.next_billing_on FOR UPDATE`,[tenantId,runDate]);
    let created=0,skipped=0;
    for(const e of due.rows){
      let cursor=dbDate(e.next_billing_on);
      let guard=0;
      while(cursor<=runDate && guard<24){
        guard+=1;
        const cycleKey=cursor;
        const amount=Math.max(0,Number(e.price_cents)-Number(e.discount_cents||0));
        const charge=await client.query(`INSERT INTO charges(
          tenant_id,student_id,enrollment_id,description,due_date,amount_cents,cycle_key
        ) VALUES($1,$2,$3,$4,$5,$6,$7)
        ON CONFLICT(tenant_id,enrollment_id,cycle_key) WHERE enrollment_id IS NOT NULL AND cycle_key IS NOT NULL
        DO NOTHING RETURNING id`,[
          tenantId,e.student_id,e.id,`Mensalidade - ${e.plan_name}`,cursor,amount,cycleKey
        ]);
        if(charge.rowCount){
          created+=1;
          const destination=e.email||e.phone||null;
          const channel=e.email?'EMAIL':e.phone?'WHATSAPP':'IN_APP';
          await client.query(`INSERT INTO communication_queue(
            tenant_id,student_id,channel,template_key,destination,payload,idempotency_key
          ) VALUES($1,$2,$3,'CHARGE_CREATED',$4,$5,$6)
          ON CONFLICT(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING`,[
            tenantId,e.student_id,channel,destination,
            {chargeId:charge.rows[0].id,dueDate:cursor,amountCents:amount,planName:e.plan_name},
            `charge:${charge.rows[0].id}`
          ]);
        } else skipped+=1;
        cursor=nextCycle(cursor,e.billing_interval,e.duration_days);
      }
      await client.query('UPDATE enrollments SET next_billing_on=$1 WHERE tenant_id=$2 AND id=$3',[cursor,tenantId,e.id]);
    }
    await client.query(`INSERT INTO audit_logs(tenant_id,user_id,action,entity_type,entity_id,metadata)
      VALUES($1,$2,'RECURRING_BILLING_GENERATED','billing',NULL,$3)`,[
      tenantId,actorUserId,{asOf:runDate,created,skipped,enrollments:due.rowCount,automatic:actorUserId==null}
    ]);
    await client.query('COMMIT');
    return {asOf:runDate,enrollments:due.rowCount,created,skipped};
  } catch(error){
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

export function buildMemberRouter({ auth, audit, pool, query }) {
  const router = Router();

  async function studentForUser(user) {
    if (user.role !== 'STUDENT') return null;
    const r = await query(`SELECT s.* FROM student_accounts sa
      JOIN students s ON s.tenant_id=sa.tenant_id AND s.id=sa.student_id
      WHERE sa.tenant_id=$1 AND sa.user_id=$2 LIMIT 1`, [user.tenantId,user.id]);
    return r.rows[0] || null;
  }

  async function canAccessStudent(user, studentId) {
    if (['OWNER','ADMIN','MANAGER','RECEPTION','FINANCE'].includes(user.role)) {
      const r = await query('SELECT 1 FROM students WHERE tenant_id=$1 AND id=$2', [user.tenantId,studentId]);
      return Boolean(r.rowCount);
    }
    if (user.role === 'COACH') {
      const r = await query(`SELECT 1 FROM students s
        JOIN user_units uu ON uu.tenant_id=s.tenant_id AND uu.unit_id=s.unit_id
        WHERE s.tenant_id=$1 AND s.id=$2 AND uu.user_id=$3`, [user.tenantId,studentId,user.id]);
      return Boolean(r.rowCount);
    }
    if (user.role === 'STUDENT') {
      const s = await studentForUser(user);
      return s?.id === studentId;
    }
    return false;
  }

  router.get('/assessments/:studentId', auth('OWNER','ADMIN','MANAGER','COACH','STUDENT'), async (req,res,next) => {
    try {
      if (!await canAccessStudent(req.user, req.params.studentId)) return res.status(403).json({error:'Sem permissão'});
      const r = await query(`SELECT a.*,u.name created_by_name,
        CASE WHEN a.weight_kg IS NOT NULL AND a.height_cm IS NOT NULL
          THEN round((a.weight_kg / power(a.height_cm/100.0,2))::numeric,2)
          ELSE NULL END bmi
        FROM physical_assessments a
        JOIN users u ON u.tenant_id=a.tenant_id AND u.id=a.created_by_user_id
        WHERE a.tenant_id=$1 AND a.student_id=$2 ORDER BY a.assessed_at DESC`,
        [req.user.tenantId,req.params.studentId]);
      res.json(r.rows);
    } catch(error){ next(error); }
  });

  router.post('/assessments/:studentId', auth('OWNER','ADMIN','MANAGER','COACH'), async (req,res,next) => {
    const client=await pool.connect();
    try {
      if (!await canAccessStudent(req.user, req.params.studentId)) return res.status(403).json({error:'Sem permissão'});
      const weight=req.body?.weightKg===''?null:Number(req.body?.weightKg ?? null);
      const height=req.body?.heightCm===''?null:Number(req.body?.heightCm ?? null);
      const fat=req.body?.bodyFatPercent===''?null:Number(req.body?.bodyFatPercent ?? null);
      const muscle=req.body?.muscleMassKg===''?null:Number(req.body?.muscleMassKg ?? null);
      const hr=req.body?.restingHeartRate===''?null:Number(req.body?.restingHeartRate ?? null);
      await client.query('BEGIN');
      const r=await client.query(`INSERT INTO physical_assessments(
        tenant_id,student_id,created_by_user_id,weight_kg,height_cm,body_fat_percent,muscle_mass_kg,
        resting_heart_rate,blood_pressure,objective,notes,measurements
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,[
        req.user.tenantId,req.params.studentId,req.user.id,
        Number.isFinite(weight)?weight:null,Number.isFinite(height)?height:null,Number.isFinite(fat)?fat:null,
        Number.isFinite(muscle)?muscle:null,Number.isFinite(hr)?hr:null,
        clean(req.body?.bloodPressure,40)||null,clean(req.body?.objective,1000)||null,clean(req.body?.notes,2000)||null,
        req.body?.measurements && typeof req.body.measurements==='object' ? req.body.measurements : {}
      ]);
      await audit(client,req.user,'PHYSICAL_ASSESSMENT_CREATED','physical_assessment',r.rows[0].id,{studentId:req.params.studentId,bmi:bmi(weight,height)});
      await client.query('COMMIT');
      res.status(201).json({...r.rows[0],bmi:bmi(weight,height)});
    } catch(error){ await client.query('ROLLBACK'); next(error); }
    finally{ client.release(); }
  });

  router.get('/anamnesis/:studentId', auth('OWNER','ADMIN','MANAGER','COACH','STUDENT'), async (req,res,next) => {
    try {
      if (!await canAccessStudent(req.user, req.params.studentId)) return res.status(403).json({error:'Sem permissão'});
      const r=await query(`SELECT a.*,u.name created_by_name FROM anamnesis_records a
        JOIN users u ON u.tenant_id=a.tenant_id AND u.id=a.created_by_user_id
        WHERE a.tenant_id=$1 AND a.student_id=$2 ORDER BY a.created_at DESC`,
        [req.user.tenantId,req.params.studentId]);
      res.json(r.rows);
    } catch(error){ next(error); }
  });

  router.post('/anamnesis/:studentId', auth('OWNER','ADMIN','MANAGER','COACH'), async (req,res,next) => {
    const client=await pool.connect();
    try {
      if (!await canAccessStudent(req.user, req.params.studentId)) return res.status(403).json({error:'Sem permissão'});
      await client.query('BEGIN');
      const r=await client.query(`INSERT INTO anamnesis_records(
        tenant_id,student_id,created_by_user_id,has_medical_clearance,medications,injuries,surgeries,
        chronic_conditions,pain_or_limitations,exercise_history,smoking,alcohol_notes,emergency_notes,answers,notes
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,[
        req.user.tenantId,req.params.studentId,req.user.id,
        req.body?.hasMedicalClearance == null ? null : Boolean(req.body.hasMedicalClearance),
        clean(req.body?.medications,2000)||null,clean(req.body?.injuries,2000)||null,clean(req.body?.surgeries,2000)||null,
        clean(req.body?.chronicConditions,2000)||null,clean(req.body?.painOrLimitations,2000)||null,
        clean(req.body?.exerciseHistory,2000)||null,req.body?.smoking == null ? null : Boolean(req.body.smoking),
        clean(req.body?.alcoholNotes,1000)||null,clean(req.body?.emergencyNotes,2000)||null,
        req.body?.answers && typeof req.body.answers==='object' ? req.body.answers : {},
        clean(req.body?.notes,2000)||null
      ]);
      await audit(client,req.user,'ANAMNESIS_CREATED','anamnesis',r.rows[0].id,{studentId:req.params.studentId});
      await client.query('COMMIT');
      res.status(201).json(r.rows[0]);
    } catch(error){ await client.query('ROLLBACK'); next(error); }
    finally{ client.release(); }
  });

  router.get('/workout-sessions/:studentId', auth('OWNER','ADMIN','MANAGER','COACH','STUDENT'), async (req,res,next) => {
    try {
      if (!await canAccessStudent(req.user,req.params.studentId)) return res.status(403).json({error:'Sem permissão'});
      const sessions=await query(`SELECT ws.*,wp.title workout_title,u.name created_by_name
        FROM workout_sessions ws
        LEFT JOIN workout_plans wp ON wp.tenant_id=ws.tenant_id AND wp.id=ws.workout_plan_id
        LEFT JOIN users u ON u.tenant_id=ws.tenant_id AND u.id=ws.created_by_user_id
        WHERE ws.tenant_id=$1 AND ws.student_id=$2 ORDER BY ws.started_at DESC LIMIT 200`,
        [req.user.tenantId,req.params.studentId]);
      const ids=sessions.rows.map(x=>x.id);
      const items=ids.length?await query(`SELECT wsi.*,e.name exercise_name
        FROM workout_session_items wsi JOIN exercises e ON e.tenant_id=wsi.tenant_id AND e.id=wsi.exercise_id
        WHERE wsi.tenant_id=$1 AND wsi.workout_session_id=ANY($2::uuid[])
        ORDER BY wsi.created_at`,[req.user.tenantId,ids]):{rows:[]};
      res.json(sessions.rows.map(s=>({...s,items:items.rows.filter(i=>i.workout_session_id===s.id)})));
    } catch(error){ next(error); }
  });

  router.post('/workout-sessions', auth('OWNER','ADMIN','MANAGER','COACH','STUDENT'), async (req,res,next) => {
    const client=await pool.connect();
    try {
      const studentId=req.body?.studentId || (await studentForUser(req.user))?.id;
      if (!studentId || !await canAccessStudent(req.user,studentId)) return res.status(403).json({error:'Sem permissão'});
      const planId=req.body?.workoutPlanId || null;
      const versionId=req.body?.workoutVersionId || null;
      const items=Array.isArray(req.body?.items)?req.body.items.slice(0,150):[];
      const status=['IN_PROGRESS','COMPLETED','ABANDONED'].includes(req.body?.status)?req.body.status:'COMPLETED';
      await client.query('BEGIN');
      if (planId) {
        const plan=await client.query('SELECT id FROM workout_plans WHERE tenant_id=$1 AND id=$2 AND student_id=$3',[req.user.tenantId,planId,studentId]);
        if(!plan.rowCount){ await client.query('ROLLBACK'); return res.status(404).json({error:'Treino não encontrado'}); }
      }
      const completedAt=status==='COMPLETED'?(req.body?.completedAt||new Date().toISOString()):null;
      const session=await client.query(`INSERT INTO workout_sessions(
        tenant_id,student_id,workout_plan_id,workout_version_id,started_at,completed_at,duration_minutes,perceived_effort,notes,status,created_by_user_id
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,[
        req.user.tenantId,studentId,planId,versionId,req.body?.startedAt||new Date().toISOString(),completedAt,
        req.body?.durationMinutes==null?null:Number(req.body.durationMinutes),
        req.body?.perceivedEffort==null?null:Number(req.body.perceivedEffort),
        clean(req.body?.notes,2000)||null,status,req.user.id
      ]);
      for(const item of items){
        if(!item.exerciseId) continue;
        const ex=await client.query('SELECT 1 FROM exercises WHERE tenant_id=$1 AND id=$2',[req.user.tenantId,item.exerciseId]);
        if(!ex.rowCount) continue;
        await client.query(`INSERT INTO workout_session_items(
          tenant_id,workout_session_id,exercise_id,workout_item_id,performed_sets,performed_reps,load,perceived_effort,notes,completed
        ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,[
          req.user.tenantId,session.rows[0].id,item.exerciseId,item.workoutItemId||null,
          item.performedSets==null?null:Number(item.performedSets),clean(item.performedReps,80)||null,
          clean(item.load,80)||null,item.perceivedEffort==null?null:Number(item.perceivedEffort),
          clean(item.notes,1000)||null,item.completed!==false
        ]);
      }
      await audit(client,req.user,'WORKOUT_SESSION_RECORDED','workout_session',session.rows[0].id,{studentId,itemCount:items.length,status});
      await client.query('COMMIT');
      res.status(201).json(session.rows[0]);
    } catch(error){ await client.query('ROLLBACK'); next(error); }
    finally{ client.release(); }
  });

  router.post('/student-accounts/:studentId', auth('OWNER','ADMIN','MANAGER','RECEPTION'), async (req,res,next) => {
    const client=await pool.connect();
    try {
      const password=String(req.body?.password||'');
      if(password.length<8) return res.status(400).json({error:'Senha deve ter pelo menos 8 caracteres'});
      await client.query('BEGIN');
      const student=await client.query('SELECT * FROM students WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[req.user.tenantId,req.params.studentId]);
      if(!student.rowCount){ await client.query('ROLLBACK'); return res.status(404).json({error:'Aluno não encontrado'}); }
      const email=clean(req.body?.email||student.rows[0].email,320).toLowerCase();
      if(!email.includes('@')){ await client.query('ROLLBACK'); return res.status(400).json({error:'E-mail válido é obrigatório'}); }
      const existing=await client.query('SELECT user_id FROM student_accounts WHERE tenant_id=$1 AND student_id=$2',[req.user.tenantId,req.params.studentId]);
      if(existing.rowCount){ await client.query('ROLLBACK'); return res.status(409).json({error:'Aluno já possui acesso'}); }
      const hash=await bcrypt.hash(password,12);
      const user=await client.query(`INSERT INTO users(tenant_id,unit_id,name,email,password_hash,role)
        VALUES($1,$2,$3,$4,$5,'STUDENT') RETURNING id,name,email,role`,[
        req.user.tenantId,student.rows[0].unit_id,student.rows[0].name,email,hash
      ]);
      await client.query('INSERT INTO student_accounts(tenant_id,student_id,user_id) VALUES($1,$2,$3)',[req.user.tenantId,req.params.studentId,user.rows[0].id]);
      await audit(client,req.user,'STUDENT_ACCOUNT_CREATED','user',user.rows[0].id,{studentId:req.params.studentId});
      await client.query('COMMIT');
      res.status(201).json(user.rows[0]);
    } catch(error){
      await client.query('ROLLBACK');
      if(error.code==='23505') return res.status(409).json({error:'E-mail já está em uso'});
      next(error);
    } finally{ client.release(); }
  });

  router.get('/student/me/overview', auth('STUDENT'), async (req,res,next) => {
    try {
      const student=await studentForUser(req.user);
      if(!student) return res.status(404).json({error:'Conta sem aluno vinculado'});
      const [enrollment,workout,charges,attendance,assessment,sessions]=await Promise.all([
        query(`SELECT e.*,p.name plan_name,p.access_scope,p.price_cents FROM enrollments e
          JOIN plans p ON p.tenant_id=e.tenant_id AND p.id=e.plan_id
          WHERE e.tenant_id=$1 AND e.student_id=$2 ORDER BY e.created_at DESC LIMIT 1`,[req.user.tenantId,student.id]),
        query(`SELECT wp.*,v.id version_id,v.starts_on,v.ends_on,v.goal,v.notes,v.estimated_minutes,u.name professor_name
          FROM workout_plans wp JOIN workout_plan_versions v ON v.tenant_id=wp.tenant_id AND v.workout_plan_id=wp.id AND v.version_number=wp.current_version
          JOIN users u ON u.tenant_id=v.tenant_id AND u.id=v.created_by_user_id
          WHERE wp.tenant_id=$1 AND wp.student_id=$2 AND wp.status='ACTIVE' ORDER BY wp.updated_at DESC LIMIT 1`,[req.user.tenantId,student.id]),
        query(`SELECT id,description,due_date,amount_cents,paid_cents,status FROM charges
          WHERE tenant_id=$1 AND student_id=$2 ORDER BY due_date DESC LIMIT 20`,[req.user.tenantId,student.id]),
        query(`SELECT a.checkin_at,a.checkout_at,a.source,u.name unit_name FROM attendance a
          LEFT JOIN units u ON u.tenant_id=a.tenant_id AND u.id=a.unit_id
          WHERE a.tenant_id=$1 AND a.student_id=$2 ORDER BY a.checkin_at DESC LIMIT 20`,[req.user.tenantId,student.id]),
        query(`SELECT *,CASE WHEN weight_kg IS NOT NULL AND height_cm IS NOT NULL
          THEN round((weight_kg / power(height_cm/100.0,2))::numeric,2) ELSE NULL END bmi
          FROM physical_assessments WHERE tenant_id=$1 AND student_id=$2 ORDER BY assessed_at DESC LIMIT 1`,[req.user.tenantId,student.id]),
        query(`SELECT id,started_at,completed_at,duration_minutes,perceived_effort,status FROM workout_sessions
          WHERE tenant_id=$1 AND student_id=$2 ORDER BY started_at DESC LIMIT 10`,[req.user.tenantId,student.id])
      ]);
      let workoutItems=[];
      if(workout.rowCount){
        const wi=await query(`SELECT wi.*,e.name exercise_name,e.instructions,ge.name equipment_name
          FROM workout_plan_items wi JOIN exercises e ON e.tenant_id=wi.tenant_id AND e.id=wi.exercise_id
          LEFT JOIN gym_equipment ge ON ge.tenant_id=e.tenant_id AND ge.id=e.equipment_id
          WHERE wi.tenant_id=$1 AND wi.workout_version_id=$2 ORDER BY wi.workout_label,wi.position`,
          [req.user.tenantId,workout.rows[0].version_id]);
        workoutItems=wi.rows;
      }
      res.json({
        student,
        enrollment:enrollment.rows[0]||null,
        workout:workout.rowCount?{...workout.rows[0],items:workoutItems}:null,
        charges:charges.rows,
        attendance:attendance.rows,
        latestAssessment:assessment.rows[0]||null,
        recentSessions:sessions.rows
      });
    } catch(error){ next(error); }
  });

  router.post('/enrollments/:id/action', auth('OWNER','ADMIN','MANAGER','RECEPTION'), async (req,res,next) => {
    const client=await pool.connect();
    try {
      const action=String(req.body?.action||'').toUpperCase();
      if(!['PAUSE','RESUME','CANCEL','RENEW','CHANGE_PLAN'].includes(action)) return res.status(400).json({error:'Ação inválida'});
      await client.query('BEGIN');
      const e=await client.query('SELECT * FROM enrollments WHERE tenant_id=$1 AND id=$2 FOR UPDATE',[req.user.tenantId,req.params.id]);
      if(!e.rowCount){ await client.query('ROLLBACK'); return res.status(404).json({error:'Matrícula não encontrada'}); }
      const current=e.rows[0];
      let status=current.status,endsOn=current.ends_on,planId=current.plan_id,eventType,reason=clean(req.body?.reason,1000)||null;
      if(action==='PAUSE'){ if(status!=='ACTIVE') throw Object.assign(new Error('Somente matrícula ativa pode ser pausada'),{statusCode:409}); status='PAUSED'; eventType='PAUSED'; }
      if(action==='RESUME'){ if(status!=='PAUSED') throw Object.assign(new Error('Somente matrícula pausada pode ser retomada'),{statusCode:409}); status='ACTIVE'; eventType='RESUMED'; }
      if(action==='CANCEL'){ if(['CANCELED','EXPIRED'].includes(status)) throw Object.assign(new Error('Matrícula já encerrada'),{statusCode:409}); status='CANCELED'; eventType='CANCELED'; }
      if(action==='RENEW'){ status='ACTIVE'; eventType='RENEWED'; endsOn=req.body?.endsOn||null; }
      if(action==='CHANGE_PLAN'){
        const p=await client.query('SELECT id FROM plans WHERE tenant_id=$1 AND id=$2 AND active',[req.user.tenantId,req.body?.planId]);
        if(!p.rowCount) throw Object.assign(new Error('Plano não encontrado'),{statusCode:404});
        planId=req.body.planId; eventType='PLAN_CHANGED';
      }
      await client.query(`UPDATE enrollments SET status=$1,ends_on=$2,plan_id=$3,
        paused_at=CASE WHEN $4='PAUSED' THEN now() ELSE paused_at END,
        canceled_at=CASE WHEN $4='CANCELED' THEN now() ELSE canceled_at END,
        cancellation_reason=CASE WHEN $4='CANCELED' THEN $5 ELSE cancellation_reason END
        WHERE tenant_id=$6 AND id=$7`,[status,endsOn,planId,eventType,reason,req.user.tenantId,current.id]);
      await client.query(`INSERT INTO enrollment_events(
        tenant_id,enrollment_id,actor_user_id,event_type,from_status,to_status,reason,metadata
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[
        req.user.tenantId,current.id,req.user.id,eventType,current.status,status,reason,
        {oldPlanId:current.plan_id,newPlanId:planId,endsOn}
      ]);
      if(status==='ACTIVE') await client.query("UPDATE students SET status='ACTIVE',updated_at=now() WHERE tenant_id=$1 AND id=$2",[req.user.tenantId,current.student_id]);
      if(status==='CANCELED') await client.query("UPDATE students SET status='INACTIVE',updated_at=now() WHERE tenant_id=$1 AND id=$2",[req.user.tenantId,current.student_id]);
      await audit(client,req.user,'ENROLLMENT_'+eventType,'enrollment',current.id,{from:current.status,to:status});
      await client.query('COMMIT');
      res.json({id:current.id,status,planId,endsOn});
    } catch(error){
      await client.query('ROLLBACK');
      if(error.statusCode) return res.status(error.statusCode).json({error:error.message});
      if(error.code==='23505' && error.constraint==='uq_enrollments_one_open_per_student') {
        return res.status(409).json({error:'Aluno já possui matrícula ativa ou pausada'});
      }
      next(error);
    } finally{ client.release(); }
  });

  router.get('/enrollments/:id/history', auth('OWNER','ADMIN','MANAGER','RECEPTION','FINANCE'), async (req,res,next) => {
    try {
      const r=await query(`SELECT ev.*,u.name actor_name FROM enrollment_events ev
        LEFT JOIN users u ON u.tenant_id=ev.tenant_id AND u.id=ev.actor_user_id
        WHERE ev.tenant_id=$1 AND ev.enrollment_id=$2 ORDER BY ev.created_at DESC`,[req.user.tenantId,req.params.id]);
      res.json(r.rows);
    } catch(error){ next(error); }
  });

  router.post('/billing/generate-recurring', auth('OWNER','ADMIN','MANAGER','FINANCE'), async (req,res,next) => {
    try {
      const result=await generateRecurringBilling({
        pool,
        tenantId:req.user.tenantId,
        timeZone:req.user.timezone,
        actorUserId:req.user.id,
        asOf:req.body?.asOf
      });
      res.json(result);
    } catch(error){ next(error); }
  });

  router.get('/communications', auth('OWNER','ADMIN','MANAGER','FINANCE'), async (req,res,next) => {
    try {
      const r=await query(`SELECT cq.*,s.name student_name FROM communication_queue cq
        LEFT JOIN students s ON s.tenant_id=cq.tenant_id AND s.id=cq.student_id
        WHERE cq.tenant_id=$1 ORDER BY cq.created_at DESC LIMIT 500`,[req.user.tenantId]);
      res.json(r.rows);
    } catch(error){ next(error); }
  });

  return router;
}
