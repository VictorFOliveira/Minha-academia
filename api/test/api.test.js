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
