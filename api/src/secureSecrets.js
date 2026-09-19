import crypto from 'node:crypto';

function keyMaterial() {
  const raw = String(process.env.INTEGRATION_ENCRYPTION_KEY || '');
  if (raw.length < 32) {
    throw Object.assign(new Error('INTEGRATION_ENCRYPTION_KEY não configurada'), { statusCode: 503 });
  }
  return crypto.createHash('sha256').update(raw).digest();
}

export function encryptSecret(value) {
  const key = keyMaterial();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    iv: iv.toString('base64'),
    tag: tag.toString('base64')
  };
}

export function decryptSecret(record) {
  const key = keyMaterial();
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(record.secret_iv, 'base64'));
  decipher.setAuthTag(Buffer.from(record.secret_tag, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(record.secret_ciphertext, 'base64')),
    decipher.final()
  ]).toString('utf8');
}

export function secretHash(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

export function timingSafeSecretMatch(value, expectedHex) {
  const actual = Buffer.from(secretHash(value), 'hex');
  const expected = Buffer.from(String(expectedHex || ''), 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}
