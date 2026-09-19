import test from 'node:test';
import assert from 'node:assert/strict';
import { decideAccess, hashCredential, isCacheExpired } from '../src/engine.js';

const now = Date.parse('2026-09-18T20:00:00.000Z');
const state = {
  syncedAt: '2026-09-18T19:55:00.000Z',
  policy: { offlineCacheHours: 72 },
  credentials: [
    {
      credentialId: 'cred-1',
      studentId: 'student-1',
      credentialType: 'RFID',
      credentialHash: hashCredential('ABC123'),
      allowed: true,
      reason: 'ACTIVE'
    },
    {
      credentialId: 'cred-2',
      studentId: 'student-2',
      credentialType: 'RFID',
      credentialHash: hashCredential('BLOCKED'),
      allowed: false,
      reason: 'NO_ACTIVE_ENROLLMENT'
    }
  ]
};

test('autoriza credencial presente e permitida no cache', () => {
  const result = decideAccess({ credential: 'ABC123', credentialType: 'RFID' }, state, now);
  assert.equal(result.allow, true);
  assert.equal(result.decision, 'GRANTED');
  assert.equal(result.studentId, 'student-1');
});

test('nega credencial desconhecida', () => {
  const result = decideAccess({ credential: 'UNKNOWN', credentialType: 'RFID' }, state, now);
  assert.equal(result.allow, false);
  assert.equal(result.reason, 'UNKNOWN_CREDENTIAL');
});

test('respeita bloqueio sincronizado', () => {
  const result = decideAccess({ credential: 'BLOCKED', credentialType: 'RFID' }, state, now);
  assert.equal(result.allow, false);
  assert.equal(result.reason, 'NO_ACTIVE_ENROLLMENT');
});

test('falha fechado quando cache offline expira', () => {
  const expiredAt = now + 73 * 60 * 60 * 1000;
  assert.equal(isCacheExpired(state, expiredAt), true);
  const result = decideAccess({ credential: 'ABC123', credentialType: 'RFID' }, state, expiredAt);
  assert.equal(result.allow, false);
  assert.equal(result.reason, 'CACHE_EXPIRED');
});
