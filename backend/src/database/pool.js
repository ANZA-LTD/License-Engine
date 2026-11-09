import pg from 'pg';

function readPoolMax(value) {
  if (value === undefined || value === '') return 10;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`Invalid DB_MAX: ${value}`);
  return n;
}

/**
 * Builds node-postgres pool options.
 *
 * TLS is opt-in through DATABASE_SSL_CA (the PEM text of the database host's
 * CA certificate, e.g. Supabase's). When set, the server certificate must be
 * signed by that CA. When unset, behaviour is unchanged (local development and
 * the Cloud SQL unix socket keep working).
 */
export function buildPoolConfig(connectionString, env = process.env) {
  const config = {
    connectionString,
    max: readPoolMax(env.DB_MAX),
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
    application_name: 'anza-license-engine'
  };
  const ca = String(env.DATABASE_SSL_CA ?? '').trim();
  if (ca) {
    // An sslmode in the URL would override the ssl object and could disable verification.
    if (/[?&]sslmode=/i.test(String(connectionString))) {
      throw new Error('Remove sslmode from DATABASE_URL when DATABASE_SSL_CA is set; TLS is configured from DATABASE_SSL_CA.');
    }
    config.ssl = { ca: ca.replace(/\\n/g, '\n'), rejectUnauthorized: true };
  }
  return config;
}

export function createPool(connectionString, env = process.env) {
  return new pg.Pool(buildPoolConfig(connectionString, env));
}
