import http from 'node:http';

async function readBody(req, limit = 64 * 1024) {
  const chunks=[];
  let size=0;
  for await (const chunk of req) {
    size+=chunk.length;
    if(size>limit) throw new Error('Payload excede limite');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function actionFor({ action='catra', catraDirection='clockwise', door='1', secBoxId='' }) {
  const type=String(action).toLowerCase();
  if(type==='door') return {action:'door',parameters:`door=${door}`};
  if(type==='sec_box') return {action:'sec_box',parameters:`id=${secBoxId}, reason=1`};
  return {action:'catra',parameters:`allow=${['clockwise','anticlockwise','both'].includes(catraDirection)?catraDirection:'clockwise'}`};
}

function controlIdResponse(result,input,actionConfig) {
  return {
    result:{
      event:result.allow?7:6,
      user_id:Number(input.user_id||0) || 0,
      user_name:result.allow?'Acesso autorizado':'Acesso negado',
      user_image:false,
      portal_id:Number(input.portal_id||1) || 1,
      actions:result.allow?[actionFor(actionConfig)]:[],
      message:result.allow?'Acesso liberado':String(result.reason||'Acesso negado').slice(0,80)
    }
  };
}

function parseForm(text) {
  return Object.fromEntries(new URLSearchParams(text).entries());
}

function credentialFrom(path, body) {
  if(path.endsWith('/new_card.fcgi')) return {credential:body.card_value,credentialType:'RFID'};
  if(path.endsWith('/new_qrcode.fcgi')) return {credential:body.qrcode_value,credentialType:'QR'};
  if(path.endsWith('/new_uhf_tag.fcgi')) return {credential:body.uhf_tag,credentialType:'RFID'};
  if(path.endsWith('/new_user_id_and_password.fcgi')) return {credential:body.password||body.user_id,credentialType:'PIN'};
  if(path.endsWith('/new_user_identified.fcgi')) {
    if(body.qrcode_value) return {credential:body.qrcode_value,credentialType:'QR'};
    if(body.card_value) return {credential:body.card_value,credentialType:'RFID'};
    if(body.pin_value) return {credential:body.pin_value,credentialType:'PIN'};
    if(body.user_id) return {credential:`controlid-user:${body.user_id}`,credentialType:'BIOMETRIC'};
  }
  return null;
}

export function createControlIdAdapter({
  host='0.0.0.0',
  port=8790,
  basePath='/controlid',
  expectedDeviceId='',
  direction='ENTRY',
  action='catra',
  catraDirection='clockwise',
  door='1',
  secBoxId='',
  deviceId='',
  onCredential
}) {
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
    const path=url.pathname;
    if(!path.startsWith(basePath)){
      res.statusCode=404;
      return res.end();
    }

    if(req.method==='GET' && path===basePath+'/health'){
      res.setHeader('content-type','application/json');
      return res.end(JSON.stringify({status:'ok',adapter:'CONTROL_ID_ONLINE'}));
    }

    if(req.method!=='POST'){
      res.statusCode=404;
      return res.end();
    }

    if(path.endsWith('/device_is_alive.fcgi') || path.endsWith('/session_is_valid.fcgi') || path.endsWith('/new_rex_log.fcgi')){
      res.statusCode=200;
      return res.end(path.endsWith('/session_is_valid.fcgi')?'{}':'');
    }

    try{
      const raw=await readBody(req);
      const contentType=String(req.headers['content-type']||'');
      const body=contentType.includes('application/json') ? JSON.parse(raw||'{}') : parseForm(raw);
      const requestDeviceId=String(body.device_id||url.searchParams.get('device_id')||'');
      if(expectedDeviceId && requestDeviceId!==String(expectedDeviceId)){
        res.statusCode=403;
        res.setHeader('content-type','application/json');
        return res.end(JSON.stringify({result:{event:1,message:'Equipamento inválido',actions:[]}}));
      }

      const found=credentialFrom(path,body);
      if(!found?.credential){
        res.statusCode=200;
        res.setHeader('content-type','application/json');
        return res.end(JSON.stringify({result:{event:3,user_id:Number(body.user_id||0)||0,user_image:false,portal_id:Number(body.portal_id||1)||1,actions:[],message:'Identificação não suportada'}}));
      }

      const result=await onCredential({
        credential:String(found.credential),
        credentialType:found.credentialType,
        direction:direction==='EXIT'?'EXIT':'ENTRY',
        deviceId:String(requestDeviceId||deviceId||'').slice(0,120),
        metadata:{
          vendor:'CONTROL_ID',
          endpoint:path.slice(basePath.length),
          portalId:body.portal_id||null,
          identifierId:body.identifier_id||null,
          uuid:body.uuid||null,
          controlIdUserId:body.user_id||null
        }
      });

      res.statusCode=200;
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify(controlIdResponse(result,body,{action,catraDirection,door,secBoxId})));
    }catch(error){
      res.statusCode=400;
      res.setHeader('content-type','application/json');
      res.end(JSON.stringify({result:{event:2,message:String(error.message||'Requisição inválida').slice(0,80),actions:[]}}));
    }
  });

  return {
    name:'CONTROL_ID_ONLINE',
    start(){return new Promise(resolve=>server.listen(Number(port),host,resolve));},
    stop(){return new Promise(resolve=>server.close(resolve));},
    address(){return server.address();}
  };
}
