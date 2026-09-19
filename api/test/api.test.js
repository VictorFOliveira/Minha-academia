import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/server.js';
import { migrate } from '../src/migrate.js';
import { bootstrap } from '../src/bootstrap.js';
import { pool, query } from '../src/db.js';

let server;
let base;
let token;
let isolationToken;

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
