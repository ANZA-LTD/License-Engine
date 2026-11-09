import { existsSync } from 'node:fs';
import { applyMigrations } from '../src/database/migrate.js';
import { createPool } from '../src/database/pool.js';

// A local .env is convenient, but platform-provided environment variables are enough.
const localEnvFile = new URL('../.env', import.meta.url);
if (existsSync(localEnvFile)) process.loadEnvFile(localEnvFile);
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const pool = createPool(process.env.DATABASE_URL);
try {
  const result = await applyMigrations(pool);
  console.log(`Database migrations complete: ${result.applied} applied, ${result.skipped} already current.`);
} finally {
  await pool.end();
}
