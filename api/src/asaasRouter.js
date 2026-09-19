import { Router } from 'express';
import crypto from 'node:crypto';
import { decryptSecret, encryptSecret, secretHash, timingSafeSecretMatch } from './secureSecrets.js';

const clean = (value,max=1000)=>String(value??'').trim().slice(0,max);
const digits = value => String(value||'').replace(/\D/g,'');

function dbDate(value){
  if(value instanceof Date) return value.toISOString().slice(0,10);
  return String(value||'').slice(0,10);
}

function baseUrl(environment){
  return String(environment||'SANDBOX').toUpperCase()==='PRODUCTION'
    ? 'https://api.asaas.com/v3'
    : 'https://api-sandbox.asaas.com/v3';
}

async function readJson(response){
  const text=await response.text();
  if(!text) return {};
  try{return JSON.parse(text);}catch{return {raw:text};}
}

async function asaasRequest(integration,path,{method='GET',body}={}){
  const apiKey=decryptSecret(integration);
  const response=await fetch(baseUrl(integration.environment)+path,{
    method,
    headers:{
      'content-type':'application/json',
      'accept':'application/json',
      'access_token':apiKey
    },
    body:body==null?undefined:JSON.stringify(body),
    signal:AbortSignal.timeout(30000)
  });
  const data=await readJson(response);
  if(!response.ok){
    const message=data?.errors?.map?.(x=>x.description).filter(Boolean).join('; ')
      || data?.message || `Asaas respondeu HTTP ${response.status}`;
    throw Object.assign(new Error(message),{statusCode:502,providerStatus:response.status,providerBody:data});
  }
  return data;
}

async function integrationFor(query,tenantId){
  const r=await query(`SELECT * FROM tenant_integrations
    WHERE tenant_id=$1 AND provider='ASAAS' AND status='ACTIVE' LIMIT 1`,[tenantId]);
  if(!r.rowCount) throw Object.assign(new Error('Integração Asaas não configurada'),{statusCode:409});
  return r.rows[0];
}

async function ensureAsaasCustomer(client,integration,student){
  const existing=await client.query(`SELECT external_id FROM provider_customers
    WHERE tenant_id=$1 AND student_id=$2 AND provider='ASAAS'`,[student.tenant_id,student.id]);
  if(existing.rowCount) return existing.rows[0].external_id;
  const cpf=digits(student.cpf);
  if(cpf.length!==11 && cpf.length!==14){
    throw Object.assign(new Error('CPF/CNPJ válido é obrigatório para criar cliente no Asaas'),{statusCode:409});
  }
  const created=await asaasRequest(integration,'/customers',{
    method:'POST',
    body:{
      name:student.name,
      cpfCnpj:cpf,
      ...(student.email?{email:student.email}:{}),
      ...(student.phone?{mobilePhone:digits(student.phone)}:{}),
      externalReference:student.id
    }
  });
  if(!created?.id) throw Object.assign(new Error('Asaas não retornou o identificador do cliente'),{statusCode:502});
  await client.query(`INSERT INTO provider_customers(tenant_id,student_id,provider,external_id)
    VALUES($1,$2,'ASAAS',$3)
    ON CONFLICT(tenant_id,student_id,provider) DO UPDATE SET external_id=EXCLUDED.external_id,updated_at=now()`,
    [student.tenant_id,student.id,created.id]);
  return created.id;
}

export function buildAsaasRouter({auth,audit,pool,query}){
  const router=Router();

  router.get('/asaas',auth('OWNER','ADMIN','FINANCE'),async(req,res,next)=>{
    try{
      const r=await query(`SELECT provider,status,environment,config,last_error,last_sync_at,created_at,updated_at,
        (secret_ciphertext IS NOT NULL) configured,(webhook_token_hash IS NOT NULL) webhook_configured
        FROM tenant_integrations WHERE tenant_id=$1 AND provider='ASAAS'`,[req.user.tenantId]);
      res.json(r.rows[0]||{provider:'ASAAS',configured:false,status:'DISABLED'});
    }catch(error){next(error);}
  });

  router.put('/asaas',auth('OWNER','ADMIN'),async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const environment=String(req.body?.environment||'SANDBOX').toUpperCase();
      if(!['SANDBOX','PRODUCTION'].includes(environment)) return res.status(400).json({error:'Ambiente inválido'});
      const apiKey=String(req.body?.apiKey||'').trim();
      if(apiKey.length<20) return res.status(400).json({error:'API Key Asaas inválida'});
      const encrypted=encryptSecret(apiKey);
      const existing=await client.query(`SELECT webhook_token_hash,config FROM tenant_integrations
        WHERE tenant_id=$1 AND provider='ASAAS'`,[req.user.tenantId]);
      let webhookToken=null;
      let webhookHash=existing.rows[0]?.webhook_token_hash||null;
      if(!webhookHash || req.body?.rotateWebhookToken===true){
        webhookToken=crypto.randomBytes(36).toString('base64url');
        webhookHash=secretHash(webhookToken);
      }
      await client.query('BEGIN');
      await client.query(`INSERT INTO tenant_integrations(
        tenant_id,provider,status,environment,config,secret_ciphertext,secret_iv,secret_tag,webhook_token_hash,last_error
      ) VALUES($1,'ASAAS','ACTIVE',$2,$3,$4,$5,$6,$7,NULL)
      ON CONFLICT(tenant_id,provider) DO UPDATE SET
        status='ACTIVE',environment=EXCLUDED.environment,config=EXCLUDED.config,
        secret_ciphertext=EXCLUDED.secret_ciphertext,secret_iv=EXCLUDED.secret_iv,secret_tag=EXCLUDED.secret_tag,
        webhook_token_hash=EXCLUDED.webhook_token_hash,last_error=NULL,updated_at=now()`,[
        req.user.tenantId,environment,
        {...(existing.rows[0]?.config||{}),notificationDisabled:Boolean(req.body?.notificationDisabled)},
        encrypted.ciphertext,encrypted.iv,encrypted.tag,webhookHash
      ]);
      await audit(client,req.user,'ASAAS_INTEGRATION_CONFIGURED','tenant_integration',null,{environment,rotatedWebhookToken:Boolean(webhookToken)});
      await client.query('COMMIT');
      res.json({
        provider:'ASAAS',status:'ACTIVE',environment,
        ...(webhookToken?{webhookToken,warning:'Token do webhook exibido somente nesta resposta.'}:{})
      });
    }catch(error){await client.query('ROLLBACK');next(error);}
    finally{client.release();}
  });

  router.post('/asaas/provision-webhook',auth('OWNER','ADMIN'),async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const integration=await integrationFor(query,req.user.tenantId);
      const url=clean(req.body?.url,1000);
      const email=clean(req.body?.email||req.user.email,320);
      if(!/^https:\/\//i.test(url)) return res.status(400).json({error:'URL HTTPS pública é obrigatória'});
      const webhookToken=crypto.randomBytes(36).toString('base64url');
      const events=[
        'PAYMENT_CREATED','PAYMENT_UPDATED','PAYMENT_CONFIRMED','PAYMENT_RECEIVED','PAYMENT_OVERDUE',
        'PAYMENT_DELETED','PAYMENT_RESTORED','PAYMENT_REFUNDED','PAYMENT_PARTIALLY_REFUNDED',
        'PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_RECEIVED_IN_CASH_UNDONE'
      ];
      const created=await asaasRequest(integration,'/webhooks',{method:'POST',body:{
        name:'Minha Academia',
        url,
        email,
        enabled:true,
        interrupted:false,
        authToken:webhookToken,
        sendType:'SEQUENTIALLY',
        events
      }});
      await client.query('BEGIN');
      await client.query(`UPDATE tenant_integrations SET webhook_token_hash=$1,
        config=config || $2::jsonb,updated_at=now(),last_error=NULL
        WHERE tenant_id=$3 AND provider='ASAAS'`,[
        secretHash(webhookToken),JSON.stringify({webhookId:created.id,webhookUrl:url,webhookSendType:'SEQUENTIALLY'}),req.user.tenantId
      ]);
      await audit(client,req.user,'ASAAS_WEBHOOK_PROVISIONED','tenant_integration',null,{webhookId:created.id,url});
      await client.query('COMMIT');
      res.status(201).json({id:created.id,url,events});
    }catch(error){
      await client.query('ROLLBACK');
      await query(`UPDATE tenant_integrations SET status='ERROR',last_error=$1,updated_at=now()
        WHERE tenant_id=$2 AND provider='ASAAS'`,[clean(error.message,2000),req.user.tenantId]).catch(()=>{});
      next(error);
    }finally{client.release();}
  });

  router.post('/asaas/charges/:id',auth('OWNER','ADMIN','MANAGER','FINANCE'),async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const integration=await integrationFor(query,req.user.tenantId);
      const billingType=String(req.body?.billingType||'PIX').toUpperCase();
      if(!['PIX','BOLETO','CREDIT_CARD','UNDEFINED'].includes(billingType)) return res.status(400).json({error:'Forma de cobrança inválida'});
      await client.query('BEGIN');
      const r=await client.query(`SELECT ch.*,s.name,s.cpf,s.email,s.phone,s.tenant_id
        FROM charges ch JOIN students s ON s.tenant_id=ch.tenant_id AND s.id=ch.student_id
        WHERE ch.tenant_id=$1 AND ch.id=$2 FOR UPDATE`,[req.user.tenantId,req.params.id]);
      if(!r.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Cobrança não encontrada'});}
      const charge=r.rows[0];
      if(charge.status==='PAID'){await client.query('ROLLBACK');return res.status(409).json({error:'Cobrança já paga'});}
      if(charge.provider==='ASAAS'&&charge.external_id){
        await client.query('ROLLBACK');
        return res.status(409).json({error:'Cobrança já enviada ao Asaas',externalId:charge.external_id,invoiceUrl:charge.invoice_url});
      }
      const customer=await ensureAsaasCustomer(client,integration,charge);
      const payment=await asaasRequest(integration,'/payments',{method:'POST',body:{
        customer,
        billingType,
        value:Number(charge.amount_cents)/100,
        dueDate:dbDate(charge.due_date),
        description:clean(charge.description,500),
        externalReference:charge.id
      }});
      await client.query(`UPDATE charges SET provider='ASAAS',external_id=$1,invoice_url=$2,billing_type=$3,
        provider_status=$4 WHERE tenant_id=$5 AND id=$6`,[
        payment.id,payment.invoiceUrl||null,billingType,payment.status||'PENDING',req.user.tenantId,charge.id
      ]);
      await client.query(`UPDATE tenant_integrations SET last_sync_at=now(),status='ACTIVE',last_error=NULL,updated_at=now()
        WHERE tenant_id=$1 AND provider='ASAAS'`,[req.user.tenantId]);
      await audit(client,req.user,'ASAAS_CHARGE_CREATED','charge',charge.id,{externalId:payment.id,billingType});
      await client.query('COMMIT');
      res.status(201).json({chargeId:charge.id,externalId:payment.id,invoiceUrl:payment.invoiceUrl||null,status:payment.status||null,billingType});
    }catch(error){
      await client.query('ROLLBACK');
      await query(`UPDATE tenant_integrations SET status='ERROR',last_error=$1,updated_at=now()
        WHERE tenant_id=$2 AND provider='ASAAS'`,[clean(error.message,2000),req.user.tenantId]).catch(()=>{});
      next(error);
    }finally{client.release();}
  });

  router.post('/asaas/webhook/:tenantId',async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const token=String(req.get('asaas-access-token')||'');
      const integration=await query(`SELECT webhook_token_hash FROM tenant_integrations
        WHERE tenant_id=$1 AND provider='ASAAS' AND status IN ('ACTIVE','ERROR')`,[req.params.tenantId]);
      if(!integration.rowCount||!timingSafeSecretMatch(token,integration.rows[0].webhook_token_hash)){
        return res.status(401).json({error:'Webhook não autorizado'});
      }
      const eventId=clean(req.body?.id,255);
      const eventType=clean(req.body?.event,120);
      const payment=req.body?.payment||{};
      if(!eventId||!eventType) return res.status(400).json({error:'Evento inválido'});
      await client.query('BEGIN');
      const inserted=await client.query(`INSERT INTO webhook_events(tenant_id,provider,event_id,event_type,payload)
        VALUES($1,'ASAAS',$2,$3,$4)
        ON CONFLICT(provider,event_id) DO NOTHING RETURNING id`,[
        req.params.tenantId,eventId,eventType,req.body
      ]);
      if(!inserted.rowCount){
        await client.query('ROLLBACK');
        return res.status(200).json({ok:true,duplicate:true});
      }
      const charge=payment?.id?await client.query(`SELECT * FROM charges
        WHERE tenant_id=$1 AND provider='ASAAS' AND external_id=$2 FOR UPDATE`,[req.params.tenantId,payment.id]):{rowCount:0,rows:[]};
      if(charge.rowCount){
        const ch=charge.rows[0];
        if(['PAYMENT_CONFIRMED','PAYMENT_RECEIVED'].includes(eventType)){
          const outstanding=Math.max(0,Number(ch.amount_cents)-Number(ch.paid_cents));
          const eventAmount=Math.max(0,Math.round(Number(payment.value||0)*100));
          const amount=Math.min(outstanding,eventAmount||outstanding);
          if(amount>0){
            const pay=await client.query(`INSERT INTO payments(tenant_id,charge_id,amount_cents,method,provider,external_id,metadata)
              VALUES($1,$2,$3,$4,'ASAAS',$5,$6)
              ON CONFLICT(tenant_id,provider,external_id) WHERE external_id IS NOT NULL DO NOTHING RETURNING id`,[
              req.params.tenantId,ch.id,amount,
              payment.billingType==='PIX'?'PIX':payment.billingType==='BOLETO'?'BANK_SLIP':payment.billingType==='CREDIT_CARD'?'CARD':'OTHER',
              payment.id,{eventId,eventType,providerStatus:payment.status||null}
            ]);
            if(pay.rowCount){
              const newPaid=Math.min(Number(ch.amount_cents),Number(ch.paid_cents)+amount);
              await client.query(`UPDATE charges SET paid_cents=$1,status=$2,provider_status=$3 WHERE tenant_id=$4 AND id=$5`,[
                newPaid,newPaid>=Number(ch.amount_cents)?'PAID':'PARTIAL',payment.status||eventType,req.params.tenantId,ch.id
              ]);
            }else{
              await client.query('UPDATE charges SET provider_status=$1 WHERE tenant_id=$2 AND id=$3',[payment.status||eventType,req.params.tenantId,ch.id]);
            }
          }
        } else if(eventType==='PAYMENT_OVERDUE' && ch.status!=='PAID'){
          await client.query(`UPDATE charges SET status='OVERDUE',provider_status=$1 WHERE tenant_id=$2 AND id=$3`,[
            payment.status||eventType,req.params.tenantId,ch.id
          ]);
        } else if(eventType==='PAYMENT_DELETED'){
          await client.query(`UPDATE charges SET status='CANCELED',provider_status=$1 WHERE tenant_id=$2 AND id=$3`,[
            payment.status||eventType,req.params.tenantId,ch.id
          ]);
        } else if(['PAYMENT_REFUNDED','PAYMENT_CHARGEBACK_REQUESTED','PAYMENT_RECEIVED_IN_CASH_UNDONE'].includes(eventType)){
          await client.query(`UPDATE charges SET paid_cents=0,status='PENDING',provider_status=$1 WHERE tenant_id=$2 AND id=$3`,[
            payment.status||eventType,req.params.tenantId,ch.id
          ]);
        } else if(eventType==='PAYMENT_PARTIALLY_REFUNDED'){
          const refunded=Math.max(0,Math.round(Number(payment.refundedValue||0)*100));
          const paid=Math.max(0,Number(ch.paid_cents)-refunded);
          await client.query(`UPDATE charges SET paid_cents=$1,status=$2,provider_status=$3 WHERE tenant_id=$4 AND id=$5`,[
            paid,paid===0?'PENDING':paid<Number(ch.amount_cents)?'PARTIAL':'PAID',payment.status||eventType,req.params.tenantId,ch.id
          ]);
        } else if(eventType==='PAYMENT_RESTORED' && ch.status==='CANCELED'){
          await client.query(`UPDATE charges SET status='PENDING',provider_status=$1 WHERE tenant_id=$2 AND id=$3`,[
            payment.status||eventType,req.params.tenantId,ch.id
          ]);
        } else {
          await client.query('UPDATE charges SET provider_status=$1 WHERE tenant_id=$2 AND id=$3',[payment.status||eventType,req.params.tenantId,ch.id]);
        }
      }
      await client.query('UPDATE webhook_events SET processed_at=now() WHERE id=$1',[inserted.rows[0].id]);
      await client.query(`UPDATE tenant_integrations SET last_sync_at=now(),status='ACTIVE',last_error=NULL,updated_at=now()
        WHERE tenant_id=$1 AND provider='ASAAS'`,[req.params.tenantId]);
      await client.query('COMMIT');
      res.status(200).json({ok:true});
    }catch(error){await client.query('ROLLBACK');next(error);}
    finally{client.release();}
  });

  return router;
}
