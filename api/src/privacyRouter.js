import { Router } from 'express';

const REQUEST_TYPES = new Set([
  'ACCESS_EXPORT','CORRECTION','ANONYMIZATION','DELETION',
  'PORTABILITY','SHARING_INFO','OPPOSITION','OTHER'
]);
const REVIEW_STATUSES = new Set(['IN_REVIEW','COMPLETED','REJECTED']);
const CONSENT_KINDS = new Set(['PRIVACY_POLICY','TERMS_OF_USE','COMMUNICATION']);
const clean = (value,max=4000)=>String(value??'').trim().slice(0,max);

async function auditSafe(audit,client,user,action,entityType,entityId,metadata={}){
  try{await audit(client,user,action,entityType,entityId,metadata);}catch{}
}

async function linkedStudent(query,user){
  if(user.role!=='STUDENT') return null;
  const r=await query(`SELECT s.id,s.name,s.cpf,s.email,s.phone,s.birth_date,s.emergency_contact,s.status,s.notes,s.created_at,s.updated_at
    FROM student_accounts sa
    JOIN students s ON s.tenant_id=sa.tenant_id AND s.id=sa.student_id
    WHERE sa.tenant_id=$1 AND sa.user_id=$2 LIMIT 1`,[user.tenantId,user.id]);
  return r.rows[0]||null;
}

async function exportSubject(query,user){
  const account=await query(`SELECT id,name,email,role,active,created_at,password_changed_at
    FROM users WHERE tenant_id=$1 AND id=$2`,[user.tenantId,user.id]);
  const tenant=await query(`SELECT trade_name,legal_name,slug FROM tenants WHERE id=$1`,[user.tenantId]);
  const student=await linkedStudent(query,user);
  const data={
    generatedAt:new Date().toISOString(),
    tenant:tenant.rows[0]||null,
    account:account.rows[0]||null,
    student:null,
    enrollments:[],attendance:[],charges:[],payments:[],
    assessments:[],anamnesis:[],workoutSessions:[]
  };
  if(!student) return data;
  data.student=student;
  const [enrollments,attendance,charges,payments,assessments,anamnesis,workouts]=await Promise.all([
    query(`SELECT e.id,e.starts_on,e.ends_on,e.status,e.discount_cents,e.created_at,p.name plan_name,p.price_cents
      FROM enrollments e JOIN plans p ON p.tenant_id=e.tenant_id AND p.id=e.plan_id
      WHERE e.tenant_id=$1 AND e.student_id=$2 ORDER BY e.created_at`,[user.tenantId,student.id]),
    query(`SELECT source,checkin_at,checkout_at,metadata FROM attendance
      WHERE tenant_id=$1 AND student_id=$2 ORDER BY checkin_at`,[user.tenantId,student.id]),
    query(`SELECT id,description,due_date,amount_cents,paid_cents,status,created_at
      FROM charges WHERE tenant_id=$1 AND student_id=$2 ORDER BY due_date`,[user.tenantId,student.id]),
    query(`SELECT p.amount_cents,p.method,p.provider,p.paid_at,p.metadata,ch.description
      FROM payments p JOIN charges ch ON ch.tenant_id=p.tenant_id AND ch.id=p.charge_id
      WHERE p.tenant_id=$1 AND ch.student_id=$2 ORDER BY p.paid_at`,[user.tenantId,student.id]),
    query(`SELECT assessed_at,weight_kg,height_cm,body_fat_percent,muscle_mass_kg,resting_heart_rate,blood_pressure,objective,notes,measurements
      FROM physical_assessments WHERE tenant_id=$1 AND student_id=$2 ORDER BY assessed_at`,[user.tenantId,student.id]),
    query(`SELECT has_medical_clearance,medications,injuries,surgeries,chronic_conditions,pain_or_limitations,exercise_history,smoking,alcohol_notes,emergency_notes,answers,notes,created_at
      FROM anamnesis_records WHERE tenant_id=$1 AND student_id=$2 ORDER BY created_at`,[user.tenantId,student.id]),
    query(`SELECT started_at,completed_at,duration_minutes,perceived_effort,notes,status,created_at
      FROM workout_sessions WHERE tenant_id=$1 AND student_id=$2 ORDER BY started_at`,[user.tenantId,student.id])
  ]);
  data.enrollments=enrollments.rows;
  data.attendance=attendance.rows;
  data.charges=charges.rows;
  data.payments=payments.rows;
  data.assessments=assessments.rows;
  data.anamnesis=anamnesis.rows;
  data.workoutSessions=workouts.rows;
  return data;
}

export function buildPrivacyRouter({auth,audit,pool,query}){
  const router=Router();
  router.use((_req,res,next)=>{res.setHeader('Cache-Control','no-store, private');res.setHeader('Pragma','no-cache');next();});

  router.get('/privacy',auth(),async(req,res,next)=>{
    try{
      const [settings,ownRequests,consents]=await Promise.all([
        query(`SELECT ps.*,t.trade_name,t.legal_name
          FROM tenants t LEFT JOIN privacy_settings ps ON ps.tenant_id=t.id
          WHERE t.id=$1`,[req.user.tenantId]),
        query(`SELECT id,type,status,description,response,decision_reason,reviewed_at,created_at,updated_at
          FROM privacy_requests WHERE tenant_id=$1 AND user_id=$2
          ORDER BY created_at DESC LIMIT 100`,[req.user.tenantId,req.user.id]),
        query(`SELECT kind,version,accepted,accepted_at FROM privacy_consents
          WHERE tenant_id=$1 AND user_id=$2 ORDER BY accepted_at DESC`,[req.user.tenantId,req.user.id])
      ]);
      const row=settings.rows[0]||{};
      res.json({
        controller:{
          name:row.trade_name||row.legal_name||req.user.tenantName,
          contactEmail:row.contact_email||null,
          dpoName:row.dpo_name||null,
          policyUrl:row.policy_url||null
        },
        retentionNotice:row.retention_notice||'Os prazos de retenção devem ser definidos pelo controlador conforme finalidade, obrigação legal e política interna.',
        requestTypes:[...REQUEST_TYPES],
        requests:ownRequests.rows,
        consents:consents.rows,
        note:'Pedidos de exclusão ou anonimização passam por análise. Registros sujeitos a obrigação legal ou contratual de retenção não são apagados automaticamente.'
      });
    }catch(error){next(error);}
  });

  router.get('/privacy/export',auth(),async(req,res,next)=>{
    try{
      const data=await exportSubject(query,req.user);
      const client=await pool.connect();
      try{await auditSafe(audit,client,req.user,'PRIVACY_EXPORT','user',req.user.id,{studentId:data.student?.id||null});}
      finally{client.release();}
      res.setHeader('Content-Disposition','attachment; filename="minha-academia-meus-dados.json"');
      res.setHeader('Cache-Control','no-store');
      res.json(data);
    }catch(error){next(error);}
  });

  router.post('/privacy/requests',auth(),async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const type=String(req.body?.type||'').toUpperCase();
      const description=clean(req.body?.description,3000);
      if(!REQUEST_TYPES.has(type)) return res.status(400).json({error:'Tipo de solicitação inválido'});
      const student=await linkedStudent(query,req.user);
      const duplicate=await client.query(`SELECT id FROM privacy_requests
        WHERE tenant_id=$1 AND user_id=$2 AND type=$3 AND status IN ('OPEN','IN_REVIEW')
          AND created_at>now()-interval '24 hours' LIMIT 1`,[req.user.tenantId,req.user.id,type]);
      if(duplicate.rowCount) return res.status(409).json({error:'Já existe uma solicitação aberta desse tipo',requestId:duplicate.rows[0].id});
      await client.query('BEGIN');
      const r=await client.query(`INSERT INTO privacy_requests(tenant_id,user_id,student_id,type,description)
        VALUES($1,$2,$3,$4,$5) RETURNING id,type,status,description,created_at`,[
        req.user.tenantId,req.user.id,student?.id||null,type,description||null
      ]);
      await auditSafe(audit,client,req.user,'PRIVACY_REQUEST_CREATED','privacy_request',r.rows[0].id,{type});
      await client.query('COMMIT');
      res.status(201).json(r.rows[0]);
    }catch(error){try{await client.query('ROLLBACK');}catch{} next(error);}
    finally{client.release();}
  });

  router.post('/privacy/consents',auth(),async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const kind=String(req.body?.kind||'').toUpperCase();
      const version=clean(req.body?.version,80);
      const accepted=Boolean(req.body?.accepted);
      if(!CONSENT_KINDS.has(kind)||!version) return res.status(400).json({error:'Consentimento inválido'});
      await client.query('BEGIN');
      const r=await client.query(`INSERT INTO privacy_consents(tenant_id,user_id,kind,version,accepted,metadata)
        VALUES($1,$2,$3,$4,$5,$6)
        ON CONFLICT(tenant_id,user_id,kind,version) DO UPDATE
          SET accepted=EXCLUDED.accepted,accepted_at=now(),metadata=EXCLUDED.metadata
        RETURNING kind,version,accepted,accepted_at`,[
        req.user.tenantId,req.user.id,kind,version,accepted,
        req.body?.metadata&&typeof req.body.metadata==='object'?req.body.metadata:{}
      ]);
      await auditSafe(audit,client,req.user,'PRIVACY_CONSENT_RECORDED','user',req.user.id,{kind,version,accepted});
      await client.query('COMMIT');
      res.json(r.rows[0]);
    }catch(error){try{await client.query('ROLLBACK');}catch{} next(error);}
    finally{client.release();}
  });

  router.get('/privacy/admin/requests',auth('OWNER','ADMIN'),async(req,res,next)=>{
    try{
      const r=await query(`SELECT pr.id,pr.type,pr.status,pr.description,pr.response,pr.decision_reason,
        pr.reviewed_at,pr.created_at,pr.updated_at,u.name requester_name,u.email requester_email,
        s.name student_name,rv.name reviewer_name
        FROM privacy_requests pr
        JOIN users u ON u.tenant_id=pr.tenant_id AND u.id=pr.user_id
        LEFT JOIN students s ON s.tenant_id=pr.tenant_id AND s.id=pr.student_id
        LEFT JOIN users rv ON rv.tenant_id=pr.tenant_id AND rv.id=pr.reviewed_by
        WHERE pr.tenant_id=$1
        ORDER BY CASE pr.status WHEN 'OPEN' THEN 0 WHEN 'IN_REVIEW' THEN 1 ELSE 2 END,pr.created_at DESC
        LIMIT 500`,[req.user.tenantId]);
      res.json(r.rows);
    }catch(error){next(error);}
  });

  router.patch('/privacy/admin/requests/:id',auth('OWNER','ADMIN'),async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const status=String(req.body?.status||'').toUpperCase();
      const response=clean(req.body?.response,5000);
      const decisionReason=clean(req.body?.decisionReason,3000);
      if(!REVIEW_STATUSES.has(status)) return res.status(400).json({error:'Status inválido'});
      if(['COMPLETED','REJECTED'].includes(status)&&!response) return res.status(400).json({error:'Resposta ao titular é obrigatória'});
      await client.query('BEGIN');
      const r=await client.query(`UPDATE privacy_requests SET
          status=$3,response=COALESCE($4,response),decision_reason=COALESCE($5,decision_reason),
          reviewed_by=$6,reviewed_at=CASE WHEN $3 IN ('COMPLETED','REJECTED') THEN now() ELSE reviewed_at END,
          updated_at=now()
        WHERE tenant_id=$1 AND id=$2
        RETURNING id,type,status,response,decision_reason,reviewed_at,updated_at`,[
        req.user.tenantId,req.params.id,status,response||null,decisionReason||null,req.user.id
      ]);
      if(!r.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Solicitação não encontrada'});}
      await auditSafe(audit,client,req.user,'PRIVACY_REQUEST_REVIEWED','privacy_request',req.params.id,{status});
      await client.query('COMMIT');
      res.json(r.rows[0]);
    }catch(error){try{await client.query('ROLLBACK');}catch{} next(error);}
    finally{client.release();}
  });

  router.get('/privacy/settings',auth('OWNER','ADMIN'),async(req,res,next)=>{
    try{
      const r=await query('SELECT * FROM privacy_settings WHERE tenant_id=$1',[req.user.tenantId]);
      res.json(r.rows[0]||{tenant_id:req.user.tenantId});
    }catch(error){next(error);}
  });

  router.put('/privacy/settings',auth('OWNER','ADMIN'),async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const contactEmail=clean(req.body?.contactEmail,320)||null;
      const dpoName=clean(req.body?.dpoName,200)||null;
      const policyUrl=clean(req.body?.policyUrl,1000)||null;
      const retentionNotice=clean(req.body?.retentionNotice,4000)||null;
      if(policyUrl&&!/^https:\/\//i.test(policyUrl)) return res.status(400).json({error:'A URL da política deve usar HTTPS'});
      await client.query('BEGIN');
      const r=await client.query(`INSERT INTO privacy_settings(tenant_id,contact_email,dpo_name,policy_url,retention_notice,updated_at)
        VALUES($1,$2,$3,$4,$5,now())
        ON CONFLICT(tenant_id) DO UPDATE SET
          contact_email=EXCLUDED.contact_email,dpo_name=EXCLUDED.dpo_name,
          policy_url=EXCLUDED.policy_url,retention_notice=EXCLUDED.retention_notice,updated_at=now()
        RETURNING *`,[req.user.tenantId,contactEmail,dpoName,policyUrl,retentionNotice]);
      await auditSafe(audit,client,req.user,'PRIVACY_SETTINGS_UPDATED','tenant',req.user.tenantId);
      await client.query('COMMIT');
      res.json(r.rows[0]);
    }catch(error){try{await client.query('ROLLBACK');}catch{} next(error);}
    finally{client.release();}
  });

  return router;
}
