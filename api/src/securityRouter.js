import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { encryptSecret, decryptSecret, secretHash } from './secureSecrets.js';
import { generateTotpSecret, verifyTotp, generateRecoveryCodes, recoveryHash, verifyRecoveryCode, otpauthUri } from './authSecurity.js';

const clean=(value,max=1000)=>String(value??'').trim().slice(0,max);
const adminRoles=new Set(['OWNER','ADMIN','MANAGER','FINANCE']);

function publicUser(row){
  return {
    id:row.id,tenantId:row.tenant_id,unitId:row.unit_id,name:row.name,email:row.email,role:row.role,
    tenantName:row.trade_name,tenantSlug:row.slug
  };
}

function signSession(row,jwtSecret){
  return jwt.sign({id:row.id,v:Number(row.auth_version||1)},jwtSecret,{expiresIn:'8h',subject:row.id});
}

function decryptTotp(row){
  return decryptSecret({
    secret_ciphertext:row.totp_secret_ciphertext,
    secret_iv:row.totp_secret_iv,
    secret_tag:row.totp_secret_tag
  });
}

export function buildSecurityRouter({auth,audit,pool,query,jwtSecret}){
  const router=Router();

  router.post('/auth/forgot-password',async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const email=clean(req.body?.email,320).toLowerCase();
      const tenant=clean(req.body?.tenant,120).toLowerCase();
      if(!email) return res.status(202).json({ok:true});
      const params=[email];
      let where='lower(u.email)=$1 AND u.active AND t.active';
      if(tenant){params.push(tenant);where+=' AND lower(t.slug)=$2';}
      const found=await client.query(`SELECT u.id,u.tenant_id,u.email,t.slug
        FROM users u JOIN tenants t ON t.id=u.tenant_id
        WHERE ${where} ORDER BY u.created_at LIMIT 2`,params);
      if(found.rowCount!==1) return res.status(202).json({ok:true});

      const user=found.rows[0];
      const raw=crypto.randomBytes(32).toString('base64url');
      const hash=secretHash(raw);
      const expiresMinutes=Math.max(10,Math.min(120,Number(process.env.PASSWORD_RESET_MINUTES||30)));
      const publicUrl=String(process.env.APP_PUBLIC_URL||'http://localhost:8080').replace(/\/$/,'');
      const resetUrl=`${publicUrl}/?resetToken=${encodeURIComponent(raw)}&tenant=${encodeURIComponent(user.slug)}`;

      await client.query('BEGIN');
      await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE tenant_id=$1 AND user_id=$2 AND used_at IS NULL',[user.tenant_id,user.id]);
      await client.query(`INSERT INTO password_reset_tokens(tenant_id,user_id,token_hash,expires_at)
        VALUES($1,$2,$3,now()+($4::text||' minutes')::interval)`,[user.tenant_id,user.id,hash,String(expiresMinutes)]);
      await client.query(`INSERT INTO communication_queue(
        tenant_id,student_id,channel,template_key,destination,payload,idempotency_key
      ) VALUES($1,NULL,'EMAIL','PASSWORD_RESET',$2,$3,$4)`,[
        user.tenant_id,user.email,{resetUrl,expiresMinutes},`password-reset:${hash}`
      ]);
      await client.query('COMMIT');

      res.status(202).json({
        ok:true,
        ...(process.env.NODE_ENV==='test'?{debugToken:raw}: {})
      });
    }catch(error){await client.query('ROLLBACK');next(error);}
    finally{client.release();}
  });

  router.post('/auth/reset-password',async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const token=String(req.body?.token||'');
      const password=String(req.body?.password||'');
      if(token.length<20||password.length<10) return res.status(400).json({error:'Token ou senha inválidos'});
      const hash=secretHash(token);
      await client.query('BEGIN');
      const found=await client.query(`SELECT prt.*,u.email FROM password_reset_tokens prt
        JOIN users u ON u.tenant_id=prt.tenant_id AND u.id=prt.user_id
        WHERE prt.token_hash=$1 AND prt.used_at IS NULL AND prt.expires_at>now()
        FOR UPDATE`,[hash]);
      if(!found.rowCount){
        await client.query('ROLLBACK');
        return res.status(400).json({error:'Token expirado ou já utilizado'});
      }
      const row=found.rows[0];
      const passwordHash=await bcrypt.hash(password,12);
      await client.query(`UPDATE users SET password_hash=$1,password_changed_at=now(),auth_version=auth_version+1
        WHERE tenant_id=$2 AND id=$3`,[passwordHash,row.tenant_id,row.user_id]);
      await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE id=$1',[row.id]);
      await client.query('UPDATE password_reset_tokens SET used_at=now() WHERE tenant_id=$1 AND user_id=$2 AND used_at IS NULL',[row.tenant_id,row.user_id]);
      await client.query(`INSERT INTO audit_logs(tenant_id,user_id,action,entity_type,entity_id,metadata)
        VALUES($1,$2,'PASSWORD_RESET','user',$2,$3)`,[row.tenant_id,row.user_id,{selfService:true}]);
      await client.query('COMMIT');
      res.json({ok:true});
    }catch(error){await client.query('ROLLBACK');next(error);}
    finally{client.release();}
  });

  router.post('/mfa/setup',auth('OWNER','ADMIN','MANAGER','FINANCE'),async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const secret=generateTotpSecret();
      const encrypted=encryptSecret(secret);
      await client.query('BEGIN');
      await client.query(`INSERT INTO user_security(
        tenant_id,user_id,mfa_enabled,totp_secret_ciphertext,totp_secret_iv,totp_secret_tag,recovery_code_hashes,updated_at
      ) VALUES($1,$2,false,$3,$4,$5,'[]'::jsonb,now())
      ON CONFLICT(tenant_id,user_id) DO UPDATE SET
        mfa_enabled=false,totp_secret_ciphertext=EXCLUDED.totp_secret_ciphertext,
        totp_secret_iv=EXCLUDED.totp_secret_iv,totp_secret_tag=EXCLUDED.totp_secret_tag,
        recovery_code_hashes='[]'::jsonb,mfa_confirmed_at=NULL,updated_at=now()`,[
        req.user.tenantId,req.user.id,encrypted.ciphertext,encrypted.iv,encrypted.tag
      ]);
      await audit(client,req.user,'MFA_SETUP_STARTED','user',req.user.id);
      await client.query('COMMIT');
      res.json({secret,otpauthUri:otpauthUri({secret,email:req.user.email,issuer:req.user.tenantName||'Minha Academia'})});
    }catch(error){await client.query('ROLLBACK');next(error);}
    finally{client.release();}
  });

  router.post('/mfa/confirm',auth('OWNER','ADMIN','MANAGER','FINANCE'),async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const row=await client.query('SELECT * FROM user_security WHERE tenant_id=$1 AND user_id=$2',[req.user.tenantId,req.user.id]);
      if(!row.rowCount||!row.rows[0].totp_secret_ciphertext) return res.status(409).json({error:'Inicie a configuração do MFA'});
      const secret=decryptTotp(row.rows[0]);
      if(!verifyTotp(secret,req.body?.code)) return res.status(400).json({error:'Código MFA inválido'});
      const recovery=generateRecoveryCodes(8);
      const hashes=recovery.map(recoveryHash);
      await client.query('BEGIN');
      await client.query(`UPDATE user_security SET mfa_enabled=true,recovery_code_hashes=$1,mfa_confirmed_at=now(),updated_at=now()
        WHERE tenant_id=$2 AND user_id=$3`,[JSON.stringify(hashes),req.user.tenantId,req.user.id]);
      await client.query('UPDATE users SET auth_version=auth_version+1 WHERE tenant_id=$1 AND id=$2',[req.user.tenantId,req.user.id]);
      await audit(client,req.user,'MFA_ENABLED','user',req.user.id);
      await client.query('COMMIT');
      res.json({enabled:true,recoveryCodes:recovery});
    }catch(error){await client.query('ROLLBACK');next(error);}
    finally{client.release();}
  });

  router.post('/mfa/disable',auth('OWNER','ADMIN','MANAGER','FINANCE'),async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const password=String(req.body?.password||'');
      const u=await client.query('SELECT password_hash FROM users WHERE tenant_id=$1 AND id=$2',[req.user.tenantId,req.user.id]);
      if(!u.rowCount||!await bcrypt.compare(password,u.rows[0].password_hash)) return res.status(401).json({error:'Senha inválida'});
      await client.query('BEGIN');
      await client.query(`UPDATE user_security SET mfa_enabled=false,totp_secret_ciphertext=NULL,totp_secret_iv=NULL,totp_secret_tag=NULL,
        recovery_code_hashes='[]'::jsonb,mfa_confirmed_at=NULL,updated_at=now() WHERE tenant_id=$1 AND user_id=$2`,[req.user.tenantId,req.user.id]);
      await client.query('UPDATE users SET auth_version=auth_version+1 WHERE tenant_id=$1 AND id=$2',[req.user.tenantId,req.user.id]);
      await audit(client,req.user,'MFA_DISABLED','user',req.user.id);
      await client.query('COMMIT');
      res.json({enabled:false});
    }catch(error){await client.query('ROLLBACK');next(error);}
    finally{client.release();}
  });

  router.get('/mfa/status',auth(),async(req,res,next)=>{
    try{
      const r=await query('SELECT mfa_enabled,mfa_confirmed_at FROM user_security WHERE tenant_id=$1 AND user_id=$2',[req.user.tenantId,req.user.id]);
      res.json({enabled:Boolean(r.rows[0]?.mfa_enabled),confirmedAt:r.rows[0]?.mfa_confirmed_at||null,required:adminRoles.has(req.user.role)});
    }catch(error){next(error);}
  });

  router.post('/auth/mfa',async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const challenge=String(req.body?.mfaToken||'');
      let claims;
      try{claims=jwt.verify(challenge,jwtSecret);}catch{return res.status(401).json({error:'Challenge MFA inválido'});}
      if(claims.scope!=='MFA'||!claims.id) return res.status(401).json({error:'Challenge MFA inválido'});
      const r=await client.query(`SELECT u.*,t.trade_name,t.slug,t.billing_status,
        us.mfa_enabled,us.totp_secret_ciphertext,us.totp_secret_iv,us.totp_secret_tag,us.recovery_code_hashes
        FROM users u JOIN tenants t ON t.id=u.tenant_id
        JOIN user_security us ON us.tenant_id=u.tenant_id AND us.user_id=u.id
        WHERE u.id=$1 AND u.active AND t.active`,[claims.id]);
      if(!r.rowCount||!r.rows[0].mfa_enabled) return res.status(401).json({error:'MFA indisponível'});
      const user=r.rows[0];
      let ok=false,usedRecovery=false;
      const code=String(req.body?.code||'').trim();
      if(/^\d{6}$/.test(code)){
        ok=verifyTotp(decryptTotp(user),code);
      }else{
        const hashes=Array.isArray(user.recovery_code_hashes)?user.recovery_code_hashes:[];
        const idx=verifyRecoveryCode(code,hashes);
        if(idx>=0){
          ok=true;usedRecovery=true;
          const next=[...hashes];next.splice(idx,1);
          await client.query('UPDATE user_security SET recovery_code_hashes=$1,updated_at=now() WHERE tenant_id=$2 AND user_id=$3',[JSON.stringify(next),user.tenant_id,user.id]);
        }
      }
      if(!ok) return res.status(401).json({error:'Código MFA inválido'});
      if(['SUSPENDED','CANCELED'].includes(user.billing_status)) return res.status(402).json({error:'Assinatura da academia indisponível'});
      const token=signSession(user,jwtSecret);
      res.json({token,user:publicUser(user),usedRecovery});
    }catch(error){next(error);}
    finally{client.release();}
  });

  return router;
}
