import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import bcrypt from 'bcryptjs';

process.env.NODE_ENV='test';
process.env.SEED_DEMO='true';
process.env.RATE_LIMIT_API='20000';
process.env.RATE_LIMIT_LOGIN='5000';
process.env.RATE_LIMIT_SECURITY='5000';
process.env.DB_POOL_MAX='60';
process.env.ENABLE_JOBS='false';
process.env.INTEGRATION_ENCRYPTION_KEY='destructive-ci-integration-encryption-key-with-more-than-32-characters';
process.env.PLATFORM_ADMIN_EMAIL='platform@minhaacademia.local';
process.env.PLATFORM_ADMIN_PASSWORD='Platform@123';
process.env.PLATFORM_ADMIN_NAME='Platform Destructive';
process.env.PLATFORM_JWT_SECRET='destructive-platform-secret-with-more-than-32-characters';
process.env.APP_PUBLIC_URL='https://destructive.example.test';
process.env.PLATFORM_ASAAS_WEBHOOK_TOKEN='destructive-platform-webhook-token-with-more-than-32-characters';
process.env.METRICS_TOKEN='destructive-metrics-token-with-more-than-24-characters';

const [{default:app},{migrate},{bootstrap},{pool,query}] = await Promise.all([
  import('../src/server.js'),
  import('../src/migrate.js'),
  import('../src/bootstrap.js'),
  import('../src/db.js')
]);

const results=[];
let server;
let base;
let token;
let isolationToken;
let unitId;

function log(name,data={}) {
  const record={name,...data};
  results.push(record);
  console.log('[destructive]',JSON.stringify(record));
}

async function request(path,{timeoutMs=15000,...options}={}) {
  const started=performance.now();
  const response=await fetch(base+path,{
    ...options,
    headers:{'content-type':'application/json',...(options.headers||{})},
    signal:AbortSignal.timeout(timeoutMs)
  });
  const text=await response.text();
  let body={};
  try{body=text?JSON.parse(text):{};}catch{body={raw:text};}
  return {response,body,durationMs:performance.now()-started};
}

async function concurrent(count,limit,fn) {
  const values=new Array(count);
  let cursor=0;
  const workers=Array.from({length:Math.min(limit,count)},async()=>{
    while(true){
      const i=cursor++;
      if(i>=count)return;
      values[i]=await fn(i);
    }
  });
  await Promise.all(workers);
  return values;
}

function statusStats(rows){
  const map={};
  for(const row of rows) map[row.response.status]=(map[row.response.status]||0)+1;
  return map;
}

function latencyStats(rows){
  const values=rows.map(x=>x.durationMs).sort((a,b)=>a-b);
  const pct=p=>values[Math.min(values.length-1,Math.floor(values.length*p))]||0;
  return {
    count:values.length,
    avgMs:Math.round(values.reduce((a,b)=>a+b,0)/Math.max(1,values.length)),
    p50Ms:Math.round(pct(.50)),
    p95Ms:Math.round(pct(.95)),
    p99Ms:Math.round(pct(.99)),
    maxMs:Math.round(values.at(-1)||0)
  };
}

function cpfFor(n){
  return String(90000000000+n).slice(-11);
}

async function createStudent(name,cpf,auth=token){
  const r=await request('/api/students',{
    method:'POST',
    headers:{authorization:'Bearer '+auth},
    body:JSON.stringify({name,cpf,status:'ACTIVE',unitId})
  });
  if(r.response.status!==201) throw new Error('student create failed '+r.response.status+' '+JSON.stringify(r.body));
  return r.body;
}

async function enrollmentFor(studentId,planId,startsOn='2026-09-19'){
  const r=await request('/api/enrollments',{
    method:'POST',
    headers:{authorization:'Bearer '+token},
    body:JSON.stringify({studentId,planId,startsOn})
  });
  if(r.response.status!==201) throw new Error('enrollment create failed '+r.response.status+' '+JSON.stringify(r.body));
  return r.body;
}

async function scenario(name,fn){
  const started=performance.now();
  try{
    const data=await fn();
    log(name,{ok:true,durationMs:Math.round(performance.now()-started),...data});
  }catch(error){
    log(name,{ok:false,durationMs:Math.round(performance.now()-started),error:String(error.stack||error)});
    throw error;
  }
}

try{
  await migrate();
  await bootstrap();
  await query("UPDATE tenants SET saas_plan='ENTERPRISE',billing_status='ACTIVE' WHERE slug IN ('demo','isolamento')");
  server=app.listen(0);
  base='http://127.0.0.1:'+server.address().port;

  const login=await request('/api/auth/login',{
    method:'POST',
    body:JSON.stringify({tenant:'demo',email:'admin@minhaacademia.local',password:'Academia@123'})
  });
  assert.equal(login.response.status,200);
  token=login.body.token;
  unitId=login.body.user.unitId;

  const isolationLogin=await request('/api/auth/login',{
    method:'POST',
    body:JSON.stringify({tenant:'isolamento',email:'admin@isolamento.local',password:'Isolation@123'})
  });
  assert.equal(isolationLogin.response.status,200);
  isolationToken=isolationLogin.body.token;

  const plans=await request('/api/plans',{headers:{authorization:'Bearer '+token}});
  assert.equal(plans.response.status,200);
  assert.ok(plans.body.length>0);
  const planId=plans.body[0].id;

  await scenario('duplicate-cpf-storm',async()=>{
    const cpf=cpfFor(101);
    const rows=await Promise.all(Array.from({length:40},(_,i)=>request('/api/students',{
      method:'POST',
      headers:{authorization:'Bearer '+token},
      body:JSON.stringify({name:'CPF Storm '+i,cpf,status:'ACTIVE',unitId})
    })));
    const statuses=statusStats(rows);
    assert.equal(statuses[201],1);
    assert.equal(statuses[409],39);
    assert.equal(Object.keys(statuses).some(x=>Number(x)>=500),false);
    return {statuses};
  });

  await scenario('bulk-student-creation',async()=>{
    const rows=await concurrent(160,24,i=>request('/api/students',{
      method:'POST',
      headers:{authorization:'Bearer '+token},
      body:JSON.stringify({name:'Carga Aluno '+i,cpf:cpfFor(1000+i),status:'ACTIVE',unitId})
    }));
    const statuses=statusStats(rows);
    assert.equal(statuses[201],160);
    assert.equal(Object.keys(statuses).some(x=>Number(x)>=500),false);
    return {statuses,latency:latencyStats(rows)};
  });

  await scenario('tenant-id-tampering',async()=>{
    const demoStudent=await createStudent('Tenant Guard Demo',cpfFor(2001));
    const isoStudents=await request('/api/students',{headers:{authorization:'Bearer '+isolationToken}});
    assert.equal(isoStudents.response.status,200);
    assert.ok(!isoStudents.body.some(x=>x.id===demoStudent.id));

    const crossCharge=await request('/api/charges',{
      method:'POST',
      headers:{authorization:'Bearer '+isolationToken},
      body:JSON.stringify({studentId:demoStudent.id,description:'cross tenant',dueDate:'2026-10-10',amountCents:1000})
    });
    assert.equal(crossCharge.response.status,404);

    const crossEnrollment=await request('/api/enrollments',{
      method:'POST',
      headers:{authorization:'Bearer '+isolationToken},
      body:JSON.stringify({studentId:demoStudent.id,planId,startsOn:'2026-09-19'})
    });
    assert.equal(crossEnrollment.response.status,404);
    return {charge:crossCharge.response.status,enrollment:crossEnrollment.response.status};
  });

  await scenario('concurrent-idempotent-checkin',async()=>{
    const student=await createStudent('Idempotency Storm',cpfFor(3001));
    await enrollmentFor(student.id,planId);
    const before=(await query("SELECT count(*)::int total FROM attendance WHERE tenant_id=$1 AND student_id=$2",['11111111-1111-4111-8111-111111111111',student.id])).rows[0].total;
    const key='destructive-checkin-'+randomUUID();
    const rows=await Promise.all(Array.from({length:50},()=>request('/api/attendance/check-in',{
      method:'POST',
      headers:{authorization:'Bearer '+token,'Idempotency-Key':key},
      body:JSON.stringify({studentId:student.id,unitId})
    })));
    const statuses=statusStats(rows);
    assert.equal(Object.keys(statuses).some(x=>Number(x)>=500),false);
    assert.equal((statuses[201]||0)+(statuses[200]||0),50);
    const after=(await query("SELECT count(*)::int total FROM attendance WHERE tenant_id=$1 AND student_id=$2",['11111111-1111-4111-8111-111111111111',student.id])).rows[0].total;
    assert.equal(after-before,1);
    return {statuses,attendanceDelta:after-before,latency:latencyStats(rows)};
  });

  await scenario('access-event-replay-storm',async()=>{
    const student=await createStudent('Access Replay',cpfFor(4001));
    await enrollmentFor(student.id,planId);
    const agent=await request('/api/access/agents',{
      method:'POST',
      headers:{authorization:'Bearer '+token},
      body:JSON.stringify({name:'Destructive Agent',unitId,adapter:'GENERIC_HTTP'})
    });
    assert.equal(agent.response.status,201);
    const credentialValue='RFID-DESTRUCTIVE-'+randomUUID();
    const credential=await request('/api/access/credentials',{
      method:'POST',
      headers:{authorization:'Bearer '+token},
      body:JSON.stringify({studentId:student.id,credentialType:'RFID',credential:credentialValue})
    });
    assert.equal(credential.response.status,201);
    const headers={'X-Agent-Id':agent.body.agent.id,'X-Agent-Key':agent.body.agentKey};
    const event={
      eventId:randomUUID(),
      credentialHash:createHash('sha256').update(credentialValue).digest('hex'),
      credentialType:'RFID',
      direction:'ENTRY',
      decision:'GRANTED',
      reason:'ACTIVE',
      deviceId:'destructive-device',
      occurredAt:new Date().toISOString()
    };
    const rows=await Promise.all(Array.from({length:30},()=>request('/api/access/agent/events',{
      method:'POST',headers,body:JSON.stringify({events:[event]})
    })));
    const statuses=statusStats(rows);
    assert.equal(statuses[202],30);
    const accepted=rows.reduce((n,x)=>n+Number(x.body.accepted||0),0);
    const duplicates=rows.reduce((n,x)=>n+Number(x.body.duplicates||0),0);
    assert.equal(accepted,1);
    assert.equal(duplicates,29);
    const attendance=(await query("SELECT count(*)::int total FROM attendance WHERE tenant_id=$1 AND student_id=$2 AND metadata->>'agentId'=$3",[
      '11111111-1111-4111-8111-111111111111',student.id,agent.body.agent.id
    ])).rows[0].total;
    assert.equal(attendance,1);
    return {statuses,accepted,duplicates,attendance};
  });

  await scenario('concurrent-workout-versioning',async()=>{
    const student=await createStudent('Workout Race',cpfFor(5001));
    const equipment=await request('/api/training/equipment',{
      method:'POST',headers:{authorization:'Bearer '+token},
      body:JSON.stringify({name:'Race Equipment '+randomUUID(),unitId,category:'Teste'})
    });
    assert.equal(equipment.response.status,201);
    const exercise=await request('/api/training/exercises',{
      method:'POST',headers:{authorization:'Bearer '+token},
      body:JSON.stringify({name:'Race Exercise '+randomUUID(),equipmentId:equipment.body.id,muscleGroup:'Teste',instructions:'Teste concorrente'})
    });
    assert.equal(exercise.response.status,201);
    const workout=await request('/api/training/workouts',{
      method:'POST',headers:{authorization:'Bearer '+token},
      body:JSON.stringify({
        studentId:student.id,title:'Race Workout',goal:'Stress',estimatedMinutes:30,endsOn:'2027-12-31',
        items:[{exerciseId:exercise.body.id,workoutLabel:'A',sets:3,reps:'10',restSeconds:60}]
      })
    });
    assert.equal(workout.response.status,201);
    const rows=await Promise.all(Array.from({length:20},(_,i)=>request('/api/training/workouts/'+workout.body.plan.id+'/versions',{
      method:'POST',headers:{authorization:'Bearer '+token},
      body:JSON.stringify({
        goal:'Race '+i,estimatedMinutes:30+i,endsOn:'2027-12-31',changeReason:'Concurrent '+i,
        items:[{exerciseId:exercise.body.id,workoutLabel:'A',sets:3+(i%3),reps:'8-12',restSeconds:60}]
      })
    })));
    const statuses=statusStats(rows);
    assert.equal(statuses[201],20);
    assert.equal(Object.keys(statuses).some(x=>Number(x)>=500),false);
    const history=await request('/api/training/workouts/'+workout.body.plan.id+'/history',{headers:{authorization:'Bearer '+token}});
    assert.equal(history.response.status,200);
    assert.equal(history.body.versions.length,21);
    const versions=new Set(history.body.versions.map(x=>x.version_number));
    assert.equal(versions.size,21);
    return {statuses,versions:history.body.versions.length,latency:latencyStats(rows)};
  });

  await scenario('concurrent-active-enrollment',async()=>{
    const student=await createStudent('Enrollment Race',cpfFor(5501));
    const rows=await Promise.all(Array.from({length:20},()=>request('/api/enrollments',{
      method:'POST',
      headers:{authorization:'Bearer '+token},
      body:JSON.stringify({studentId:student.id,planId,startsOn:'2026-09-19'})
    })));
    const statuses=statusStats(rows);
    assert.equal(statuses[201],1);
    assert.equal(statuses[409],19);
    assert.equal(rows.some(x=>x.response.status>=500),false);
    const active=(await query("SELECT count(*)::int total FROM enrollments WHERE tenant_id=$1 AND student_id=$2 AND status IN ('ACTIVE','PAUSED')",[
      '11111111-1111-4111-8111-111111111111',student.id
    ])).rows[0].total;
    assert.equal(active,1);
    return {statuses,activeEnrollments:active,latency:latencyStats(rows)};
  });

  await scenario('concurrent-payment-overpay-guard',async()=>{
    const student=await createStudent('Payment Race',cpfFor(5601));
    const charge=await request('/api/charges',{
      method:'POST',
      headers:{authorization:'Bearer '+token},
      body:JSON.stringify({studentId:student.id,description:'Payment Race',dueDate:'2026-10-10',amountCents:10000})
    });
    assert.equal(charge.response.status,201);
    const rows=await Promise.all(Array.from({length:20},()=>request('/api/charges/'+charge.body.id+'/pay',{
      method:'POST',
      headers:{authorization:'Bearer '+token},
      body:JSON.stringify({amountCents:1000,method:'PIX'})
    })));
    const statuses=statusStats(rows);
    assert.equal(statuses[201],10);
    assert.equal(statuses[409],10);
    assert.equal(rows.some(x=>x.response.status>=500),false);
    const state=(await query('SELECT amount_cents,paid_cents,status FROM charges WHERE id=$1',[charge.body.id])).rows[0];
    assert.equal(state.paid_cents,10000);
    assert.equal(state.status,'PAID');
    const paid=(await query('SELECT coalesce(sum(amount_cents),0)::int total,count(*)::int count FROM payments WHERE charge_id=$1',[charge.body.id])).rows[0];
    assert.equal(paid.total,10000);
    assert.equal(paid.count,10);
    return {statuses,paidCents:state.paid_cents,payments:paid.count,latency:latencyStats(rows)};
  });

  await scenario('concurrent-recurring-billing',async()=>{
    const student=await createStudent('Billing Race',cpfFor(6001));
    const enrollment=await enrollmentFor(student.id,planId,'2026-09-19');
    const rows=await Promise.all(Array.from({length:16},()=>request('/api/members/billing/generate-recurring',{
      method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify({asOf:'2026-09-19'})
    })));
    assert.equal(statusStats(rows)[200],16);
    const charges=await query("SELECT count(*)::int total FROM charges WHERE tenant_id=$1 AND enrollment_id=$2 AND cycle_key='2026-09-19'",[
      '11111111-1111-4111-8111-111111111111',enrollment.id
    ]);
    assert.equal(charges.rows[0].total,1);
    return {statuses:statusStats(rows),chargeCount:charges.rows[0].total,latency:latencyStats(rows)};
  });

  await scenario('active-session-suspension',async()=>{
    const platform=await request('/api/platform/auth/login',{
      method:'POST',body:JSON.stringify({email:'platform@minhaacademia.local',password:'Platform@123'})
    });
    assert.equal(platform.response.status,200);
    const demo=(await query("SELECT id,saas_plan FROM tenants WHERE slug='demo'")).rows[0];
    const suspend=await request('/api/platform/tenants/'+demo.id+'/subscription',{
      method:'POST',headers:{authorization:'Bearer '+platform.body.token},
      body:JSON.stringify({plan:demo.saas_plan,status:'SUSPENDED'})
    });
    assert.equal(suspend.response.status,200);
    const blocked=await request('/api/me',{headers:{authorization:'Bearer '+token}});
    assert.equal(blocked.response.status,402);
    const restore=await request('/api/platform/tenants/'+demo.id+'/subscription',{
      method:'POST',headers:{authorization:'Bearer '+platform.body.token},
      body:JSON.stringify({plan:demo.saas_plan,status:'ACTIVE'})
    });
    assert.equal(restore.response.status,200);
    const restored=await request('/api/me',{headers:{authorization:'Bearer '+token}});
    assert.equal(restored.response.status,200);
    return {blocked:blocked.response.status,restored:restored.response.status};
  });

  await scenario('role-boundaries-finance',async()=>{
    const suffix=Date.now().toString().slice(-8);
    const financeEmail='finance-boundary-'+suffix+'@example.com';
    const financeHash=await bcrypt.hash('Finance@12345',12);
    const finance=await query(`INSERT INTO users(tenant_id,unit_id,name,email,password_hash,role)
      VALUES('11111111-1111-4111-8111-111111111111',$1,'Finance Boundary',$2,$3,'FINANCE')
      RETURNING id`,[unitId,financeEmail,financeHash]);
    await query(`INSERT INTO user_units(tenant_id,user_id,unit_id,is_primary)
      VALUES('11111111-1111-4111-8111-111111111111',$1,$2,true)
      ON CONFLICT DO NOTHING`,[finance.rows[0].id,unitId]);

    const financeLogin=await request('/api/auth/login',{
      method:'POST',
      body:JSON.stringify({tenant:'demo',email:financeEmail,password:'Finance@12345'})
    });
    assert.equal(financeLogin.response.status,200);
    const financeToken=financeLogin.body.token;

    const deniedChecks=[];
    deniedChecks.push(await request('/api/units',{
      method:'POST',headers:{authorization:'Bearer '+financeToken},body:JSON.stringify({name:'Boundary Unit'})
    }));
    deniedChecks.push(await request('/api/students',{
      method:'POST',headers:{authorization:'Bearer '+financeToken},
      body:JSON.stringify({name:'Boundary Student',cpf:cpfFor(7001),status:'ACTIVE',unitId})
    }));
    deniedChecks.push(await request('/api/training/coaches',{
      method:'POST',headers:{authorization:'Bearer '+financeToken},
      body:JSON.stringify({name:'Boundary Coach',email:'boundary-coach-'+suffix+'@example.com',password:'Coach@12345',unitId})
    }));
    deniedChecks.push(await request('/api/access/agents',{
      method:'POST',headers:{authorization:'Bearer '+financeToken},
      body:JSON.stringify({name:'Boundary Agent',unitId,adapter:'GENERIC_HTTP'})
    }));
    assert.ok(deniedChecks.every(x=>x.response.status===403));

    const platformDenied=await request('/api/platform/tenants',{headers:{authorization:'Bearer '+financeToken}});
    assert.equal(platformDenied.response.status,401);
    const reportAllowed=await request('/api/reports/summary',{headers:{authorization:'Bearer '+financeToken}});
    assert.equal(reportAllowed.response.status,200);
    return {denied:deniedChecks.map(x=>x.response.status),platform:platformDenied.response.status,report:reportAllowed.response.status};
  });

  await scenario('mixed-read-load-1200',async()=>{
    const endpoints=['/api/health','/api/dashboard','/api/students','/api/plans','/api/classes','/api/charges','/api/reports/summary'];
    const rows=await concurrent(1200,60,i=>{
      const path=endpoints[i%endpoints.length];
      return request(path,{headers:path==='/api/health'?{}:{authorization:'Bearer '+token},timeoutMs:20000});
    });
    const statuses=statusStats(rows);
    const failures=rows.filter(x=>x.response.status>=500);
    assert.equal(failures.length,0);
    assert.equal(rows.filter(x=>x.response.status===200).length,1200);
    return {statuses,latency:latencyStats(rows)};
  });

  await scenario('malformed-payload-fuzz',async()=>{
    const payloads=[
      ['/api/students',{name:'',cpf:'x'.repeat(500),status:'INVALID'}],
      ['/api/charges',{studentId:'not-a-uuid',description:'x'.repeat(2000),dueDate:'nope',amountCents:-1}],
      ['/api/enrollments',{studentId:'not-a-uuid',planId:'not-a-uuid',startsOn:'9999-99-99'}],
      ['/api/training/equipment',{name:'x',unitId:'not-a-uuid'}],
      ['/api/settings/branding',{tradeName:'x',primaryColor:'javascript:bad',accentColor:'#GGGGGG',logoUrl:'file:///etc/passwd'}]
    ];
    const rows=await concurrent(200,30,i=>{
      const [path,body]=payloads[i%payloads.length];
      return request(path,{method:'POST',headers:{authorization:'Bearer '+token},body:JSON.stringify(body)});
    });
    const statuses=statusStats(rows);
    assert.equal(rows.some(x=>x.response.status>=500),false);
    return {statuses};
  });

  const failed=results.filter(x=>x.ok===false);
  console.log('\n=== DESTRUCTIVE REGRESSION SUMMARY ===');
  console.log(JSON.stringify({scenarios:results.length,failed:failed.length,results},null,2));
  if(failed.length) process.exitCode=1;
}catch(error){
  console.error('DESTRUCTIVE REGRESSION FAILED',error);
  process.exitCode=1;
}finally{
  if(server) await new Promise(resolve=>server.close(resolve));
  await pool.end();
}
