import fs from 'node:fs/promises';
import path from 'node:path';

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomic(file, value) {
  const temp = file + '.tmp';
  await fs.writeFile(temp, JSON.stringify(value, null, 2), { mode: 0o600 });
  await fs.rename(temp, file);
}

export class PersistentStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    this.stateFile = path.join(this.directory, 'state.json');
    this.queueFile = path.join(this.directory, 'events.json');
    this.lock = Promise.resolve();
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true, mode: 0o700 });
    return this;
  }

  withLock(fn) {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => {});
    return run;
  }

  loadState() {
    return readJson(this.stateFile, null);
  }

  saveState(state) {
    return this.withLock(() => writeJsonAtomic(this.stateFile, state));
  }

  readEvents() {
    return readJson(this.queueFile, []);
  }

  enqueue(event) {
    return this.withLock(async () => {
      const events = await readJson(this.queueFile, []);
      events.push(event);
      await writeJsonAtomic(this.queueFile, events);
      return events.length;
    });
  }

  acknowledge(eventIds) {
    const ids = new Set(eventIds);
    return this.withLock(async () => {
      const events = await readJson(this.queueFile, []);
      const remaining = events.filter(event => !ids.has(event.eventId));
      await writeJsonAtomic(this.queueFile, remaining);
      return remaining.length;
    });
  }
}
