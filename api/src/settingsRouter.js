import { Router } from 'express';
import crypto from 'node:crypto';

const hex=value=>/^#[0-9a-fA-F]{6}$/.test(String(value||''));
const domainRe=/^(?=.{3,253}$)(?!-)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const clean=(v,max=500)=>String(v??'').trim().slice(0,max);

export function buildSettingsRouter({auth,audit,pool,query}){
  const router=Router();

  router.get('/branding',auth(),async(req,res,next)=>{
    try{
      const r=await query('SELECT trade_name,settings,custom_domain FROM tenants WHERE id=$1',[req.user.tenantId]);
      const row=r.rows[0]||{};
      res.json({
        tradeName:row.trade_name,
        customDomain:row.custom_domain||null,
        branding:{
          primaryColor:row.settings?.branding?.primaryColor||'#111827',
          accentColor:row.settings?.branding?.accentColor||'#22c55e',
          logoUrl:row.settings?.branding?.logoUrl||null
        }
      });
    }catch(error){next(error);}
  });

  router.put('/branding',auth('OWNER','ADMIN'),async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const tradeName=clean(req.body?.tradeName,160);
      const primaryColor=String(req.body?.primaryColor||'');
      const accentColor=String(req.body?.accentColor||'');
      const logoUrl=clean(req.body?.logoUrl,1000)||null;
      if(tradeName.length<2) return res.status(400).json({error:'Nome da academia inválido'});
      if(!hex(primaryColor)||!hex(accentColor)) return res.status(400).json({error:'Cores devem estar no formato #RRGGBB'});
      if(logoUrl && !/^https:\/\//i.test(logoUrl)) return res.status(400).json({error:'Logo deve usar URL HTTPS'});
      await client.query('BEGIN');
      const r=await client.query("UPDATE tenants SET trade_name=$1, settings=jsonb_set(jsonb_set(jsonb_set(settings,'{branding,primaryColor}',$2::jsonb,true),'{branding,accentColor}',$3::jsonb,true),'{branding,logoUrl}',$4::jsonb,true) WHERE id=$5 RETURNING trade_name,settings",[
        tradeName,JSON.stringify(primaryColor),JSON.stringify(accentColor),JSON.stringify(logoUrl),req.user.tenantId
      ]);
      await audit(client,req.user,'BRANDING_UPDATED','tenant',req.user.tenantId,{tradeName,primaryColor,accentColor,logoUrl});
      await client.query('COMMIT');
      res.json({tradeName:r.rows[0].trade_name,branding:r.rows[0].settings.branding});
    }catch(error){await client.query('ROLLBACK');next(error);}finally{client.release();}
  });

  router.get('/domains',auth('OWNER','ADMIN'),async(req,res,next)=>{
    try{
      const r=await query('SELECT id,domain,kind,verified_at,active,created_at FROM tenant_domains WHERE tenant_id=$1 ORDER BY active DESC,created_at DESC',[req.user.tenantId]);
      res.json(r.rows);
    }catch(error){next(error);}
  });

  router.post('/domains',auth('OWNER','ADMIN'),async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const domain=clean(req.body?.domain,253).toLowerCase().replace(/^https?:\/\//,'').replace(/\/$/,'');
      const kind=req.body?.kind==='SUBDOMAIN'?'SUBDOMAIN':'CUSTOM';
      if(!domainRe.test(domain)) return res.status(400).json({error:'Domínio inválido'});
      const token=crypto.randomBytes(24).toString('hex');
      await client.query('BEGIN');
      const r=await client.query('INSERT INTO tenant_domains(tenant_id,domain,kind,verification_token) VALUES($1,$2,$3,$4) RETURNING id,domain,kind,verification_token,created_at',[req.user.tenantId,domain,kind,token]);
      await audit(client,req.user,'DOMAIN_REQUESTED','tenant_domain',r.rows[0].id,{domain,kind});
      await client.query('COMMIT');
      res.status(201).json({...r.rows[0],dnsInstruction:{type:'TXT',name:'_minhaacademia.'+domain,value:token}});
    }catch(error){
      await client.query('ROLLBACK');
      if(error.code==='23505') return res.status(409).json({error:'Domínio já cadastrado'});
      next(error);
    }finally{client.release();}
  });

  router.post('/domains/:id/verify-manual',auth('OWNER','ADMIN'),async(req,res,next)=>{
    const client=await pool.connect();
    try{
      const token=String(req.body?.token||'');
      await client.query('BEGIN');
      const d=await client.query('SELECT * FROM tenant_domains WHERE id=$1 AND tenant_id=$2 FOR UPDATE',[req.params.id,req.user.tenantId]);
      if(!d.rowCount){await client.query('ROLLBACK');return res.status(404).json({error:'Domínio não encontrado'});}
      if(token!==d.rows[0].verification_token){await client.query('ROLLBACK');return res.status(400).json({error:'Token de verificação inválido'});}
      await client.query('UPDATE tenant_domains SET verified_at=now(),active=true WHERE id=$1',[req.params.id]);
      await client.query('UPDATE tenant_domains SET active=false WHERE tenant_id=$1 AND id<>$2',[req.user.tenantId,req.params.id]);
      await client.query('UPDATE tenants SET custom_domain=$1 WHERE id=$2',[d.rows[0].domain,req.user.tenantId]);
      await audit(client,req.user,'DOMAIN_VERIFIED','tenant_domain',req.params.id,{domain:d.rows[0].domain,manual:true});
      await client.query('COMMIT');
      res.json({domain:d.rows[0].domain,verified:true,active:true});
    }catch(error){await client.query('ROLLBACK');next(error);}finally{client.release();}
  });

  return router;
}
