import { createHash } from 'node:crypto';

export const hashCredential = value =>
  createHash('sha256').update(String(value ?? '')).digest('hex');

export function isCacheExpired(state, now = Date.now()) {
  const syncedAt = Date.parse(state?.syncedAt || '');
  if (!Number.isFinite(syncedAt)) return true;
  const hours = Number(state?.policy?.offlineCacheHours || 72);
  return now - syncedAt > Math.max(1, hours) * 60 * 60 * 1000;
}

export function decideAccess(input, state, now = Date.now()) {
  const credential = String(input?.credential || '').trim();
  const credentialType = String(input?.credentialType || 'RFID').toUpperCase();
  const credentialHash = hashCredential(credential);

  if (!credential || !['QR','RFID','BIOMETRIC','PIN'].includes(credentialType)) {
    return { allow: false, decision: 'DENIED', reason: 'INVALID_CREDENTIAL', credentialHash, credentialType };
  }
  if (isCacheExpired(state, now)) {
    return { allow: false, decision: 'DENIED', reason: 'CACHE_EXPIRED', credentialHash, credentialType };
  }

  const match = (state?.credentials || []).find(item =>
    item.credentialType === credentialType && item.credentialHash === credentialHash
  );
  if (!match) {
    return { allow: false, decision: 'DENIED', reason: 'UNKNOWN_CREDENTIAL', credentialHash, credentialType };
  }
  if (!match.allowed) {
    return {
      allow: false,
      decision: 'DENIED',
      reason: match.reason || 'ACCESS_POLICY',
      credentialHash,
      credentialType,
      credentialId: match.credentialId,
      studentId: match.studentId
    };
  }
  return {
    allow: true,
    decision: 'GRANTED',
    reason: match.reason || 'ACTIVE',
    credentialHash,
    credentialType,
    credentialId: match.credentialId,
    studentId: match.studentId
  };
}
