import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import app from '../src/server.js';
import { migrate } from '../src/migrate.js';
import { bootstrap } from '../src/bootstrap.js';
import { pool, query } from '../src/db.js';

let server;
let base;
let token;
let isolationToken;
let unitId;

async function request(path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: { 'content-type': 'application/json', ...(options.headers || {}) }
  });
  const body = await response.json();
  return { response, body };
}

test.before(async () => {
  process.env.SEED_DEMO = 'true';
  await migrate();
  await bootstrap();
  server = app.listen(0);
  const address = server.address();
  base = `http://127.0.0.1:${address.port}`;

  let login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ tenant: 'demo', email: 'admin@minhaacademia.local', password: 'Academia@123' })
  });
  assert.equal(login.response.status, 200);
  token = login.body.token;
  unitId = login.body.user.unitId;

  login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ tenant: 'isolamento', email: 'admin@isolamento.local', password: 'Isolation@123' })
  });
  assert.equal(login.response.status, 200);
  isolationToken = login.body.token;
});

test.after(async () => {
  await new Promise(resolve => server.close(resolve));
  await pool.end();
});

test('health responde ok', async () => {
  const { response, body } = await request('/api/health');
  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
});

test('dashboard exige autenticação', async () => {
  const { response } = await request('/api/dashboard');
  assert.equal(response.status, 401);
});

test('cria aluno no tenant autenticado', async () => {
  const cpf = String(Date.now()).slice(-11).padStart(11, '7');
  const { response, body } = await request('/api/students', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ name: 'Aluno Teste CI', cpf, status: 'ACTIVE' })
  });
  assert.equal(response.status, 201);
  assert.equal(body.name, 'Aluno Teste CI');
});

test('isola alunos entre tenants', async () => {
  const demo = await request('/api/students', { headers: { authorization: `Bearer ${token}` } });
  const isolated = await request('/api/students', { headers: { authorization: `Bearer ${isolationToken}` } });
  assert.equal(demo.response.status, 200);
  assert.equal(isolated.response.status, 200);
  const demoIds = new Set(demo.body.map(x => x.id));
  assert.ok(isolated.body.every(x => !demoIds.has(x.id)));
});

test('check-in rejeita aluno sem matrícula ativa', async () => {
  const student = (await query(`SELECT id FROM students WHERE tenant_id='11111111-1111-4111-8111-111111111111' ORDER BY created_at LIMIT 1`)).rows[0];
  const { response } = await request('/api/attendance/check-in', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'Idempotency-Key': 'ci-no-enrollment' },
    body: JSON.stringify({ studentId: student.id })
  });
  assert.equal(response.status, 409);
});


test('access agent sincroniza credencial, registra acesso e deduplica reenvio', async () => {
  const suffix = Date.now().toString().slice(-8);
  const credentialValue = `RFID-CI-${suffix}`;

  const student = await request('/api/students', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Aluno Catraca CI',
      cpf: ('900' + suffix).slice(-11).padStart(11, '9'),
      status: 'ACTIVE'
    })
  });
  assert.equal(student.response.status, 201);

  const plans = await request('/api/plans', {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(plans.response.status, 200);
  assert.ok(plans.body.length > 0);

  const enrollment = await request('/api/enrollments', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      studentId: student.body.id,
      planId: plans.body[0].id,
      startsOn: new Date().toISOString().slice(0, 10)
    })
  });
  assert.equal(enrollment.response.status, 201);

  const agent = await request('/api/access/agents', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Agente Catraca CI',
      unitId,
      adapter: 'GENERIC_HTTP'
    })
  });
  assert.equal(agent.response.status, 201);
  assert.ok(agent.body.agent.id);
  assert.ok(agent.body.agentKey);

  const badAuth = await request('/api/access/agent/sync', {
    headers: {
      'X-Agent-Id': agent.body.agent.id,
      'X-Agent-Key': 'chave-incorreta'
    }
  });
  assert.equal(badAuth.response.status, 401);

  const credential = await request('/api/access/credentials', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      studentId: student.body.id,
      credentialType: 'RFID',
      credential: credentialValue,
      label: 'Pulseira CI'
    })
  });
  assert.equal(credential.response.status, 201);

  const agentHeaders = {
    'X-Agent-Id': agent.body.agent.id,
    'X-Agent-Key': agent.body.agentKey
  };
  const sync = await request('/api/access/agent/sync', { headers: agentHeaders });
  assert.equal(sync.response.status, 200);
  const syncedCredential = sync.body.credentials.find(x => x.studentId === student.body.id);
  assert.ok(syncedCredential);
  assert.equal(syncedCredential.allowed, true);
  assert.equal(
    syncedCredential.credentialHash,
    createHash('sha256').update(credentialValue).digest('hex')
  );

  const eventId = randomUUID();
  const event = {
    eventId,
    credentialHash: syncedCredential.credentialHash,
    credentialType: 'RFID',
    direction: 'ENTRY',
    decision: 'GRANTED',
    reason: 'ACTIVE',
    deviceId: 'catraca-ci-01',
    occurredAt: new Date().toISOString()
  };

  const firstSend = await request('/api/access/agent/events', {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ events: [event] })
  });
  assert.equal(firstSend.response.status, 202);
  assert.equal(firstSend.body.accepted, 1);
  assert.equal(firstSend.body.duplicates, 0);

  const retry = await request('/api/access/agent/events', {
    method: 'POST',
    headers: agentHeaders,
    body: JSON.stringify({ events: [event] })
  });
  assert.equal(retry.response.status, 202);
  assert.equal(retry.body.accepted, 0);
  assert.equal(retry.body.duplicates, 1);

  const attendance = await query(
    `SELECT count(*)::int total FROM attendance
     WHERE tenant_id='11111111-1111-4111-8111-111111111111'
       AND student_id=$1 AND metadata->>'agentId'=$2`,
    [student.body.id, agent.body.agent.id]
  );
  assert.equal(attendance.rows[0].total, 1);
});
