import { existsSync } from 'node:fs';
import pg from 'pg';
import { applyMigrations } from '../src/database/migrate.js';

// A local .env is convenient, but platform-provided environment variables are enough.
const localEnvFile = new URL('../.env', import.meta.url);
if (existsSync(localEnvFile)) process.loadEnvFile(localEnvFile);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
try {
  const result = await applyMigrations(pool);
  console.log(`Database migrations complete: ${result.applied} applied, ${result.skipped} already current.`);
} finally {
  await pool.end();
}
