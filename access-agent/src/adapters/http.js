import http from 'node:http';

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 16 * 1024) throw new Error('Payload excede 16KB');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

export function createHttpAdapter({
  host = '0.0.0.0',
  port = 8787,
  defaultCredentialType = 'RFID',
  localSharedSecret = '',
  deviceId = '',
  unlockUrl = '',
  onCredential
}) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');

    if (req.method === 'GET' && req.url === '/health') {
      res.statusCode = 200;
      return res.end(JSON.stringify({ status: 'ok', adapter: 'GENERIC_HTTP' }));
    }

    if (req.method !== 'POST' || req.url !== '/credential') {
      res.statusCode = 404;
      return res.end(JSON.stringify({ error: 'Not found' }));
    }

    if (localSharedSecret && req.headers['x-access-secret'] !== localSharedSecret) {
      res.statusCode = 401;
      return res.end(JSON.stringify({ error: 'Unauthorized' }));
    }

    try {
      const body = await readBody(req);
      const result = await onCredential({
        credential: body.credential,
        credentialType: String(body.credentialType || defaultCredentialType).toUpperCase(),
        direction: body.direction === 'EXIT' ? 'EXIT' : 'ENTRY',
        deviceId: String(body.deviceId || deviceId || '').slice(0, 120),
        metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
      });

      let unlockTriggered = false;
      if (result.allow && unlockUrl) {
        try {
          const unlock = await fetch(unlockUrl, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ allow: true, deviceId: body.deviceId || deviceId || null }),
            signal: AbortSignal.timeout(1500)
          });
          unlockTriggered = unlock.ok;
        } catch {}
      }

      res.statusCode = 200;
      res.end(JSON.stringify({ ...result, unlockTriggered }));
    } catch (error) {
      res.statusCode = 400;
      res.end(JSON.stringify({ allow: false, decision: 'DENIED', reason: 'INVALID_REQUEST', error: error.message }));
    }
  });

  return {
    name: 'GENERIC_HTTP',
    start() {
      return new Promise(resolve => server.listen(Number(port), host, resolve));
    },
    stop() {
      return new Promise(resolve => server.close(resolve));
    }
  };
}
