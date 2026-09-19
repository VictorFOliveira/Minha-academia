import test from 'node:test';
import assert from 'node:assert/strict';
import { createControlIdAdapter } from '../src/adapters/controlId.js';

async function post(port,path,body){
  const response=await fetch(`http://127.0.0.1:${port}${path}`,{
    method:'POST',
    headers:{'content-type':'application/x-www-form-urlencoded'},
    body:new URLSearchParams(body)
  });
  const json=await response.json().catch(()=>({}));
  return {response,json};
}

test('Control iD online libera cartão autorizado com ação de catraca', async()=>{
  let received=null;
  const adapter=createControlIdAdapter({
    host:'127.0.0.1',
    port:0,
    expectedDeviceId:'123',
    action:'catra',
    catraDirection:'clockwise',
    onCredential:async input=>{
      received=input;
      return {allow:true,decision:'GRANTED',reason:'ACTIVE'};
    }
  });
  await adapter.start();
  try{
    const port=adapter.address().port;
    const {response,json}=await post(port,'/controlid/new_card.fcgi',{
      device_id:'123',
      card_value:'998877',
      portal_id:'1',
      uuid:'ci-card'
    });
    assert.equal(response.status,200);
    assert.equal(received.credential,'998877');
    assert.equal(received.credentialType,'RFID');
    assert.equal(received.metadata.vendor,'CONTROL_ID');
    assert.equal(json.result.event,7);
    assert.equal(json.result.actions[0].action,'catra');
    assert.equal(json.result.actions[0].parameters,'allow=clockwise');
  }finally{
    await adapter.stop();
  }
});

test('Control iD online nega credencial bloqueada sem ação física', async()=>{
  const adapter=createControlIdAdapter({
    host:'127.0.0.1',
    port:0,
    onCredential:async()=>({allow:false,decision:'DENIED',reason:'OVERDUE'})
  });
  await adapter.start();
  try{
    const port=adapter.address().port;
    const {response,json}=await post(port,'/controlid/new_qrcode.fcgi',{
      qrcode_value:'QR-CI',
      portal_id:'1'
    });
    assert.equal(response.status,200);
    assert.equal(json.result.event,6);
    assert.equal(json.result.message,'OVERDUE');
    assert.deepEqual(json.result.actions,[]);
  }finally{
    await adapter.stop();
  }
});

test('Control iD rejeita device id diferente do homologado', async()=>{
  const adapter=createControlIdAdapter({
    host:'127.0.0.1',
    port:0,
    expectedDeviceId:'123',
    onCredential:async()=>({allow:true,decision:'GRANTED',reason:'ACTIVE'})
  });
  await adapter.start();
  try{
    const port=adapter.address().port;
    const {response,json}=await post(port,'/controlid/new_card.fcgi',{
      device_id:'999',
      card_value:'112233'
    });
    assert.equal(response.status,403);
    assert.equal(json.result.event,1);
  }finally{
    await adapter.stop();
  }
});
