import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { PersistentStore } from './store.js';
import { CloudClient } from './cloud.js';
import { decideAccess } from './engine.js';
import { createHttpAdapter } from './adapters/http.js';
import { createTcpAdapter } from './adapters/tcp.js';

const required = ['API_URL','AGENT_ID','AGENT_KEY'];
for (const key of required) {
  if (!process.env[key]) {
    console.error(`Configuração obrigatória ausente: ${key}`);
    process.exit(1);
  }
}

const store = await new PersistentStore(process.env.DATA_DIR || './data').init();
const cloud = new CloudClient({
  apiUrl: process.env.API_URL,
  agentId: process.env.AGENT_ID,
  agentKey: process.env.AGENT_KEY,
  timeoutMs: process.env.REQUEST_TIMEOUT_MS || 5000
});

let state = await store.loadState();
let syncing = false;
let flushing = false;

async function syncNow() {
  if (syncing) return;
  syncing = true;
  try {
    const next = await cloud.sync();
    state = next;
    await store.saveState(next);
    console.log(`[access] sincronizado: ${next.credentials?.length || 0} credenciais`);
  } catch (error) {
    console.warn(`[access] sync indisponível: ${error.message}`);
  } finally {
    syncing = false;
  }
}

async function flushNow() {
  if (flushing) return;
  flushing = true;
  try {
    const events = await store.readEvents();
    if (!events.length) return;
    const batch = events.slice(0, 100);
    await cloud.sendEvents(batch);
    await store.acknowledge(batch.map(event => event.eventId));
  } catch (error) {
    console.warn(`[access] fila preservada: ${error.message}`);
  } finally {
    flushing = false;
  }
}

async function onCredential(input) {
  const result = decideAccess(input, state);
  const event = {
    eventId: randomUUID(),
    credentialHash: result.credentialHash,
    credentialType: result.credentialType,
    direction: input.direction === 'EXIT' ? 'EXIT' : 'ENTRY',
    decision: result.decision,
    reason: result.reason,
    deviceId: input.deviceId || process.env.DEVICE_ID || null,
    occurredAt: new Date().toISOString(),
    metadata: input.metadata || {}
  };
  await store.enqueue(event);
  void flushNow();
  return {
    allow: result.allow,
    decision: result.decision,
    reason: result.reason
  };
}

const common = {
  defaultCredentialType: process.env.DEFAULT_CREDENTIAL_TYPE || 'RFID',
  localSharedSecret: process.env.LOCAL_SHARED_SECRET || '',
  deviceId: process.env.DEVICE_ID || '',
  onCredential
};

const adapter = String(process.env.ACCESS_ADAPTER || 'GENERIC_HTTP').toUpperCase() === 'GENERIC_TCP'
  ? createTcpAdapter({
      ...common,
      host: process.env.TCP_HOST || '0.0.0.0',
      port: process.env.TCP_PORT || 8788
    })
  : createHttpAdapter({
      ...common,
      host: process.env.LISTEN_HOST || '0.0.0.0',
      port: process.env.LISTEN_PORT || 8787,
      unlockUrl: process.env.DEVICE_UNLOCK_URL || ''
    });

await syncNow();
await adapter.start();
console.log(`[access] ${adapter.name} ativo; agente ${process.env.AGENT_ID}`);

const syncTimer = setInterval(syncNow, Number(process.env.SYNC_INTERVAL_MS || 30000));
const flushTimer = setInterval(flushNow, Number(process.env.FLUSH_INTERVAL_MS || 5000));
syncTimer.unref();
flushTimer.unref();

async function shutdown() {
  clearInterval(syncTimer);
  clearInterval(flushTimer);
  await flushNow();
  await adapter.stop();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
