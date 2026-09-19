import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import bcrypt from 'bcryptjs';
import { totpCode } from '../src/authSecurity.js';
import app from '../src/server.js';
import { migrate } from '../src/migrate.js';
import { bootstrap } from '../src/bootstrap.js';
import { pool, query } from '../src/db.js';
import { runOperationalJobs } from '../src/jobs.js';
import { validateRuntimeConfig } from '../src/server.js';

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
  process.env.NODE_ENV = 'test';
  process.env.SEED_DEMO = 'true';
  process.env.PLATFORM_ADMIN_EMAIL = 'platform@minhaacademia.local';
  process.env.PLATFORM_ADMIN_PASSWORD = 'Platform@123';
  process.env.PLATFORM_ADMIN_NAME = 'Platform CI';
  process.env.INTEGRATION_ENCRYPTION_KEY = 'ci-integration-encryption-key-with-more-than-32-characters';
  process.env.APP_PUBLIC_URL = 'https://app.example.test';
  process.env.PASSWORD_RESET_MINUTES = '30';
  process.env.METRICS_TOKEN = 'ci-metrics-token-with-more-than-24-characters';
  process.env.PLATFORM_ASAAS_WEBHOOK_TOKEN = 'ci-platform-webhook-token-with-more-than-32-characters';
  process.env.RATE_LIMIT_SECURITY = '1000';
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
      planId: plans.body[0].id
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


test('professor acessa portal e cria treino versionado com histórico', async () => {
  const suffix = Date.now().toString().slice(-8);
  const coachEmail = `coach-${suffix}@minhaacademia.local`;
  const coachPassword = 'Coach@12345';

  const coach = await request('/api/training/coaches', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Professor CI',
      email: coachEmail,
      password: coachPassword,
      unitId,
      phone: '85999999999',
      specialties: ['Musculação', 'Funcional']
    })
  });
  assert.equal(coach.response.status, 201);
  assert.equal(coach.body.role, 'COACH');

  const coachLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ tenant: 'demo', email: coachEmail, password: coachPassword })
  });
  assert.equal(coachLogin.response.status, 200);
  assert.equal(coachLogin.body.user.role, 'COACH');
  const coachToken = coachLogin.body.token;

  const deniedEquipment = await request('/api/training/equipment', {
    method: 'POST',
    headers: { authorization: `Bearer ${coachToken}` },
    body: JSON.stringify({ name: `Equipamento indevido ${suffix}` })
  });
  assert.equal(deniedEquipment.response.status, 403);

  const equipment = await request('/api/training/equipment', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: `Leg Press CI ${suffix}`,
      unitId,
      category: 'Pernas',
      manufacturer: 'Teste',
      model: '45 graus',
      location: 'Salão principal',
      instructions: 'Ajustar banco e amplitude antes do uso.'
    })
  });
  assert.equal(equipment.response.status, 201);

  const isolatedExercise = await request('/api/training/exercises', {
    method: 'POST',
    headers: { authorization: `Bearer ${isolationToken}` },
    body: JSON.stringify({
      name: `Exercício isolado ${suffix}`,
      equipmentId: equipment.body.id,
      muscleGroup: 'Quadríceps',
      instructions: 'Não deve aceitar equipamento de outro tenant.'
    })
  });
  assert.equal(isolatedExercise.response.status, 404);

  const exercise = await request('/api/training/exercises', {
    method: 'POST',
    headers: { authorization: `Bearer ${coachToken}` },
    body: JSON.stringify({
      name: `Leg Press 45 CI ${suffix}`,
      equipmentId: equipment.body.id,
      muscleGroup: 'Quadríceps',
      instructions: 'Pés alinhados, controlar a descida e não travar os joelhos.'
    })
  });
  assert.equal(exercise.response.status, 201);

  const student = await request('/api/students', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Aluno Treino CI',
      cpf: ('812' + suffix).slice(-11).padStart(11, '8'),
      status: 'ACTIVE'
    })
  });
  assert.equal(student.response.status, 201);

  const workout = await request('/api/training/workouts', {
    method: 'POST',
    headers: { authorization: `Bearer ${coachToken}` },
    body: JSON.stringify({
      studentId: student.body.id,
      title: 'Hipertrofia inicial',
      goal: 'Adaptação e hipertrofia',
      estimatedMinutes: 50,
      endsOn: '2026-12-31',
      notes: 'Reavaliar cargas semanalmente.',
      items: [{
        exerciseId: exercise.body.id,
        workoutLabel: 'A',
        sets: 4,
        reps: '10-12',
        load: 'Moderada',
        restSeconds: 90,
        tempo: '2-1-2',
        notes: 'Parar antes de perder a técnica.'
      }]
    })
  });
  assert.equal(workout.response.status, 201);
  assert.equal(workout.body.version.version_number, 1);

  const dashboard = await request('/api/training/coach/dashboard', {
    headers: { authorization: `Bearer ${coachToken}` }
  });
  assert.equal(dashboard.response.status, 200);
  assert.ok(dashboard.body.assignedStudents >= 1);
  assert.ok(dashboard.body.activeWorkouts >= 1);

  const version2 = await request(`/api/training/workouts/${workout.body.plan.id}/versions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${coachToken}` },
    body: JSON.stringify({
      goal: 'Progressão de carga',
      estimatedMinutes: 55,
      endsOn: '2027-01-31',
      changeReason: 'Aluno adaptado ao treino inicial',
      items: [{
        exerciseId: exercise.body.id,
        workoutLabel: 'A',
        sets: 5,
        reps: '8-10',
        load: 'Progressiva',
        restSeconds: 120
      }]
    })
  });
  assert.equal(version2.response.status, 201);
  assert.equal(version2.body.version_number, 2);

  const history = await request(`/api/training/workouts/${workout.body.plan.id}/history`, {
    headers: { authorization: `Bearer ${coachToken}` }
  });
  assert.equal(history.response.status, 200);
  assert.equal(history.body.versions.length, 2);
  assert.equal(history.body.versions[0].version_number, 2);
  assert.equal(history.body.versions[1].version_number, 1);
  assert.equal(history.body.versions[1].estimated_minutes, 50);
  assert.equal(history.body.versions[1].items[0].sets, 4);
  assert.equal(history.body.versions[0].prescribed_by_name, 'Professor CI');

  const list = await request('/api/training/workouts', {
    headers: { authorization: `Bearer ${coachToken}` }
  });
  assert.equal(list.response.status, 200);
  const current = list.body.find(row => row.id === workout.body.plan.id);
  assert.ok(current);
  assert.equal(current.current_version, 2);
  assert.equal(current.estimated_minutes, 55);

  const studentsWithWorkout = await request('/api/students', {
    headers: { authorization: `Bearer ${coachToken}` }
  });
  assert.equal(studentsWithWorkout.response.status, 200);
  const studentSummary = studentsWithWorkout.body.find(row => row.id === student.body.id);
  assert.ok(studentSummary);
  assert.equal(studentSummary.workout_title, 'Hipertrofia inicial');
  assert.equal(studentSummary.workout_professor, 'Professor CI');
  assert.equal(studentSummary.workout_minutes, 55);

  const coachedClass = await request('/api/classes', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: `Funcional CI ${suffix}`,
      modality: 'Funcional',
      unitId,
      coachUserId: coach.body.id,
      capacity: 20,
      weekday: 1,
      startsAt: '18:00',
      endsAt: '19:00'
    })
  });
  assert.equal(coachedClass.response.status, 201);

  const coachClasses = await request('/api/classes', {
    headers: { authorization: `Bearer ${coachToken}` }
  });
  assert.equal(coachClasses.response.status, 200);
  const linkedClass = coachClasses.body.find(row => row.id === coachedClass.body.id);
  assert.ok(linkedClass);
  assert.equal(linkedClass.coach_name, 'Professor CI');
});


test('multi-unidade respeita escopo do plano na catraca e unidades do professor', async () => {
  const suffix = Date.now().toString().slice(-8);

  const unit2 = await request('/api/units', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: `Jardim Iracema CI ${suffix}`,
      address: { neighborhood: 'Jardim Iracema', city: 'Fortaleza', state: 'CE' }
    })
  });
  assert.equal(unit2.response.status, 201);

  const localPlan = await request('/api/plans', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: `Plano Local CI ${suffix}`,
      priceCents: 9990,
      billingInterval: 'MONTHLY',
      accessScope: 'PRIMARY_UNIT'
    })
  });
  assert.equal(localPlan.response.status, 201);

  const networkPlan = await request('/api/plans', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: `Plano Rede CI ${suffix}`,
      priceCents: 15990,
      billingInterval: 'MONTHLY',
      accessScope: 'ALL_UNITS'
    })
  });
  assert.equal(networkPlan.response.status, 201);

  const localStudent = await request('/api/students', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Aluno Local Guanabara',
      cpf: ('721' + suffix).slice(-11).padStart(11, '7'),
      status: 'ACTIVE',
      unitId
    })
  });
  assert.equal(localStudent.response.status, 201);

  const networkStudent = await request('/api/students', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Aluno Rede Guanabara',
      cpf: ('731' + suffix).slice(-11).padStart(11, '7'),
      status: 'ACTIVE',
      unitId
    })
  });
  assert.equal(networkStudent.response.status, 201);

  for (const [studentId, planId] of [
    [localStudent.body.id, localPlan.body.id],
    [networkStudent.body.id, networkPlan.body.id]
  ]) {
    const enrollment = await request('/api/enrollments', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ studentId, planId })
    });
    assert.equal(enrollment.response.status, 201);
  }

  const localCredentialValue = `RFID-LOCAL-${suffix}`;
  const networkCredentialValue = `RFID-NET-${suffix}`;
  for (const [studentId, value] of [
    [localStudent.body.id, localCredentialValue],
    [networkStudent.body.id, networkCredentialValue]
  ]) {
    const credential = await request('/api/access/credentials', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ studentId, credentialType: 'RFID', credential: value })
    });
    assert.equal(credential.response.status, 201);
  }

  const iracemaAgent = await request('/api/access/agents', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: `Catraca Iracema CI ${suffix}`,
      unitId: unit2.body.id,
      adapter: 'GENERIC_HTTP'
    })
  });
  assert.equal(iracemaAgent.response.status, 201);

  const sync = await request('/api/access/agent/sync', {
    headers: {
      'X-Agent-Id': iracemaAgent.body.agent.id,
      'X-Agent-Key': iracemaAgent.body.agentKey
    }
  });
  assert.equal(sync.response.status, 200);

  const localSynced = sync.body.credentials.find(x => x.studentId === localStudent.body.id);
  const networkSynced = sync.body.credentials.find(x => x.studentId === networkStudent.body.id);
  assert.ok(localSynced);
  assert.ok(networkSynced);
  assert.equal(localSynced.allowed, false);
  assert.equal(localSynced.reason, 'UNIT_NOT_ALLOWED');
  assert.equal(networkSynced.allowed, true);

  const deniedManual = await request('/api/attendance/check-in', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'Idempotency-Key': `multi-local-${suffix}` },
    body: JSON.stringify({ studentId: localStudent.body.id, unitId: unit2.body.id })
  });
  assert.equal(deniedManual.response.status, 409);

  const allowedManual = await request('/api/attendance/check-in', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'Idempotency-Key': `multi-network-${suffix}` },
    body: JSON.stringify({ studentId: networkStudent.body.id, unitId: unit2.body.id })
  });
  assert.equal(allowedManual.response.status, 201);
  assert.equal(allowedManual.body.attendance.unit_id, unit2.body.id);

  const coachEmail = `multi-coach-${suffix}@minhaacademia.local`;
  const coach = await request('/api/training/coaches', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Professor Duas Unidades',
      email: coachEmail,
      password: 'CoachMulti@123',
      unitId,
      unitIds: [unitId, unit2.body.id],
      specialties: ['Musculação']
    })
  });
  assert.equal(coach.response.status, 201);

  const coachLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ tenant: 'demo', email: coachEmail, password: 'CoachMulti@123' })
  });
  assert.equal(coachLogin.response.status, 200);

  const coachUnits = await request('/api/units', {
    headers: { authorization: `Bearer ${coachLogin.body.token}` }
  });
  assert.equal(coachUnits.response.status, 200);
  assert.ok(coachUnits.body.some(u => u.id === unitId));
  assert.ok(coachUnits.body.some(u => u.id === unit2.body.id));

  const iracemaStudents = await request(`/api/students?unitId=${unit2.body.id}`, {
    headers: { authorization: `Bearer ${coachLogin.body.token}` }
  });
  assert.equal(iracemaStudents.response.status, 200);

  const dashboardUnit2 = await request(`/api/dashboard?unitId=${unit2.body.id}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(dashboardUnit2.response.status, 200);
  assert.ok(dashboardUnit2.body.checkinsToday >= 1);
});


test('avaliação, anamnese, progresso, portal do aluno e cobrança recorrente funcionam ponta a ponta', async () => {
  const suffix = Date.now().toString().slice(-8);
  const studentEmail = `portal-${suffix}@example.com`;
  const studentPassword = 'AlunoPortal@123';

  const student = await request('/api/students', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Aluno Portal CI',
      cpf: ('641' + suffix).slice(-11).padStart(11, '6'),
      email: studentEmail,
      status: 'ACTIVE',
      unitId
    })
  });
  assert.equal(student.response.status, 201);

  const plan = await request('/api/plans', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: `Plano Portal CI ${suffix}`,
      priceCents: 12990,
      billingInterval: 'MONTHLY',
      accessScope: 'PRIMARY_UNIT'
    })
  });
  assert.equal(plan.response.status, 201);

  const enrollment = await request('/api/enrollments', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      studentId: student.body.id,
      planId: plan.body.id,
      startsOn: '2026-09-18'
    })
  });
  assert.equal(enrollment.response.status, 201);
  assert.equal(enrollment.body.status, 'ACTIVE');

  const assessment = await request(`/api/members/assessments/${student.body.id}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      weightKg: 80,
      heightCm: 175,
      bodyFatPercent: 18.2,
      muscleMassKg: 60.5,
      restingHeartRate: 62,
      bloodPressure: '120/80',
      objective: 'Hipertrofia',
      measurements: { armCm: 36, waistCm: 84 }
    })
  });
  assert.equal(assessment.response.status, 201);
  assert.equal(assessment.body.bmi, 26.12);

  const anamnesis = await request(`/api/members/anamnesis/${student.body.id}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      hasMedicalClearance: true,
      injuries: 'Nenhuma',
      chronicConditions: '',
      painOrLimitations: 'Nenhuma',
      exerciseHistory: 'Treino recreativo há 1 ano',
      smoking: false
    })
  });
  assert.equal(anamnesis.response.status, 201);

  const equipment = await request('/api/training/equipment', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: `Supino Máquina CI ${suffix}`,
      unitId,
      category: 'Peitoral'
    })
  });
  assert.equal(equipment.response.status, 201);

  const exercise = await request('/api/training/exercises', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: `Supino Máquina CI ${suffix}`,
      equipmentId: equipment.body.id,
      muscleGroup: 'Peitoral',
      instructions: 'Ajustar banco e empurrar sem perder contato com o encosto.'
    })
  });
  assert.equal(exercise.response.status, 201);

  const workout = await request('/api/training/workouts', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      studentId: student.body.id,
      title: 'Treino Portal CI',
      goal: 'Hipertrofia',
      estimatedMinutes: 45,
      endsOn: '2026-11-30',
      items: [{
        exerciseId: exercise.body.id,
        workoutLabel: 'A',
        sets: 4,
        reps: '10',
        load: '40 kg',
        restSeconds: 90
      }]
    })
  });
  assert.equal(workout.response.status, 201);

  const account = await request(`/api/members/student-accounts/${student.body.id}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ email: studentEmail, password: studentPassword })
  });
  assert.equal(account.response.status, 201);
  assert.equal(account.body.role, 'STUDENT');

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ tenant: 'demo', email: studentEmail, password: studentPassword })
  });
  assert.equal(login.response.status, 200);
  assert.equal(login.body.user.role, 'STUDENT');
  const studentToken = login.body.token;

  const overview = await request('/api/members/student/me/overview', {
    headers: { authorization: `Bearer ${studentToken}` }
  });
  assert.equal(overview.response.status, 200);
  assert.equal(overview.body.student.id, student.body.id);
  assert.equal(overview.body.workout.title, 'Treino Portal CI');
  assert.equal(overview.body.workout.items.length, 1);
  assert.equal(Number(overview.body.latestAssessment.weight_kg), 80);

  const session = await request('/api/members/workout-sessions', {
    method: 'POST',
    headers: { authorization: `Bearer ${studentToken}` },
    body: JSON.stringify({
      workoutPlanId: workout.body.plan.id,
      workoutVersionId: workout.body.version.id,
      durationMinutes: 48,
      perceivedEffort: 7,
      status: 'COMPLETED',
      items: [{
        exerciseId: exercise.body.id,
        performedSets: 4,
        performedReps: '10,10,10,9',
        load: '42 kg',
        perceivedEffort: 8
      }]
    })
  });
  assert.equal(session.response.status, 201);

  const sessions = await request(`/api/members/workout-sessions/${student.body.id}`, {
    headers: { authorization: `Bearer ${studentToken}` }
  });
  assert.equal(sessions.response.status, 200);
  assert.ok(sessions.body.length >= 1);
  assert.equal(sessions.body[0].items[0].load, '42 kg');

  const pause = await request(`/api/members/enrollments/${enrollment.body.id}/action`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'PAUSE', reason: 'Viagem' })
  });
  assert.equal(pause.response.status, 200);
  assert.equal(pause.body.status, 'PAUSED');

  const resume = await request(`/api/members/enrollments/${enrollment.body.id}/action`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ action: 'RESUME' })
  });
  assert.equal(resume.response.status, 200);
  assert.equal(resume.body.status, 'ACTIVE');

  const billing = await request('/api/members/billing/generate-recurring', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ asOf: '2026-09-18' })
  });
  assert.equal(billing.response.status, 200);
  assert.ok(billing.body.created >= 1);

  const billingRetry = await request('/api/members/billing/generate-recurring', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ asOf: '2026-09-18' })
  });
  assert.equal(billingRetry.response.status, 200);
  assert.equal(billingRetry.body.created, 0);

  const charges = await request('/api/charges', {
    headers: { authorization: `Bearer ${token}` }
  });
  const recurringCharge = charges.body.find(x => x.enrollment_id === enrollment.body.id && x.cycle_key === '2026-09-18');
  assert.ok(recurringCharge);
  assert.equal(recurringCharge.amount_cents, 12990);

  const communications = await request('/api/members/communications', {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(communications.response.status, 200);
  assert.ok(communications.body.some(x => x.student_id === student.body.id && x.template_key === 'CHARGE_CREATED'));

  const history = await request(`/api/members/enrollments/${enrollment.body.id}/history`, {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(history.response.status, 200);
  assert.ok(history.body.some(x => x.event_type === 'PAUSED'));
  assert.ok(history.body.some(x => x.event_type === 'RESUMED'));
});


test('superadmin cria tenant, acompanha uso e limites SaaS bloqueiam excesso', async () => {
  const suffix = Date.now().toString().slice(-8);

  const platformLogin = await request('/api/platform/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      email: 'platform@minhaacademia.local',
      password: 'Platform@123'
    })
  });
  assert.equal(platformLogin.response.status, 200);
  const platformToken = platformLogin.body.token;

  const tenant = await request('/api/platform/tenants', {
    method: 'POST',
    headers: { authorization: `Bearer ${platformToken}` },
    body: JSON.stringify({
      tradeName: `Academia Starter CI ${suffix}`,
      legalName: `Academia Starter CI ${suffix} LTDA`,
      slug: `starter-ci-${suffix}`,
      ownerName: 'Owner Starter CI',
      ownerEmail: `owner-starter-${suffix}@example.com`,
      ownerPassword: 'Owner@12345',
      unitName: 'Unidade Principal',
      saasPlan: 'STARTER'
    })
  });
  assert.equal(tenant.response.status, 201);
  assert.equal(tenant.body.tenant.saas_plan, 'STARTER');

  const ownerLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({
      tenant: tenant.body.tenant.slug,
      email: tenant.body.owner.email,
      password: 'Owner@12345'
    })
  });
  assert.equal(ownerLogin.response.status, 200);
  const ownerToken = ownerLogin.body.token;

  const secondUnit = await request('/api/units', {
    method: 'POST',
    headers: { authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ name: 'Unidade Bloqueada' })
  });
  assert.equal(secondUnit.response.status, 409);
  assert.equal(secondUnit.body.code, 'SAAS_LIMIT_REACHED');
  assert.equal(secondUnit.body.resource, 'units');

  const usage = await request(`/api/platform/tenants/${tenant.body.tenant.id}/usage`, {
    headers: { authorization: `Bearer ${platformToken}` }
  });
  assert.equal(usage.response.status, 200);
  assert.equal(usage.body.plan, 'STARTER');
  assert.equal(usage.body.usage.units, 1);
  assert.equal(usage.body.limits.units, 1);

  const upgrade = await request(`/api/platform/tenants/${tenant.body.tenant.id}/subscription`, {
    method: 'POST',
    headers: { authorization: `Bearer ${platformToken}` },
    body: JSON.stringify({ plan: 'PRO', status: 'ACTIVE', note: 'Upgrade CI' })
  });
  assert.equal(upgrade.response.status, 200);
  assert.equal(upgrade.body.plan, 'PRO');
  assert.equal(upgrade.body.status, 'ACTIVE');

  const allowedUnit = await request('/api/units', {
    method: 'POST',
    headers: { authorization: `Bearer ${ownerToken}` },
    body: JSON.stringify({ name: 'Segunda Unidade Liberada' })
  });
  assert.equal(allowedUnit.response.status, 201);

  const history = await request(`/api/platform/tenants/${tenant.body.tenant.id}/subscription/history`, {
    headers: { authorization: `Bearer ${platformToken}` }
  });
  assert.equal(history.response.status, 200);
  assert.ok(history.body.some(x => x.to_plan === 'PRO' && x.to_status === 'ACTIVE'));
});


test('webhook Asaas autenticado baixa cobrança uma única vez', async () => {
  const suffix = Date.now().toString().slice(-8);
  const student = await request('/api/students', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Aluno Asaas CI',
      cpf: ('519' + suffix).slice(-11).padStart(11, '5'),
      email: `asaas-${suffix}@example.com`,
      status: 'ACTIVE',
      unitId
    })
  });
  assert.equal(student.response.status, 201);

  const charge = await request('/api/charges', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      studentId: student.body.id,
      description: 'Mensalidade Asaas CI',
      dueDate: '2026-10-10',
      amountCents: 14990
    })
  });
  assert.equal(charge.response.status, 201);

  const config = await request('/api/integrations/asaas', {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      environment: 'SANDBOX',
      apiKey: '$aact_hmlg_ci_fake_key_12345678901234567890',
      rotateWebhookToken: true
    })
  });
  assert.equal(config.response.status, 200);
  assert.ok(config.body.webhookToken);

  const externalId = `pay_ci_${suffix}`;
  await query(`UPDATE charges SET provider='ASAAS',external_id=$1,billing_type='PIX',provider_status='PENDING'
    WHERE tenant_id='11111111-1111-4111-8111-111111111111' AND id=$2`, [externalId, charge.body.id]);

  const event = {
    id: `evt_ci_${suffix}`,
    event: 'PAYMENT_RECEIVED',
    payment: {
      id: externalId,
      value: 149.90,
      billingType: 'PIX',
      status: 'RECEIVED'
    }
  };

  const received = await request('/api/integrations/asaas/webhook/11111111-1111-4111-8111-111111111111', {
    method: 'POST',
    headers: { 'asaas-access-token': config.body.webhookToken },
    body: JSON.stringify(event)
  });
  assert.equal(received.response.status, 200);
  assert.equal(received.body.ok, true);

  const retry = await request('/api/integrations/asaas/webhook/11111111-1111-4111-8111-111111111111', {
    method: 'POST',
    headers: { 'asaas-access-token': config.body.webhookToken },
    body: JSON.stringify(event)
  });
  assert.equal(retry.response.status, 200);
  assert.equal(retry.body.duplicate, true);

  const localCharge = await query(`SELECT status,paid_cents,provider_status FROM charges
    WHERE tenant_id='11111111-1111-4111-8111-111111111111' AND id=$1`, [charge.body.id]);
  assert.equal(localCharge.rows[0].status, 'PAID');
  assert.equal(localCharge.rows[0].paid_cents, 14990);
  assert.equal(localCharge.rows[0].provider_status, 'RECEIVED');

  const payments = await query(`SELECT count(*)::int total FROM payments
    WHERE tenant_id='11111111-1111-4111-8111-111111111111' AND provider='ASAAS' AND external_id=$1`, [externalId]);
  assert.equal(payments.rows[0].total, 1);
});


test('job operacional expira matrícula vencida e preserva histórico', async () => {
  const suffix = Date.now().toString().slice(-8);
  const student = await request('/api/students', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Aluno Expiração CI',
      cpf: ('417' + suffix).slice(-11).padStart(11, '4'),
      status: 'ACTIVE',
      unitId
    })
  });
  assert.equal(student.response.status, 201);

  const plans = await request('/api/plans', {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(plans.response.status, 200);

  const enrollment = await request('/api/enrollments', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      studentId: student.body.id,
      planId: plans.body[0].id,
      startsOn: '2026-09-01',
      endsOn: '2026-09-02'
    })
  });
  assert.equal(enrollment.response.status, 201);

  const job = await runOperationalJobs({ pool, query });
  assert.ok(job.expiredEnrollments >= 1);

  const state = await query(
    'SELECT status FROM enrollments WHERE tenant_id=$1 AND id=$2',
    ['11111111-1111-4111-8111-111111111111', enrollment.body.id]
  );
  assert.equal(state.rows[0].status, 'EXPIRED');

  const event = await query(
    `SELECT from_status,to_status FROM enrollment_events
     WHERE tenant_id=$1 AND enrollment_id=$2 AND event_type='EXPIRED'
     ORDER BY created_at DESC LIMIT 1`,
    ['11111111-1111-4111-8111-111111111111', enrollment.body.id]
  );
  assert.equal(event.rows[0].from_status, 'ACTIVE');
  assert.equal(event.rows[0].to_status, 'EXPIRED');
});


test('comunicação automática enfileira lembrete e conclui canal interno', async () => {
  const suffix = Date.now().toString().slice(-8);
  const student = await request('/api/students', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      name: 'Aluno Comunicação CI',
      cpf: ('307' + suffix).slice(-11).padStart(11, '3'),
      status: 'ACTIVE',
      unitId
    })
  });
  assert.equal(student.response.status, 201);

  const charge = await request('/api/charges', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      studentId: student.body.id,
      description: 'Mensalidade lembrete CI',
      dueDate: '2026-09-20',
      amountCents: 10990
    })
  });
  assert.equal(charge.response.status, 201);

  const processed = await request('/api/integrations/communications/process', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ limit: 100 })
  });
  assert.equal(processed.response.status, 200);
  assert.ok(processed.body.sent >= 1);

  const queue = await query(`SELECT template_key,channel,status FROM communication_queue
    WHERE tenant_id='11111111-1111-4111-8111-111111111111' AND student_id=$1
    ORDER BY created_at DESC`, [student.body.id]);
  const reminder = queue.rows.find(x => x.template_key === 'CHARGE_DUE_SOON');
  assert.ok(reminder);
  assert.equal(reminder.channel, 'IN_APP');
  assert.equal(reminder.status, 'SENT');
});


test('produção recusa configuração insegura e aceita secrets independentes', () => {
  const base = {
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://user:pass@db:5432/minha_academia',
    JWT_SECRET: 'tenant-jwt-secret-with-at-least-32-characters',
    PLATFORM_JWT_SECRET: 'platform-jwt-secret-with-at-least-32-characters',
    INTEGRATION_ENCRYPTION_KEY: 'integration-encryption-key-with-at-least-32-characters',
    CORS_ORIGINS: 'https://app.minhaacademia.example',
    SEED_DEMO: 'false'
  };

  assert.equal(validateRuntimeConfig(base), true);
  assert.throws(() => validateRuntimeConfig({ ...base, SEED_DEMO: 'true' }), /SEED_DEMO/);
  assert.throws(() => validateRuntimeConfig({ ...base, PLATFORM_JWT_SECRET: base.JWT_SECRET }), /diferente/);
  assert.throws(() => validateRuntimeConfig({ ...base, CORS_ORIGINS: 'http://localhost:8080' }), /CORS_ORIGINS/);
  assert.throws(() => validateRuntimeConfig({ ...base, INTEGRATION_ENCRYPTION_KEY: 'curta' }), /INTEGRATION_ENCRYPTION_KEY/);
});


test('reset de senha usa token único e invalida sessões antigas', async () => {
  const suffix = Date.now().toString().slice(-8);
  const email = `reset-ci-${suffix}@example.com`;
  const oldPassword = 'SenhaAntiga@123';
  const newPassword = 'SenhaNova@456';
  const hash = await bcrypt.hash(oldPassword, 12);
  const created = await query(`INSERT INTO users(tenant_id,unit_id,name,email,password_hash,role)
    VALUES('11111111-1111-4111-8111-111111111111',$1,'Reset CI',$2,$3,'FINANCE')
    RETURNING id`, [unitId, email, hash]);

  const before = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ tenant: 'demo', email, password: oldPassword })
  });
  assert.equal(before.response.status, 200);
  const oldToken = before.body.token;

  const forgot = await request('/api/security/auth/forgot-password', {
    method: 'POST',
    body: JSON.stringify({ tenant: 'demo', email })
  });
  assert.equal(forgot.response.status, 202);
  assert.ok(forgot.body.debugToken);

  const reset = await request('/api/security/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: forgot.body.debugToken, password: newPassword })
  });
  assert.equal(reset.response.status, 200);

  const reused = await request('/api/security/auth/reset-password', {
    method: 'POST',
    body: JSON.stringify({ token: forgot.body.debugToken, password: 'OutraSenha@789' })
  });
  assert.equal(reused.response.status, 400);

  const oldSession = await request('/api/me', {
    headers: { authorization: `Bearer ${oldToken}` }
  });
  assert.equal(oldSession.response.status, 401);

  const oldLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ tenant: 'demo', email, password: oldPassword })
  });
  assert.equal(oldLogin.response.status, 401);

  const newLogin = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ tenant: 'demo', email, password: newPassword })
  });
  assert.equal(newLogin.response.status, 200);

  const queued = await query(`SELECT template_key,destination FROM communication_queue
    WHERE tenant_id='11111111-1111-4111-8111-111111111111'
      AND template_key='PASSWORD_RESET' AND destination=$1
    ORDER BY created_at DESC LIMIT 1`, [email]);
  assert.equal(queued.rows[0].template_key, 'PASSWORD_RESET');

  await query('DELETE FROM users WHERE id=$1', [created.rows[0].id]);
});

test('MFA TOTP protege login administrativo e recovery code é uso único', async () => {
  const suffix = Date.now().toString().slice(-8);
  const email = `mfa-ci-${suffix}@example.com`;
  const password = 'MfaSenha@123';
  const hash = await bcrypt.hash(password, 12);
  const created = await query(`INSERT INTO users(tenant_id,unit_id,name,email,password_hash,role)
    VALUES('11111111-1111-4111-8111-111111111111',$1,'MFA CI',$2,$3,'FINANCE')
    RETURNING id`, [unitId, email, hash]);

  const login = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ tenant: 'demo', email, password })
  });
  assert.equal(login.response.status, 200);
  const localToken = login.body.token;

  const setup = await request('/api/security/mfa/setup', {
    method: 'POST',
    headers: { authorization: `Bearer ${localToken}` },
    body: '{}'
  });
  assert.equal(setup.response.status, 200);
  assert.ok(setup.body.secret);
  assert.ok(setup.body.otpauthUri.startsWith('otpauth://totp/'));

  const confirm = await request('/api/security/mfa/confirm', {
    method: 'POST',
    headers: { authorization: `Bearer ${localToken}` },
    body: JSON.stringify({ code: totpCode(setup.body.secret) })
  });
  assert.equal(confirm.response.status, 200);
  assert.equal(confirm.body.recoveryCodes.length, 8);

  const invalidated = await request('/api/me', {
    headers: { authorization: `Bearer ${localToken}` }
  });
  assert.equal(invalidated.response.status, 401);

  const challenge = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ tenant: 'demo', email, password })
  });
  assert.equal(challenge.response.status, 200);
  assert.equal(challenge.body.mfaRequired, true);

  const verified = await request('/api/security/auth/mfa', {
    method: 'POST',
    body: JSON.stringify({ mfaToken: challenge.body.mfaToken, code: totpCode(setup.body.secret) })
  });
  assert.equal(verified.response.status, 200);
  assert.ok(verified.body.token);

  const challenge2 = await request('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ tenant: 'demo', email, password })
  });
  const recoveryCode = confirm.body.recoveryCodes[0];
  const recovered = await request('/api/security/auth/mfa', {
    method: 'POST',
    body: JSON.stringify({ mfaToken: challenge2.body.mfaToken, code: recoveryCode })
  });
  assert.equal(recovered.response.status, 200);
  assert.equal(recovered.body.usedRecovery, true);

  const reused = await request('/api/security/auth/mfa', {
    method: 'POST',
    body: JSON.stringify({ mfaToken: challenge2.body.mfaToken, code: recoveryCode })
  });
  assert.equal(reused.response.status, 401);

  await query('DELETE FROM users WHERE id=$1', [created.rows[0].id]);
});

test('branding, domínio pendente, relatórios CSV e recibo funcionam', async () => {
  const branding = await request('/api/settings/branding', {
    method: 'PUT',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({
      tradeName: 'Minha Academia CI',
      primaryColor: '#123456',
      accentColor: '#22C55E',
      logoUrl: 'https://example.com/logo.png'
    })
  });
  assert.equal(branding.response.status, 200);
  assert.equal(branding.body.tradeName, 'Minha Academia CI');

  const domain = await request('/api/settings/domains', {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ domain: `ci-${Date.now()}.example.com` })
  });
  assert.equal(domain.response.status, 201);
  assert.equal(domain.body.dnsInstruction.type, 'TXT');
  assert.ok(domain.body.dnsInstruction.value);

  const summary = await request('/api/reports/summary', {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(summary.response.status, 200);
  assert.ok(Number.isInteger(summary.body.paymentsCount));

  const csvResponse = await fetch(base + '/api/reports/students.csv', {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(csvResponse.status, 200);
  assert.match(csvResponse.headers.get('content-type') || '', /text\/csv/);
  const csv = await csvResponse.text();
  assert.match(csv, /Nome/);

  const payment = await query(`SELECT id FROM payments
    WHERE tenant_id='11111111-1111-4111-8111-111111111111'
    ORDER BY paid_at DESC LIMIT 1`);
  assert.ok(payment.rowCount > 0);

  const receipt = await request('/api/reports/payments/' + payment.rows[0].id + '/receipt', {
    headers: { authorization: `Bearer ${token}` }
  });
  assert.equal(receipt.response.status, 200);
  assert.ok(receipt.body.receiptNumber.startsWith('REC-'));
  assert.equal(receipt.body.academy.tradeName, 'Minha Academia CI');
});

test('faturamento SaaS gera fatura e webhook da plataforma reconcilia pagamento', async () => {
  const platformLogin = await request('/api/platform/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'platform@minhaacademia.local', password: 'Platform@123' })
  });
  assert.equal(platformLogin.response.status, 200);
  let platformToken = platformLogin.body.token;

  const tenants = await request('/api/platform/tenants', {
    headers: { authorization: `Bearer ${platformToken}` }
  });
  const demo = tenants.body.find(x => x.slug === 'demo');
  assert.ok(demo);

  const product = await query('SELECT saas_plan FROM tenants WHERE id=$1', [demo.id]);
  const plan = product.rows[0].saas_plan;
  const price = await request('/api/platform/products/' + plan, {
    method: 'PUT',
    headers: { authorization: `Bearer ${platformToken}` },
    body: JSON.stringify({ priceCents: 19990 })
  });
  assert.equal(price.response.status, 200);

  const active = await request('/api/platform/tenants/' + demo.id + '/subscription', {
    method: 'POST',
    headers: { authorization: `Bearer ${platformToken}` },
    body: JSON.stringify({ status: 'ACTIVE', plan })
  });
  assert.equal(active.response.status, 200);

  const cycleKey = '2099-01';
  const generated = await request('/api/platform/billing/generate', {
    method: 'POST',
    headers: { authorization: `Bearer ${platformToken}` },
    body: JSON.stringify({ cycleKey })
  });
  assert.equal(generated.response.status, 200);
  assert.ok(generated.body.created >= 1);

  const invoices = await request('/api/platform/billing/invoices?tenantId=' + demo.id, {
    headers: { authorization: `Bearer ${platformToken}` }
  });
  const invoice = invoices.body.find(x => x.cycle_key === cycleKey);
  assert.ok(invoice);
  assert.equal(invoice.amount_cents, 19990);

  const externalId = 'pay_saas_' + Date.now();
  await query(`UPDATE tenant_saas_invoices SET provider='ASAAS',external_id=$1 WHERE id=$2`, [externalId, invoice.id]);
  const event = {
    id: 'evt_saas_' + Date.now(),
    event: 'PAYMENT_RECEIVED',
    payment: { id: externalId, value: 199.90, status: 'RECEIVED' }
  };
  const webhook = await request('/api/platform/billing/asaas/webhook', {
    method: 'POST',
    headers: { 'asaas-access-token': process.env.PLATFORM_ASAAS_WEBHOOK_TOKEN },
    body: JSON.stringify(event)
  });
  assert.equal(webhook.response.status, 200);

  const paid = await query('SELECT status,paid_at FROM tenant_saas_invoices WHERE id=$1', [invoice.id]);
  assert.equal(paid.rows[0].status, 'PAID');
  assert.ok(paid.rows[0].paid_at);
});

test('Superadmin pode ativar MFA e login passa a exigir segundo fator', async () => {
  const login = await request('/api/platform/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'platform@minhaacademia.local', password: 'Platform@123' })
  });
  assert.equal(login.response.status, 200);
  const platformToken = login.body.token;

  const setup = await request('/api/platform/security/mfa/setup', {
    method: 'POST',
    headers: { authorization: `Bearer ${platformToken}` },
    body: '{}'
  });
  assert.equal(setup.response.status, 200);

  const confirm = await request('/api/platform/security/mfa/confirm', {
    method: 'POST',
    headers: { authorization: `Bearer ${platformToken}` },
    body: JSON.stringify({ code: totpCode(setup.body.secret) })
  });
  assert.equal(confirm.response.status, 200);
  assert.equal(confirm.body.recoveryCodes.length, 10);

  const challenge = await request('/api/platform/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email: 'platform@minhaacademia.local', password: 'Platform@123' })
  });
  assert.equal(challenge.response.status, 200);
  assert.equal(challenge.body.mfaRequired, true);

  const verified = await request('/api/platform/auth/mfa', {
    method: 'POST',
    body: JSON.stringify({ mfaToken: challenge.body.mfaToken, code: totpCode(setup.body.secret) })
  });
  assert.equal(verified.response.status, 200);
  assert.ok(verified.body.token);
});

test('endpoint de métricas exige token e expõe dados Prometheus', async () => {
  const denied = await fetch(base + '/api/internal/metrics');
  assert.equal(denied.status, 404);

  const allowed = await fetch(base + '/api/internal/metrics', {
    headers: { 'x-metrics-token': process.env.METRICS_TOKEN }
  });
  assert.equal(allowed.status, 200);
  const text = await allowed.text();
  assert.match(text, /minha_academia_http_requests_total/);
  assert.match(text, /minha_academia_db_pool_total/);
});
