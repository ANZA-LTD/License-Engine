import pg from 'pg';
import { existsSync } from 'node:fs';
import { verifyEvent } from 'nostr-tools/pure';
import { readConfig } from './config/index.js';
import { PostgresContentStore } from './repositories/videos.js';
import { createOfferService } from './services/offers/service.js';
import { createContentService } from './services/content/service.js';
import { createCloudinary } from './services/media/cloudinary.js';
import { createRelayPublisher } from './services/nostr/publisher.js';
import { createLndClient } from './services/payments/lnd-client.js';
import { createZapPaymentProvider } from './services/payments/zap-provider.js';
import { createApp } from './app.js';

// Load local development settings when present; platform-injected environment variables work without a file.
const localEnvFile = new URL('../.env', import.meta.url);
if (existsSync(localEnvFile)) process.loadEnvFile(localEnvFile);

const config = readConfig();
const pool = new pg.Pool({ connectionString: config.databaseUrl, connectionTimeoutMillis: 5000 });
const store = new PostgresContentStore(pool);
const checkDatabaseReadiness = async () => {
  // LIMIT 0 checks that every required table exists without reading customer data.
  await pool.query('SELECT 1 FROM offers, api_requests, nostr_outbox, lightning_webhooks, videos, upload_sessions, zap_purchases LIMIT 0');
  return true;
};
const paymentProvider = config.paymentImplementation === 'polar-lnd'
  ? createLndClient({ restUrl: config.lndRestUrl, macaroon: config.lndMacaroon }) : null;
const zapPaymentProvider = config.paymentImplementation === 'lnurl-zap'
  ? createZapPaymentProvider({ network: config.paymentNetwork, relays: config.relays }) : null;
const service = createOfferService({ store, verifyEvent, paymentProvider, zapPaymentProvider, ...config, cloudinary: createCloudinary(config.cloudinary) });
const contentService = createContentService({ store, cloudinary: createCloudinary(config.cloudinary) });
const publish = createRelayPublisher({ relays: config.relays });
const server = createApp({ service, contentService, verifyEvent, origin: config.origin, corsOrigins: config.corsOrigins,
  readinessCheck: checkDatabaseReadiness, docsAuth: config.docsAuth });
let stopping = false;
let active;
const tick = () => { if (!stopping && !active) active = store.publishNext(publish).catch(error => console.error('Publication worker:', error.message)).finally(() => { active = undefined; }); };
const interval = setInterval(tick, 1000);
server.listen(config.port, config.host, () => console.log(`ContentPort API listening on ${config.host}:${config.port}`));
async function shutdown() { if (stopping) return; stopping = true; clearInterval(interval); await new Promise(resolve => server.close(resolve)); await active; await pool.end(); }
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
