import fs from 'node:fs/promises';
import path from 'node:path';
import { pool } from './db.js';

async function resolveDirectory() {
  const candidates = [
    process.env.MIGRATIONS_DIR,
    path.resolve(process.cwd(), 'migrations'),
    path.resolve(process.cwd(), '../db/migrations')
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      const stat = await fs.stat(candidate);
      if (stat.isDirectory()) return candidate;
    } catch {}
  }
  throw new Error('Diretório de migrations não encontrado');
}

export async function migrate() {
  const dir = await resolveDirectory();
  await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
    filename text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);
  const files = (await fs.readdir(dir)).filter(f => f.endsWith('.sql')).sort();
  for (const filename of files) {
    const applied = await pool.query('SELECT 1 FROM schema_migrations WHERE filename=$1', [filename]);
    if (applied.rowCount) continue;
    const sql = await fs.readFile(path.join(dir, filename), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations(filename) VALUES($1)', [filename]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
