import { nip19 } from 'nostr-tools';
import { getPublicKey } from 'nostr-tools/pure';
import { decrypt as decryptNcryptsec } from 'nostr-tools/nip49';

function readAttestorPubkey(value) {
  const input = String(value || '').trim();
  if (/^[0-9a-f]{64}$/.test(input)) return input;
  try {
    const decoded = nip19.decode(input);
    if (decoded.type === 'npub' && /^[0-9a-f]{64}$/.test(decoded.data)) return decoded.data;
  } catch { /* The value is neither an npub nor a raw public key. */ }
  throw new Error('NOSTR_ATTESTOR_PUBKEY must be a raw 64-character hex key or an npub');
}

function readAttestorSecretKey(env, attestorPubkey) {
  const encrypted = String(env.NOSTR_ATTESTOR_PRIVATE_KEY || '').trim();
  if (!encrypted) return null;
  const password = String(env.NOSTR_ATTESTOR_PASSWORD || '');
  let secretKey;
  try {
    if (encrypted.startsWith('ncryptsec1')) {
      if (!password) return null;
      secretKey = decryptNcryptsec(encrypted, password);
    } else if (encrypted.startsWith('nsec1')) {
      const decoded = nip19.decode(encrypted);
      if (decoded.type !== 'nsec') throw new Error('Expected an nsec key');
      secretKey = decoded.data;
    } else {
      throw new Error('Expected an ncryptsec or nsec key');
    }
  } catch {
    throw new Error('Could not unlock NOSTR_ATTESTOR_PRIVATE_KEY. Check the key and NOSTR_ATTESTOR_PASSWORD.');
  }
  if (getPublicKey(secretKey) !== attestorPubkey) {
    throw new Error('Unlocked NOSTR attestor key does not match NOSTR_ATTESTOR_PUBKEY.');
  }
  return secretKey;
}

function readLndUrl(value) {
  const url = new URL(value || 'https://127.0.0.1:8081');
  if (url.protocol !== 'https:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
    throw new Error('LND_REST_URL must be an HTTPS localhost origin from Polar.');
  }
  return url.origin;
}

// Cloudinary is optional so the licensing engine keeps working without a media
// provider. When any part is missing the content endpoints report it, the same
// way an unconfigured Polar LND wallet does.
function readCloudinary(env) {
  const cloudName = env.CLOUDINARY_CLOUD_NAME?.trim() || null;
  const apiKey = env.CLOUDINARY_API_KEY?.trim() || null;
  const apiSecret = env.CLOUDINARY_API_SECRET?.trim() || null;
  const folder = (env.CLOUDINARY_FOLDER?.trim() || 'contentport/videos').replace(/\/+$/, '');
  if (cloudName && !/^[A-Za-z0-9_-]{1,64}$/.test(cloudName)) throw new Error('CLOUDINARY_CLOUD_NAME contains invalid characters');
  if (apiKey && !/^[A-Za-z0-9_-]{1,64}$/.test(apiKey)) throw new Error('CLOUDINARY_API_KEY contains invalid characters');
  if (apiSecret && !/^[\x21-\x7e]{8,128}$/.test(apiSecret)) throw new Error('CLOUDINARY_API_SECRET must be 8-128 printable ASCII characters');
  if (!/^[A-Za-z0-9_\-/]{1,200}$/.test(folder)) throw new Error('CLOUDINARY_FOLDER contains invalid characters');
  return { cloudName, apiKey, apiSecret, folder };
}

function readCorsOrigins(env) {
  // Support multiple browser frontends while preserving the older singular name.
  const values = env.CORS_ORIGINS ?? env.CORS_ORIGIN ?? '';
  return [...new Set(values.split(',').map(value => value.trim()).filter(Boolean).map(value => {
    let url;
    try { url = new URL(value); } catch { throw new Error('CORS_ORIGINS must contain valid origins'); }
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((!['https:', 'http:'].includes(url.protocol)) || (url.protocol !== 'https:' && !local)
      || url.username || url.password || url.pathname !== '/' || url.search || url.hash) {
      throw new Error('CORS_ORIGINS must contain HTTPS origins (HTTP is allowed only for localhost development)');
    }
    return url.origin;
  }))];
}

function readDocsAuth(env) {
  const username = env.SWAGGER_UI_USERNAME?.trim() || null;
  const password = env.SWAGGER_UI_PASSWORD || null;
  if (Boolean(username) !== Boolean(password)) throw new Error('Set both SWAGGER_UI_USERNAME and SWAGGER_UI_PASSWORD');
  if (username && (username.length > 128 || username.includes(':') || /[\r\n]/.test(username))) {
    throw new Error('SWAGGER_UI_USERNAME must be at most 128 characters and must not contain a colon or newline');
  }
  if (password && (password.length < 32 || password.length > 256 || /[\r\n]/.test(password))) {
    throw new Error('SWAGGER_UI_PASSWORD must contain at least 32 and at most 256 characters, with no newlines');
  }
  if (env.NODE_ENV === 'production' && env.APP_ENV === 'production' && (!username || !password)) {
    throw new Error('Production requires SWAGGER_UI_USERNAME and SWAGGER_UI_PASSWORD to protect API documentation');
  }
  return { username, password, readOnly: env.NODE_ENV === 'production' };
}

function readS2sSecret(env, appEnv) {
  const secret = String(env.LE_ATTESTATION_SECRET || '').trim();
  if (appEnv !== 'development' && secret.length < 16) {
    throw new Error(`${appEnv} requires LE_ATTESTATION_SECRET of at least 16 characters for service-to-service attestation.`);
  }
  return secret;
}

export function readConfig(env = process.env) {
  const port = Number(env.PORT || 3000);
  const kind = Number(env.NOSTR_OFFER_KIND);
  const appEnv = env.APP_ENV || (env.NODE_ENV === 'production' ? 'production' : 'development');
  const paymentNetwork = env.PAYMENT_NETWORK || (appEnv === 'development' ? 'regtest' : null);
  const paymentEnabled = appEnv === 'development' || env.PAYMENT_ENABLED === 'true';
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  if (!env.NOSTR_OFFER_KIND || !Number.isInteger(kind) || kind < 1000 || kind >= 10000) throw new Error('NOSTR_OFFER_KIND must be an explicitly selected regular kind (1000..9999)');
  if (!['development', 'staging', 'production'].includes(appEnv)) throw new Error('APP_ENV must be development, staging, or production.');
  if (appEnv === 'development') {
    if (env.NODE_ENV === 'production' || paymentNetwork !== 'regtest') throw new Error('Development requires NODE_ENV other than production and PAYMENT_NETWORK=regtest.');
  } else {
    if (env.NODE_ENV !== 'production' || paymentNetwork !== 'mainnet') throw new Error(`${appEnv} requires NODE_ENV=production and PAYMENT_NETWORK=mainnet.`);
    if (env.LND_REST_URL || env.LND_MACAROON) throw new Error(`${appEnv} must not configure Polar LND credentials or endpoints.`);
    if (env.PAYMENT_ENABLED !== undefined && !['true', 'false'].includes(env.PAYMENT_ENABLED)) {
      throw new Error('PAYMENT_ENABLED must be true or false.');
    }
  }
  const attestorPubkey = readAttestorPubkey(env.NOSTR_ATTESTOR_PUBKEY);
  const attestorSecretKey = readAttestorSecretKey(env, attestorPubkey);
  if (appEnv !== 'development' && !attestorSecretKey) {
    throw new Error(`${appEnv} requires an unlocked NOSTR_ATTESTOR_PRIVATE_KEY for payment-triggered license issuance.`);
  }
  const origin = new URL(env.PUBLIC_ORIGIN || `http://localhost:${port}`);
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.href !== `${origin.origin}/`) throw new Error('PUBLIC_ORIGIN must be an HTTP(S) origin without path or credentials');
  if (appEnv !== 'development' && (origin.protocol !== 'https:' || ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))) {
    throw new Error(`${appEnv} requires a public HTTPS PUBLIC_ORIGIN.`);
  }
  const relays = [...new Set((env.NOSTR_RELAYS || '').split(',').map(x => x.trim()).filter(Boolean))];
  if (!relays.length) throw new Error('NOSTR_RELAYS is required');
  if (relays.length > 10) throw new Error('NOSTR_RELAYS must contain at most 10 relays for Zap receipt discovery.');
  for (const relay of relays) {
    const url = new URL(relay);
    const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
    if ((url.protocol !== 'wss:' && !(local && url.protocol === 'ws:')) || url.username || url.password || url.hash) throw new Error('Relays must use wss://, or ws:// on localhost');
    if (appEnv !== 'development' && (url.protocol !== 'wss:' || local)) throw new Error(`${appEnv} requires public wss:// Nostr relays.`);
  }
  // Cloud Run sets K_SERVICE; local development keeps the safer loopback default.
  const host = env.HOST || (env.K_SERVICE ? '0.0.0.0' : '127.0.0.1');
  const corsOrigins = readCorsOrigins(env);
  const docsAuth = readDocsAuth(env);
  const s2sSecret = readS2sSecret(env, appEnv);
  return { host, port, origin: origin.origin, corsOrigins, databaseUrl: env.DATABASE_URL,
    appEnv, paymentNetwork, paymentEnabled, paymentImplementation: appEnv === 'development' ? 'polar-lnd' : 'lnurl-zap',
    kind, attestorPubkey, attestorSecretKey, relays,
    ...(appEnv === 'development' ? { lndRestUrl: readLndUrl(env.LND_REST_URL), lndMacaroon: env.LND_MACAROON?.trim() || null } : {}),
    cloudinary: readCloudinary(env), docsAuth, s2sSecret };
}
