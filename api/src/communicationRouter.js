import { Router } from 'express';
import nodemailer from 'nodemailer';
import { encryptSecret, decryptSecret } from './secureSecrets.js';

const clean=(value,max=2000)=>String(value??'').trim().slice(0,max);

function renderTemplate(item){
  const p=item.payload||{};
  if(item.template_key==='CHARGE_CREATED'){
    const value=new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(p.amountCents||0)/100);
    return {
      subject:item.subject||'Nova mensalidade disponível',
      text:`Olá! Uma nova cobrança foi gerada para o plano ${p.planName||'da academia'} no valor de ${value}, com vencimento em ${p.dueDate||'data informada no sistema'}.`
    };
  }
  if(item.template_key==='CHARGE_DUE_SOON'){
    return {subject:item.subject||'Mensalidade próxima do vencimento',text:`Lembrete: sua mensalidade vence em ${p.dueDate||'breve'}.`};
  }
  if(item.template_key==='CHARGE_OVERDUE'){
    return {subject:item.subject||'Mensalidade em atraso',text:`Identificamos uma mensalidade vencida em ${p.dueDate||'data anterior'}. Consulte seu financeiro no portal da academia.`};
  }
  if(item.template_key==='WORKOUT_EXPIRING'){
    return {subject:item.subject||'Seu treino está próximo da reavaliação',text:`Seu treino ${p.workoutTitle||''} está previsto para terminar em ${p.endsOn||'breve'}. Procure seu professor para reavaliação.`};
  }
  return {subject:item.subject||'Minha Academia',text:clean(p.text||item.template_key,4000)};
}

async function loadIntegration(query,tenantId,provider){
  const r=await query(`SELECT * FROM tenant_integrations
    WHERE tenant_id=$1 AND provider=$2 AND status='ACTIVE' LIMIT 1`,[tenantId,provider]);
  return r.rows[0]||null;
}

async function sendSmtp(integration,item){
  const cfg=integration.config||{};
  const password=decryptSecret(integration);
  const transporter=nodemailer.createTransport({
    host:cfg.host,
    port:Number(cfg.port||587),
    secure:Boolean(cfg.secure),
    auth:cfg.user?{user:cfg.user,pass:password}:undefined,
    requireTLS:cfg.requireTls===true,
    connectionTimeout:15000,
    greetingTimeout:10000,
    socketTimeout:30000
  });
  const rendered=renderTemplate(item);
  const info=await transporter.sendMail({
    from:cfg.from,
    to:item.destination,
    subject:rendered.subject,
    text:rendered.text
  });
  return {messageId:info.messageId||null,response:info.response||null};
}

async function sendWhatsapp(integration,item){
  const cfg=integration.config||{};
  if(!cfg.phoneNumberId || !cfg.apiVersion) throw new Error('Configuração WhatsApp incompleta');
  const token=decryptSecret(integration);
  const rendered=renderTemplate(item);
  const response=await fetch(`https://graph.facebook.com/${cfg.apiVersion}/${cfg.phoneNumberId}/messages`,{
    method:'POST',
    headers:{'content-type':'application/json',authorization:`Bearer ${token}`},
    body:JSON.stringify({
      messaging_product:'whatsapp',
      recipient_type:'individual',
      to:String(item.destination||'').replace(/\D/g,''),
      type:'text',
      text:{preview_url:false,body:rendered.text}
    }),
    signal:AbortSignal.timeout(20000)
  });
  const body=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(body?.error?.message||`WhatsApp respondeu HTTP ${response.status}`);
  return {messageId:body?.messages?.[0]?.id||null};
}

export async function enqueueCommunicationRules(query,tenantId,timeZone='UTC'){
  const inserted={dueSoon:0,overdue:0,workoutExpiring:0};

  const dueSoon=await query(`INSERT INTO communication_queue(
      tenant_id,student_id,channel,template_key,destination,payload,idempotency_key,scheduled_for
    )
    SELECT ch.tenant_id,ch.student_id,
      CASE WHEN s.email IS NOT NULL THEN 'EMAIL' WHEN s.phone IS NOT NULL THEN 'WHATSAPP' ELSE 'IN_APP' END,
      'CHARGE_DUE_SOON',COALESCE(s.email,s.phone),
      jsonb_build_object('chargeId',ch.id,'dueDate',ch.due_date,'amountCents',ch.amount_cents-ch.paid_cents),
      'due-soon:'||ch.id::text,
      now()
    FROM charges ch JOIN students s ON s.tenant_id=ch.tenant_id AND s.id=ch.student_id
    WHERE ch.tenant_id=$1 AND ch.status IN ('PENDING','PARTIAL')
      AND ch.due_date BETWEEN (now() AT TIME ZONE $2)::date AND ((now() AT TIME ZONE $2)::date + 3)
    ON CONFLICT(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id`,[tenantId,timeZone]);
  inserted.dueSoon=dueSoon.rowCount;

  const overdue=await query(`INSERT INTO communication_queue(
      tenant_id,student_id,channel,template_key,destination,payload,idempotency_key,scheduled_for
    )
    SELECT ch.tenant_id,ch.student_id,
      CASE WHEN s.email IS NOT NULL THEN 'EMAIL' WHEN s.phone IS NOT NULL THEN 'WHATSAPP' ELSE 'IN_APP' END,
      'CHARGE_OVERDUE',COALESCE(s.email,s.phone),
      jsonb_build_object('chargeId',ch.id,'dueDate',ch.due_date,'amountCents',ch.amount_cents-ch.paid_cents),
      'overdue:'||ch.id::text,
      now()
    FROM charges ch JOIN students s ON s.tenant_id=ch.tenant_id AND s.id=ch.student_id
    WHERE ch.tenant_id=$1 AND ch.status IN ('PENDING','PARTIAL','OVERDUE')
      AND ch.due_date < (now() AT TIME ZONE $2)::date
    ON CONFLICT(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id`,[tenantId,timeZone]);
  inserted.overdue=overdue.rowCount;

  const workout=await query(`INSERT INTO communication_queue(
      tenant_id,student_id,channel,template_key,destination,payload,idempotency_key,scheduled_for
    )
    SELECT wp.tenant_id,wp.student_id,
      CASE WHEN s.email IS NOT NULL THEN 'EMAIL' WHEN s.phone IS NOT NULL THEN 'WHATSAPP' ELSE 'IN_APP' END,
      'WORKOUT_EXPIRING',COALESCE(s.email,s.phone),
      jsonb_build_object('workoutPlanId',wp.id,'workoutTitle',wp.title,'endsOn',v.ends_on),
      'workout-expiring:'||wp.id::text||':'||v.version_number::text,
      now()
    FROM workout_plans wp
    JOIN workout_plan_versions v ON v.tenant_id=wp.tenant_id AND v.workout_plan_id=wp.id AND v.version_number=wp.current_version
    JOIN students s ON s.tenant_id=wp.tenant_id AND s.id=wp.student_id
    WHERE wp.tenant_id=$1 AND wp.status='ACTIVE' AND v.ends_on IS NOT NULL
      AND v.ends_on BETWEEN (now() AT TIME ZONE $2)::date AND ((now() AT TIME ZONE $2)::date + 7)
    ON CONFLICT(tenant_id,idempotency_key) WHERE idempotency_key IS NOT NULL DO NOTHING
    RETURNING id`,[tenantId,timeZone]);
  inserted.workoutExpiring=workout.rowCount;
  return inserted;
}

export async function processCommunicationQueue({pool,query,tenantId,limit=50}){
  const client=await pool.connect();
  const result={sent:0,failed:0,skipped:0};
  try{
    const tenant=await query('SELECT timezone FROM tenants WHERE id=$1',[tenantId]);
    if(!tenant.rowCount) return result;
    await enqueueCommunicationRules(query,tenantId,tenant.rows[0].timezone);

    await client.query('BEGIN');
    const rows=await client.query(`SELECT * FROM communication_queue
      WHERE tenant_id=$1 AND status='PENDING' AND scheduled_for<=now() AND attempts<5
      ORDER BY scheduled_for,id
      FOR UPDATE SKIP LOCKED LIMIT $2`,[tenantId,Math.max(1,Math.min(200,Number(limit)||50))]);
    for(const item of rows.rows){
      if(item.channel==='IN_APP'){
        await client.query("UPDATE communication_queue SET status='SENT',sent_at=now(),attempts=attempts+1 WHERE id=$1",[item.id]);
        result.sent+=1;
        continue;
      }
      try{
        let delivery;
        if(item.channel==='EMAIL'){
          const integration=await loadIntegration(query,tenantId,'SMTP');
          if(!integration){result.skipped+=1;continue;}
          delivery=await sendSmtp(integration,item);
        }else if(item.channel==='WHATSAPP'){
          const integration=await loadIntegration(query,tenantId,'WHATSAPP_META');
          if(!integration){result.skipped+=1;continue;}
          delivery=await sendWhatsapp(integration,item);
        }
        await client.query(`UPDATE communication_queue SET status='SENT',sent_at=now(),attempts=attempts+1,
          last_error=NULL,payload=payload || $2::jsonb WHERE id=$1`,[item.id,JSON.stringify({delivery})]);
        result.sent+=1;
      }catch(error){
        await client.query(`UPDATE communication_queue SET attempts=attempts+1,last_error=$2,
          status=CASE WHEN attempts+1>=5 THEN 'FAILED' ELSE 'PENDING' END WHERE id=$1`,[item.id,clean(error.message,2000)]);
        result.failed+=1;
      }
    }
    await client.query('COMMIT');
    return result;
  }catch(error){
    await client.query('ROLLBACK');
    throw error;
  }finally{client.release();}
}

export function buildCommunicationRouter({auth,audit,pool,query}){
  const router=Router();

  router.get('/communications/config',auth('OWNER','ADMIN'),async(req,res,next)=>{
    try{
      const r=await query(`SELECT provider,status,environment,config,last_error,last_sync_at,updated_at,
        (secret_ciphertext IS NOT NULL) configured
        FROM tenant_integrations WHERE tenant_id=$1 AND provider IN ('SMTP','WHATSAPP_META')`,[req.user.tenantId]);
      res.json(r.rows);
    }catch(error){next(error);}
  });

  router.put('/communications/smtp',auth('OWNER','ADMIN'),async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const host=clean(req.body?.host,255),user=clean(req.body?.user,320),password=String(req.body?.password||'');
      const from=clean(req.body?.from,320),port=Number(req.body?.port||587);
      if(!host||!from||password.length<1||!Number.isInteger(port)||port<1||port>65535) return res.status(400).json({error:'Configuração SMTP inválida'});
      const secret=encryptSecret(password);
      await client.query('BEGIN');
      await client.query(`INSERT INTO tenant_integrations(
        tenant_id,provider,status,environment,config,secret_ciphertext,secret_iv,secret_tag,last_error
      ) VALUES($1,'SMTP','ACTIVE','SMTP',$2,$3,$4,$5,NULL)
      ON CONFLICT(tenant_id,provider) DO UPDATE SET status='ACTIVE',config=EXCLUDED.config,
        secret_ciphertext=EXCLUDED.secret_ciphertext,secret_iv=EXCLUDED.secret_iv,secret_tag=EXCLUDED.secret_tag,last_error=NULL,updated_at=now()`,[
        req.user.tenantId,{host,port,secure:Boolean(req.body?.secure),requireTls:req.body?.requireTls!==false,user,from},
        secret.ciphertext,secret.iv,secret.tag
      ]);
      await audit(client,req.user,'SMTP_CONFIGURED','tenant_integration',null,{host,port,from});
      await client.query('COMMIT');
      res.json({provider:'SMTP',status:'ACTIVE',host,port,from});
    }catch(error){await client.query('ROLLBACK');next(error);}finally{client.release();}
  });

  router.put('/communications/whatsapp',auth('OWNER','ADMIN'),async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const phoneNumberId=clean(req.body?.phoneNumberId,120),apiVersion=clean(req.body?.apiVersion,40),token=String(req.body?.accessToken||'');
      if(!phoneNumberId||!/^v\d+\.\d+$/.test(apiVersion)||token.length<20) return res.status(400).json({error:'Configuração WhatsApp inválida'});
      const secret=encryptSecret(token);
      await client.query('BEGIN');
      await client.query(`INSERT INTO tenant_integrations(
        tenant_id,provider,status,environment,config,secret_ciphertext,secret_iv,secret_tag,last_error
      ) VALUES($1,'WHATSAPP_META','ACTIVE','CLOUD_API',$2,$3,$4,$5,NULL)
      ON CONFLICT(tenant_id,provider) DO UPDATE SET status='ACTIVE',config=EXCLUDED.config,
        secret_ciphertext=EXCLUDED.secret_ciphertext,secret_iv=EXCLUDED.secret_iv,secret_tag=EXCLUDED.secret_tag,last_error=NULL,updated_at=now()`,[
        req.user.tenantId,{phoneNumberId,apiVersion},secret.ciphertext,secret.iv,secret.tag
      ]);
      await audit(client,req.user,'WHATSAPP_CONFIGURED','tenant_integration',null,{phoneNumberId,apiVersion});
      await client.query('COMMIT');
      res.json({provider:'WHATSAPP_META',status:'ACTIVE',phoneNumberId,apiVersion});
    }catch(error){await client.query('ROLLBACK');next(error);}finally{client.release();}
  });

  router.post('/communications/enqueue',auth('OWNER','ADMIN','MANAGER','FINANCE'),async(req,res,next)=>{
    try{
      const inserted=await enqueueCommunicationRules(query,req.user.tenantId,req.user.timezone);
      res.json(inserted);
    }catch(error){next(error);}
  });

  router.post('/communications/process',auth('OWNER','ADMIN','MANAGER','FINANCE'),async(req,res,next)=>{
    try{
      const result=await processCommunicationQueue({pool,query,tenantId:req.user.tenantId,limit:req.body?.limit||50});
      res.json(result);
    }catch(error){next(error);}
  });

  return router;
}
