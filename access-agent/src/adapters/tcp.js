import net from 'node:net';

export function createTcpAdapter({
  host = '0.0.0.0',
  port = 8788,
  defaultCredentialType = 'RFID',
  localSharedSecret = '',
  deviceId = '',
  onCredential
}) {
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let buffer = '';

    socket.on('data', async chunk => {
      buffer += chunk;
      if (buffer.length > 64 * 1024) {
        socket.write(JSON.stringify({ allow: false, decision: 'DENIED', reason: 'BUFFER_LIMIT' }) + '\n');
        buffer = '';
        return;
      }

      while (buffer.includes('\n')) {
        const index = buffer.indexOf('\n');
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;

        try {
          const body = JSON.parse(line);
          if (localSharedSecret && body.secret !== localSharedSecret) {
            socket.write(JSON.stringify({ allow: false, decision: 'DENIED', reason: 'UNAUTHORIZED' }) + '\n');
            continue;
          }
          const result = await onCredential({
            credential: body.credential,
            credentialType: String(body.credentialType || defaultCredentialType).toUpperCase(),
            direction: body.direction === 'EXIT' ? 'EXIT' : 'ENTRY',
            deviceId: String(body.deviceId || deviceId || '').slice(0, 120),
            metadata: body.metadata && typeof body.metadata === 'object' ? body.metadata : {}
          });
          socket.write(JSON.stringify(result) + '\n');
        } catch (error) {
          socket.write(JSON.stringify({ allow: false, decision: 'DENIED', reason: 'INVALID_REQUEST', error: error.message }) + '\n');
        }
      }
    });
  });

  return {
    name: 'GENERIC_TCP',
    start() {
      return new Promise(resolve => server.listen(Number(port), host, resolve));
    },
    stop() {
      return new Promise(resolve => server.close(resolve));
    }
  };
}
