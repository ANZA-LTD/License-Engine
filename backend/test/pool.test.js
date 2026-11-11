import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPoolConfig } from '../src/database/pool.js';

const URL_ = 'postgresql://le_app.ref:secret@aws-0-eu.pooler.supabase.com:5432/postgres';
const PEM = '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----';

test('pool config keeps previous behaviour without DATABASE_SSL_CA / DB_MAX', () => {
  const config = buildPoolConfig('postgres://u:p@/contentport?host=/cloudsql/x', {});
  assert.equal(config.ssl, undefined);
  assert.equal(config.max, 10);
  assert.equal(config.connectionTimeoutMillis, 5000);
});

test('pool config verifies TLS against DATABASE_SSL_CA and honours DB_MAX', () => {
  const config = buildPoolConfig(URL_, { DATABASE_SSL_CA: PEM.replace(/\n/g, '\\n'), DB_MAX: '3' });
  assert.deepEqual(config.ssl, { ca: PEM, rejectUnauthorized: true });
  assert.equal(config.max, 3);
});

test('pool config rejects invalid DB_MAX and sslmode alongside a CA', () => {
  assert.throws(() => buildPoolConfig(URL_, { DB_MAX: 'abc' }), /Invalid DB_MAX/);
  assert.throws(() => buildPoolConfig(`${URL_}?sslmode=verify-full`, { DATABASE_SSL_CA: PEM }), /Remove sslmode/);
});
