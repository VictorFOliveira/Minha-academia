import crypto from 'node:crypto';
import { Router } from 'express';

const PRODUCT_CODE='MINHA_ACADEMIA';
const PRODUCT_NAME='Minha Academia';

const hash=value=>crypto.createHash('sha256').update(String(value)).digest('hex');
const safeEqual=(a,b)=>{
  const x=Buffer.from(String(a||'')),y=Buffer.from(String(b||''));
  return x.length>0&&x.length===y.length&&crypto.timingSafeEqual(x,y);
};
const environment=()=>String(process.env.CACTUS_SAAS_ENV||process.env.APP_ENV||'local').trim().toLowerCase();

export function buildCactusPairingRouter({query}){
  const router=Router();

  router.get('/discovery',async(_req,res,next)=>{
    try{
      const paired=await query('SELECT active FROM platform_control_plane_credentials WHERE id=1 LIMIT 1');
      res.setHeader('Cache-Control','no-store');
      res.json({ok:true,service:'cactus-saas',productCode:PRODUCT_CODE,productName:PRODUCT_NAME,environment:environment(),adminApiPath:'/api/platform',apiVersion:1,paired:Boolean(paired.rows[0]?.active)});
    }catch(error){next(error);}
  });

  router.post('/pair',async(req,res,next)=>{
    try{
      const expected=String(process.env.CACTUS_PAIRING_KEY||'');
      const supplied=String(req.get('x-cactus-pairing-key')||'');
      if(expected.length<32||!safeEqual(supplied,expected))return res.status(404).end();

      const current=environment();
      const body=req.body||{};
      if(body.controlPlane!=='cactus-superadmin'||String(body.expectedProductCode||'').toUpperCase()!==PRODUCT_CODE)
        return res.status(400).json({error:'pairing_identity_invalid'});
      if(String(body.expectedEnvironment||'').toLowerCase()!==current)
        return res.status(409).json({error:'environment_mismatch',environment:current});
      const platformKey=String(body.platformKey||'');
      if(platformKey.length<32)return res.status(400).json({error:'platform_key_invalid'});

      const existing=await query('SELECT active FROM platform_control_plane_credentials WHERE id=1 LIMIT 1');
      const rotate=Boolean(body.rotate);
      if(existing.rowCount&&existing.rows[0].active&&!rotate)return res.status(409).json({error:'already_paired'});

      await query(`INSERT INTO platform_control_plane_credentials(id,key_hash,active,paired_at,rotated_at)
        VALUES(1,$1,true,now(),CASE WHEN $2 THEN now() ELSE NULL END)
        ON CONFLICT(id) DO UPDATE SET key_hash=excluded.key_hash,active=true,
          paired_at=CASE WHEN platform_control_plane_credentials.active THEN platform_control_plane_credentials.paired_at ELSE now() END,
          rotated_at=CASE WHEN $2 THEN now() ELSE platform_control_plane_credentials.rotated_at END`,
        [hash(platformKey),rotate]);

      res.setHeader('Cache-Control','no-store');
      res.status(existing.rowCount?200:201).json({ok:true,service:'cactus-saas',productCode:PRODUCT_CODE,productName:PRODUCT_NAME,environment:current,apiVersion:1});
    }catch(error){next(error);}
  });

  router.get('/info',async(req,res,next)=>{
    try{
      const supplied=String(req.get('x-platform-key')||'');
      if(!supplied)return res.status(401).json({error:'platform_unauthorized'});
      const current=await query('SELECT key_hash FROM platform_control_plane_credentials WHERE id=1 AND active=true LIMIT 1');
      if(!current.rowCount||!safeEqual(hash(supplied),current.rows[0].key_hash))
        return res.status(401).json({error:'platform_unauthorized'});
      res.setHeader('Cache-Control','no-store');
      res.json({ok:true,service:'cactus-saas',productCode:PRODUCT_CODE,productName:PRODUCT_NAME,environment:environment(),apiVersion:1});
    }catch(error){next(error);}
  });

  return router;
}
