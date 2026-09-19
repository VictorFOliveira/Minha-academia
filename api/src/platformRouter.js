import { Router } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { usageForTenant } from './saasLimits.js';
import { generatePlatformInvoices, sendPlatformInvoiceToAsaas, handlePlatformAsaasWebhook } from './platformBilling.js';
import { encryptSecret, decryptSecret } from './secureSecrets.js';
import { generateTotpSecret, verifyTotp, generateRecoveryCodes, recoveryHash, verifyRecoveryCode, otpauthUri } from './authSecurity.js';

const clean = (value, max=255) => String(value||'').trim().slice(0,max);
const slugify = value => clean(value,120).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

function decryptPlatformTotp(row){
  return decryptSecret({
    secret_ciphertext:row.totp_secret_ciphertext,
    secret_iv:row.totp_secret_iv,
    secret_tag:row.totp_secret_tag
  });
}

export function buildPlatformRouter({ pool, query, platformSecret }) {
  const router = Router();

  const platformAuth = async (req,res,next) => {
    const raw=String(req.headers.authorization||'').replace(/^Bearer\s+/i,'');
    if(!raw) return res.status(401).json({error:'Sessão da plataforma inválida'});
    try{
      const claims=jwt.verify(raw,platformSecret);
      if(claims.scope!=='PLATFORM') return res.status(401).json({error:'Sessão da plataforma inválida'});
      const admin=await query('SELECT id,name,email,auth_version,mfa_enabled FROM platform_admins WHERE id=$1 AND active',[claims.id]);
      if(!admin.rowCount || Number(claims.v||1)!==Number(admin.rows[0].auth_version||1)) return res.status(401).json({error:'Sessão da plataforma inválida'});
      req.platformAdmin=admin.rows[0];
      next();
    }catch{
      return res.status(401).json({error:'Sessão da plataforma inválida'});
    }
  };

  router.post('/auth/login', async (req,res,next)=>{
    try{
      const email=clean(req.body?.email,320).toLowerCase();
      const password=String(req.body?.password||'');
      const r=await query('SELECT * FROM platform_admins WHERE lower(email)=$1 AND active LIMIT 1',[email]);
      if(!r.rowCount || !await bcrypt.compare(password,r.rows[0].password_hash)) return res.status(401).json({error:'E-mail ou senha inválidos'});
      const admin=r.rows[0];
      if(admin.mfa_enabled){
        const mfaToken=jwt.sign({id:admin.id,scope:'PLATFORM_MFA'},platformSecret,{expiresIn:'5m',subject:admin.id});
        return res.json({mfaRequired:true,mfaToken,user:{id:admin.id,name:admin.name,email:admin.email,role:'PLATFORM_ADMIN'}});
      }
      await query('UPDATE platform_admins SET last_login_at=now() WHERE id=$1',[admin.id]);
      const token=jwt.sign({id:admin.id,scope:'PLATFORM',v:Number(admin.auth_version||1)},platformSecret,{expiresIn:'8h',subject:admin.id});
      res.json({token,user:{id:admin.id,name:admin.name,email:admin.email,role:'PLATFORM_ADMIN'}});
    }catch(error){next(error);}
  });

  router.post('/auth/mfa', async (req,res,next)=>{
    try{
      let claims;
      try{claims=jwt.verify(String(req.body?.mfaToken||''),platformSecret);}catch{return res.status(401).json({error:'Challenge MFA inválido'});}
      if(claims.scope!=='PLATFORM_MFA') return res.status(401).json({error:'Challenge MFA inválido'});
      const r=await query('SELECT * FROM platform_admins WHERE id=$1 AND active',[claims.id]);
      if(!r.rowCount||!r.rows[0].mfa_enabled) return res.status(401).json({error:'MFA indisponível'});
      const admin=r.rows[0];
      const code=String(req.body?.code||'').trim();
      let ok=false,usedRecovery=false;
      if(/^\d{6}$/.test(code)) ok=verifyTotp(decryptPlatformTotp(admin),code);
      else{
        const hashes=Array.isArray(admin.recovery_code_hashes)?admin.recovery_code_hashes:[];
        const idx=verifyRecoveryCode(code,hashes);
        if(idx>=0){
          ok=true;usedRecovery=true;
          const nextCodes=[...hashes];nextCodes.splice(idx,1);
          await query('UPDATE platform_admins SET recovery_code_hashes=$1 WHERE id=$2',[JSON.stringify(nextCodes),admin.id]);
        }
      }
      if(!ok) return res.status(401).json({error:'Código MFA inválido'});
      await query('UPDATE platform_admins SET last_login_at=now() WHERE id=$1',[admin.id]);
      const token=jwt.sign({id:admin.id,scope:'PLATFORM',v:Number(admin.auth_version||1)},platformSecret,{expiresIn:'8h',subject:admin.id});
      res.json({token,user:{id:admin.id,name:admin.name,email:admin.email,role:'PLATFORM_ADMIN'},usedRecovery});
    }catch(error){next(error);}
  });

  router.get('/security/mfa/status', platformAuth, async (req,res,next)=>{
    try{
      const r=await query('SELECT mfa_enabled FROM platform_admins WHERE id=$1',[req.platformAdmin.id]);
      res.json({enabled:Boolean(r.rows[0]?.mfa_enabled)});
    }catch(error){next(error);}
  });

  router.post('/security/mfa/setup', platformAuth, async (req,res,next)=>{
    try{
      const secret=generateTotpSecret();
      const encrypted=encryptSecret(secret);
      await query(`UPDATE platform_admins SET mfa_enabled=false,totp_secret_ciphertext=$1,totp_secret_iv=$2,totp_secret_tag=$3,recovery_code_hashes='[]'::jsonb WHERE id=$4`,[
        encrypted.ciphertext,encrypted.iv,encrypted.tag,req.platformAdmin.id
      ]);
      res.json({secret,otpauthUri:otpauthUri({secret,email:req.platformAdmin.email,issuer:'Minha Academia Platform'})});
    }catch(error){next(error);}
  });

  router.post('/security/mfa/confirm', platformAuth, async (req,res,next)=>{
    try{
      const r=await query('SELECT * FROM platform_admins WHERE id=$1',[req.platformAdmin.id]);
      if(!r.rowCount||!r.rows[0].totp_secret_ciphertext) return res.status(409).json({error:'Inicie a configuração do MFA'});
      if(!verifyTotp(decryptPlatformTotp(r.rows[0]),req.body?.code)) return res.status(400).json({error:'Código MFA inválido'});
      const recoveryCodes=generateRecoveryCodes(10);
      await query('UPDATE platform_admins SET mfa_enabled=true,recovery_code_hashes=$1,auth_version=auth_version+1 WHERE id=$2',[
        JSON.stringify(recoveryCodes.map(recoveryHash)),req.platformAdmin.id
      ]);
      res.json({enabled:true,recoveryCodes});
    }catch(error){next(error);}
  });

  router.post('/billing/asaas/webhook', async (req,res,next)=>{
    try{
      const result=await handlePlatformAsaasWebhook({
        pool,
        token:String(req.get('asaas-access-token')||''),
        payload:req.body
      });
      res.status(200).json(result);
    }catch(error){next(error);}
  });

  router.get('/billing/invoices', platformAuth, async (req,res,next)=>{
    try{
      const tenantId=String(req.query?.tenantId||'').trim()||null;
      const r=await query(`SELECT i.*,t.trade_name,t.slug FROM tenant_saas_invoices i
        JOIN tenants t ON t.id=i.tenant_id
        WHERE ($1::uuid IS NULL OR i.tenant_id=$1)
        ORDER BY i.due_date DESC,i.created_at DESC LIMIT 1000`,[tenantId]);
      res.json(r.rows);
    }catch(error){next(error);}
  });

  router.post('/billing/generate', platformAuth, async (req,res,next)=>{
    try{
      const cycleKey=/^\d{4}-\d{2}$/.test(String(req.body?.cycleKey||''))?req.body.cycleKey:undefined;
      const result=await generatePlatformInvoices({pool,query,cycleKey});
      res.json(result);
    }catch(error){next(error);}
  });

  router.post('/billing/invoices/:id/asaas', platformAuth, async (req,res,next)=>{
    try{
      const invoice=await sendPlatformInvoiceToAsaas({pool,invoiceId:req.params.id});
      res.json(invoice);
    }catch(error){next(error);}
  });

  router.get('/products', platformAuth, async (_req,res,next)=>{
    try{
      const r=await query('SELECT * FROM saas_products ORDER BY CASE code WHEN \'STARTER\' THEN 1 WHEN \'PRO\' THEN 2 ELSE 3 END');
      res.json(r.rows);
    }catch(error){next(error);}
  });

  router.put('/products/:code', platformAuth, async (req,res,next)=>{
    try{
      const code=String(req.params.code||'').toUpperCase();
      const r=await query(`UPDATE saas_products SET
        price_cents=COALESCE($1,price_cents),
        max_units=$2,max_students=$3,max_coaches=$4,max_access_agents=$5,
        features=COALESCE($6,features),active=COALESCE($7,active)
        WHERE code=$8 RETURNING *`,[
        req.body?.priceCents==null?null:Number(req.body.priceCents),
        req.body?.maxUnits==null?null:Number(req.body.maxUnits),
        req.body?.maxStudents==null?null:Number(req.body.maxStudents),
        req.body?.maxCoaches==null?null:Number(req.body.maxCoaches),
        req.body?.maxAccessAgents==null?null:Number(req.body.maxAccessAgents),
        req.body?.features && typeof req.body.features==='object'?req.body.features:null,
        req.body?.active==null?null:Boolean(req.body.active),code
      ]);
      if(!r.rowCount) return res.status(404).json({error:'Plano SaaS não encontrado'});
      res.json(r.rows[0]);
    }catch(error){next(error);}
  });

  router.get('/tenants', platformAuth, async (_req,res,next)=>{
    try{
      const r=await query(`SELECT t.id,t.slug,t.legal_name,t.trade_name,t.cnpj,t.saas_plan,t.billing_status,
        t.trial_ends_at,t.subscription_started_at,t.created_at,
        (SELECT count(*)::int FROM units u WHERE u.tenant_id=t.id AND u.active) units,
        (SELECT count(*)::int FROM students s WHERE s.tenant_id=t.id AND s.status<>'INACTIVE') students,
        (SELECT count(*)::int FROM users u WHERE u.tenant_id=t.id AND u.role='COACH' AND u.active) coaches
        FROM tenants t ORDER BY t.created_at DESC`);
      res.json(r.rows);
    }catch(error){next(error);}
  });

  router.get('/tenants/:id/usage', platformAuth, async (req,res,next)=>{
    try{
      const usage=await usageForTenant(query,req.params.id);
      if(!usage.plan) return res.status(404).json({error:'Tenant não encontrado'});
      res.json(usage);
    }catch(error){next(error);}
  });

  router.post('/tenants', platformAuth, async (req,res,next)=>{
    const client=await pool.connect();
    try{
      const tradeName=clean(req.body?.tradeName,160);
      const legalName=clean(req.body?.legalName||tradeName,200);
      const slug=slugify(req.body?.slug||tradeName);
      const ownerName=clean(req.body?.ownerName,120);
      const ownerEmail=clean(req.body?.ownerEmail,320).toLowerCase();
      const ownerPassword=String(req.body?.ownerPassword||'');
      const unitName=clean(req.body?.unitName||'Unidade Principal',120);
      const plan=['STARTER','PRO','ENTERPRISE'].includes(String(req.body?.saasPlan||'').toUpperCase())?String(req.body.saasPlan).toUpperCase():'STARTER';
      if(tradeName.length<2||slug.length<2||ownerName.length<2||!ownerEmail.includes('@')||ownerPassword.length<8){
        return res.status(400).json({error:'Dados de onboarding incompletos'});
      }
      await client.query('BEGIN');
      const tenant=await client.query(`INSERT INTO tenants(
        slug,legal_name,trade_name,cnpj,saas_plan,billing_status,trial_ends_at,settings
      ) VALUES($1,$2,$3,$4,$5,'TRIAL',now()+interval '14 days',$6) RETURNING *`,[
        slug,legalName,tradeName,clean(req.body?.cnpj,30)||null,plan,
        {branding:{primaryColor:'#111827',accentColor:'#22c55e'}}
      ]);
      const unit=await client.query('INSERT INTO units(tenant_id,name,address) VALUES($1,$2,$3) RETURNING *',[
        tenant.rows[0].id,unitName,req.body?.address&&typeof req.body.address==='object'?req.body.address:{}
      ]);
      const hash=await bcrypt.hash(ownerPassword,12);
      const owner=await client.query(`INSERT INTO users(tenant_id,unit_id,name,email,password_hash,role)
        VALUES($1,$2,$3,$4,$5,'OWNER') RETURNING id,name,email,role`,[
        tenant.rows[0].id,unit.rows[0].id,ownerName,ownerEmail,hash
      ]);
      await client.query('INSERT INTO user_units(tenant_id,user_id,unit_id,is_primary) VALUES($1,$2,$3,true)',[
        tenant.rows[0].id,owner.rows[0].id,unit.rows[0].id
      ]);
      await client.query(`INSERT INTO tenant_subscription_events(
        tenant_id,actor_platform_admin_id,event_type,to_plan,to_status,metadata
      ) VALUES($1,$2,'TRIAL_STARTED',$3,'TRIAL',$4)`,[
        tenant.rows[0].id,req.platformAdmin.id,plan,{trialDays:14}
      ]);
      await client.query('COMMIT');
      res.status(201).json({tenant:tenant.rows[0],unit:unit.rows[0],owner:owner.rows[0]});
    }catch(error){
      await client.query('ROLLBACK');
      if(error.code==='23505') return res.status(409).json({error:'Slug, CNPJ ou e-mail já cadastrado'});
      next(error);
    }finally{client.release();}
  });

  router.post('/tenants/:id/subscription', platformAuth, async (req,res,next)=>{
    const client=await pool.connect();
    try{
      const nextPlan=req.body?.plan?String(req.body.plan).toUpperCase():null;
      const nextStatus=req.body?.status?String(req.body.status).toUpperCase():null;
      if(nextPlan&&!['STARTER','PRO','ENTERPRISE'].includes(nextPlan)) return res.status(400).json({error:'Plano inválido'});
      if(nextStatus&&!['TRIAL','ACTIVE','OVERDUE','SUSPENDED','CANCELED'].includes(nextStatus)) return res.status(400).json({error:'Status inválido'});
      await client.query('BEGIN');
      const current=await client.query('SELECT * FROM tenants WHERE id=$1 FOR UPDATE',[req.params.id]);
      if(!current.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Tenant não encontrado'});}
      const old=current.rows[0];
      const plan=nextPlan||old.saas_plan,status=nextStatus||old.billing_status;
      await client.query(`UPDATE tenants SET saas_plan=$1,billing_status=$2,
        subscription_started_at=CASE WHEN $2='ACTIVE' AND subscription_started_at IS NULL THEN now() ELSE subscription_started_at END
        WHERE id=$3`,[plan,status,old.id]);
      const eventType=status!==old.billing_status
        ? ({ACTIVE:'ACTIVATED',OVERDUE:'OVERDUE',SUSPENDED:'SUSPENDED',CANCELED:'CANCELED',TRIAL:'REACTIVATED'}[status]||'PLAN_CHANGED')
        : 'PLAN_CHANGED';
      await client.query(`INSERT INTO tenant_subscription_events(
        tenant_id,actor_platform_admin_id,event_type,from_plan,to_plan,from_status,to_status,metadata
      ) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,[
        old.id,req.platformAdmin.id,eventType,old.saas_plan,plan,old.billing_status,status,{note:clean(req.body?.note,1000)||null}
      ]);
      await client.query('COMMIT');
      res.json({tenantId:old.id,plan,status});
    }catch(error){await client.query('ROLLBACK');next(error);}
    finally{client.release();}
  });

  router.get('/tenants/:id/subscription/history', platformAuth, async (req,res,next)=>{
    try{
      const r=await query(`SELECT e.*,pa.name actor_name FROM tenant_subscription_events e
        LEFT JOIN platform_admins pa ON pa.id=e.actor_platform_admin_id
        WHERE e.tenant_id=$1 ORDER BY e.created_at DESC`,[req.params.id]);
      res.json(r.rows);
    }catch(error){next(error);}
  });

  return router;
}
