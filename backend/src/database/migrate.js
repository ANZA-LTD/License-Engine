import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';

const migrationsDirectory = new URL('./migrations/', import.meta.url);
const migrationLockName = 'anza:backend:schema-migrations';

export async function applyMigrations(pool) {
  const client = await pool.connect();
  let locked = false;
  let applied = 0;
  let skipped = 0;
  try {
    // The session lock serializes migration runs, including across API instances.
    await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [migrationLockName]);
    locked = true;
    await client.query(`CREATE TABLE IF NOT EXISTS backend_schema_migrations (
      name text PRIMARY KEY,
      checksum text NOT NULL CHECK (checksum ~ '^[0-9a-f]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);

    const migrations = (await readdir(migrationsDirectory)).filter(name => name.endsWith('.sql')).sort();
    for (const name of migrations) {
      const sql = await readFile(new URL(name, migrationsDirectory), 'utf8');
      // Normalize line endings so Windows and Linux calculate the same checksum.
      const checksum = createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');
      const previous = (await client.query('SELECT checksum FROM backend_schema_migrations WHERE name = $1', [name])).rows[0];
      if (previous) {
        if (previous.checksum !== checksum) {
          throw new Error(`Migration ${name} changed after it was recorded; add a new migration instead.`);
        }
        skipped++;
        continue;
      }

      // Existing migration files are idempotent. If a process stops after DDL
      // commits but before this record is written, rerunning them is safe.
      await client.query(sql);
      await client.query('INSERT INTO backend_schema_migrations(name, checksum) VALUES ($1, $2)', [name, checksum]);
      applied++;
    }
    return { applied, skipped };
  } finally {
    let releaseError;
    if (locked) {
      try {
        await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [migrationLockName]);
      } catch (error) {
        releaseError = error;
      }
    }
    client.release(releaseError);
    if (releaseError) throw releaseError;
  }
}
