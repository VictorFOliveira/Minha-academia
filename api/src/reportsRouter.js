import { Router } from 'express';

const clean=(v,max=120)=>String(v??'').trim().slice(0,max);
const dateRe=/^\d{4}-\d{2}-\d{2}$/;
const csvCell=value=>'"'+String(value??'').replace(/"/g,'""')+'"';
const toCsv=(headers,rows)=>[headers.map(csvCell).join(','),...rows.map(row=>row.map(csvCell).join(','))].join('\n');

async function canUseUnit(query,user,unitId){
  if(!unitId) return true;
  if(['OWNER','ADMIN'].includes(user.role)){
    const r=await query('SELECT 1 FROM units WHERE tenant_id=$1 AND id=$2',[user.tenantId,unitId]);
    return Boolean(r.rowCount);
  }
  const r=await query('SELECT 1 FROM user_units WHERE tenant_id=$1 AND user_id=$2 AND unit_id=$3',[user.tenantId,user.id,unitId]);
  return Boolean(r.rowCount);
}

function period(req){
  const from=dateRe.test(String(req.query?.from||''))?req.query.from:null;
  const to=dateRe.test(String(req.query?.to||''))?req.query.to:null;
  return {from,to};
}

export function buildReportsRouter({auth,query}){
  const router=Router();

  router.get('/summary',auth('OWNER','ADMIN','MANAGER','FINANCE'),async(req,res,next)=>{
    try{
      const unitId=clean(req.query?.unitId,80)||null;
      if(unitId&&!await canUseUnit(query,req.user,unitId)) return res.status(403).json({error:'Sem acesso a esta unidade'});
      const {from,to}=period(req);
      const p=await query(`SELECT
        coalesce(sum(p.amount_cents),0)::bigint revenue_cents,
        count(*)::int payments_count,
        count(DISTINCT ch.student_id)::int paying_students
        FROM payments p
        JOIN charges ch ON ch.tenant_id=p.tenant_id AND ch.id=p.charge_id
        JOIN students s ON s.tenant_id=ch.tenant_id AND s.id=ch.student_id
        WHERE p.tenant_id=$1 AND ($2::uuid IS NULL OR s.unit_id=$2)
          AND ($3::date IS NULL OR p.paid_at::date >= $3)
          AND ($4::date IS NULL OR p.paid_at::date <= $4)`,[req.user.tenantId,unitId,from,to]);
      const a=await query(`SELECT count(*)::int checkins, count(DISTINCT student_id)::int unique_students
        FROM attendance WHERE tenant_id=$1 AND ($2::uuid IS NULL OR unit_id=$2)
          AND ($3::date IS NULL OR checkin_at::date >= $3)
          AND ($4::date IS NULL OR checkin_at::date <= $4)`,[req.user.tenantId,unitId,from,to]);
      const c=await query(`SELECT
        coalesce(sum(ch.amount_cents-ch.paid_cents) FILTER(WHERE ch.status IN ('PENDING','PARTIAL','OVERDUE')),0)::bigint receivable_cents,
        count(*) FILTER(WHERE ch.status='OVERDUE')::int overdue_count
        FROM charges ch JOIN students s ON s.tenant_id=ch.tenant_id AND s.id=ch.student_id
        WHERE ch.tenant_id=$1 AND ($2::uuid IS NULL OR s.unit_id=$2)
          AND ($3::date IS NULL OR ch.due_date >= $3)
          AND ($4::date IS NULL OR ch.due_date <= $4)`,[req.user.tenantId,unitId,from,to]);
      res.json({
        from,to,unitId,
        revenueCents:Number(p.rows[0].revenue_cents),paymentsCount:p.rows[0].payments_count,payingStudents:p.rows[0].paying_students,
        checkins:a.rows[0].checkins,uniqueStudents:a.rows[0].unique_students,
        receivableCents:Number(c.rows[0].receivable_cents),overdueCount:c.rows[0].overdue_count
      });
    }catch(error){next(error);}
  });

  router.get('/payments',auth('OWNER','ADMIN','MANAGER','FINANCE'),async(req,res,next)=>{
    try{
      const unitId=clean(req.query?.unitId,80)||null;
      if(unitId&&!await canUseUnit(query,req.user,unitId)) return res.status(403).json({error:'Sem acesso a esta unidade'});
      const {from,to}=period(req);
      const r=await query(`SELECT p.id,p.paid_at,p.amount_cents,p.method,p.provider,p.external_id,
        ch.description,ch.due_date,s.name student_name,s.cpf,u.name unit_name
        FROM payments p
        JOIN charges ch ON ch.tenant_id=p.tenant_id AND ch.id=p.charge_id
        JOIN students s ON s.tenant_id=ch.tenant_id AND s.id=ch.student_id
        LEFT JOIN units u ON u.tenant_id=s.tenant_id AND u.id=s.unit_id
        WHERE p.tenant_id=$1 AND ($2::uuid IS NULL OR s.unit_id=$2)
          AND ($3::date IS NULL OR p.paid_at::date >= $3)
          AND ($4::date IS NULL OR p.paid_at::date <= $4)
        ORDER BY p.paid_at DESC LIMIT 500`,[req.user.tenantId,unitId,from,to]);
      res.json(r.rows);
    }catch(error){next(error);}
  });

  router.get('/financial.csv',auth('OWNER','ADMIN','MANAGER','FINANCE'),async(req,res,next)=>{
    try{
      const unitId=clean(req.query?.unitId,80)||null;
      if(unitId&&!await canUseUnit(query,req.user,unitId)) return res.status(403).json({error:'Sem acesso a esta unidade'});
      const {from,to}=period(req);
      const r=await query(`SELECT p.id,p.paid_at,p.amount_cents,p.method,p.provider,p.external_id,
        ch.description,ch.due_date,s.name student_name,s.cpf,u.name unit_name
        FROM payments p
        JOIN charges ch ON ch.tenant_id=p.tenant_id AND ch.id=p.charge_id
        JOIN students s ON s.tenant_id=ch.tenant_id AND s.id=ch.student_id
        LEFT JOIN units u ON u.tenant_id=s.tenant_id AND u.id=s.unit_id
        WHERE p.tenant_id=$1 AND ($2::uuid IS NULL OR s.unit_id=$2)
          AND ($3::date IS NULL OR p.paid_at::date >= $3)
          AND ($4::date IS NULL OR p.paid_at::date <= $4)
        ORDER BY p.paid_at DESC`,[req.user.tenantId,unitId,from,to]);
      const csv=toCsv(['Pagamento','Data','Aluno','CPF','Unidade','Descrição','Vencimento','Valor centavos','Método','Provider','Externo'],r.rows.map(x=>[x.id,x.paid_at,x.student_name,x.cpf,x.unit_name,x.description,x.due_date,x.amount_cents,x.method,x.provider,x.external_id]));
      res.setHeader('content-type','text/csv; charset=utf-8');
      res.setHeader('content-disposition','attachment; filename="financeiro.csv"');
      res.send('\uFEFF'+csv);
    }catch(error){next(error);}
  });

  router.get('/attendance.csv',auth('OWNER','ADMIN','MANAGER','RECEPTION','COACH'),async(req,res,next)=>{
    try{
      const unitId=clean(req.query?.unitId,80)||null;
      if(unitId&&!await canUseUnit(query,req.user,unitId)) return res.status(403).json({error:'Sem acesso a esta unidade'});
      const {from,to}=period(req);
      const params=[req.user.tenantId,unitId,from,to,req.user.role,req.user.id];
      const r=await query(`SELECT a.id,a.checkin_at,a.checkout_at,a.source,s.name student_name,s.cpf,u.name unit_name,c.name class_name
        FROM attendance a JOIN students s ON s.tenant_id=a.tenant_id AND s.id=a.student_id
        LEFT JOIN units u ON u.tenant_id=a.tenant_id AND u.id=a.unit_id
        LEFT JOIN classes c ON c.tenant_id=a.tenant_id AND c.id=a.class_id
        WHERE a.tenant_id=$1 AND ($2::uuid IS NULL OR a.unit_id=$2)
          AND ($3::date IS NULL OR a.checkin_at::date >= $3)
          AND ($4::date IS NULL OR a.checkin_at::date <= $4)
          AND ($5::text <> 'COACH' OR c.coach_user_id=$6 OR EXISTS(
            SELECT 1 FROM coach_students cs WHERE cs.tenant_id=a.tenant_id AND cs.student_id=a.student_id AND cs.coach_user_id=$6 AND cs.active
          )) ORDER BY a.checkin_at DESC`,params);
      const csv=toCsv(['Evento','Entrada','Saída','Aluno','CPF','Unidade','Turma','Origem'],r.rows.map(x=>[x.id,x.checkin_at,x.checkout_at,x.student_name,x.cpf,x.unit_name,x.class_name,x.source]));
      res.setHeader('content-type','text/csv; charset=utf-8');
      res.setHeader('content-disposition','attachment; filename="presencas.csv"');
      res.send('\uFEFF'+csv);
    }catch(error){next(error);}
  });

  router.get('/students.csv',auth('OWNER','ADMIN','MANAGER','RECEPTION','FINANCE'),async(req,res,next)=>{
    try{
      const unitId=clean(req.query?.unitId,80)||null;
      if(unitId&&!await canUseUnit(query,req.user,unitId)) return res.status(403).json({error:'Sem acesso a esta unidade'});
      const r=await query(`SELECT s.id,s.name,s.cpf,s.email,s.phone,s.birth_date,s.status,u.name unit_name,s.created_at
        FROM students s LEFT JOIN units u ON u.tenant_id=s.tenant_id AND u.id=s.unit_id
        WHERE s.tenant_id=$1 AND ($2::uuid IS NULL OR s.unit_id=$2) ORDER BY s.name`,[req.user.tenantId,unitId]);
      const csv=toCsv(['ID','Nome','CPF','Email','Telefone','Nascimento','Status','Unidade','Cadastro'],r.rows.map(x=>[x.id,x.name,x.cpf,x.email,x.phone,x.birth_date,x.status,x.unit_name,x.created_at]));
      res.setHeader('content-type','text/csv; charset=utf-8');
      res.setHeader('content-disposition','attachment; filename="alunos.csv"');
      res.send('\uFEFF'+csv);
    }catch(error){next(error);}
  });

  router.get('/payments/:id/receipt',auth('OWNER','ADMIN','MANAGER','FINANCE','STUDENT'),async(req,res,next)=>{
    try{
      const params=[req.user.tenantId,req.params.id];
      let studentFilter='';
      if(req.user.role==='STUDENT'){
        params.push(req.user.id);
        studentFilter=' AND EXISTS(SELECT 1 FROM student_accounts sa WHERE sa.tenant_id=p.tenant_id AND sa.student_id=ch.student_id AND sa.user_id=$3)';
      }
      const r=await query(`SELECT p.id,p.amount_cents,p.method,p.provider,p.external_id,p.paid_at,
        ch.description,ch.due_date,s.id student_id,s.name student_name,s.cpf,
        t.trade_name,t.legal_name,t.cnpj,t.settings
        FROM payments p
        JOIN charges ch ON ch.tenant_id=p.tenant_id AND ch.id=p.charge_id
        JOIN students s ON s.tenant_id=ch.tenant_id AND s.id=ch.student_id
        JOIN tenants t ON t.id=p.tenant_id
        WHERE p.tenant_id=$1 AND p.id=$2${studentFilter} LIMIT 1`,params);
      if(!r.rowCount) return res.status(404).json({error:'Pagamento não encontrado'});
      const x=r.rows[0];
      res.json({
        receiptNumber:'REC-'+String(x.id).slice(0,8).toUpperCase(),
        issuedAt:new Date().toISOString(),
        academy:{tradeName:x.trade_name,legalName:x.legal_name,cnpj:x.cnpj,branding:x.settings?.branding||{}},
        student:{id:x.student_id,name:x.student_name,cpf:x.cpf},
        payment:{id:x.id,description:x.description,dueDate:x.due_date,paidAt:x.paid_at,amountCents:x.amount_cents,method:x.method,provider:x.provider,externalId:x.external_id}
      });
    }catch(error){next(error);}
  });

  return router;
}
