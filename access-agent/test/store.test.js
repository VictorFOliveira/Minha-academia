import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PersistentStore } from '../src/store.js';

test('ack por eventId preserva eventos inseridos durante o flush', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'academia-access-'));
  try {
    const store = await new PersistentStore(directory).init();
    await store.enqueue({ eventId: 'event-a' });

    const batch = await store.readEvents();
    assert.deepEqual(batch.map(x => x.eventId), ['event-a']);

    await store.enqueue({ eventId: 'event-b' });
    await store.acknowledge(batch.map(x => x.eventId));

    const remaining = await store.readEvents();
    assert.deepEqual(remaining.map(x => x.eventId), ['event-b']);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
