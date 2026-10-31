import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { authenticate, sha256, authenticateServiceToService } from './middleware/auth.js';
import { matchOfferRoute, matchPurchaseRoute, matchWebhookRoute, matchDownloadRoute } from './routes/offers.js';
import { matchVideoRoute } from './routes/content.js';
import { createOfferController } from './controllers/offers.js';
import { createContentController } from './controllers/content.js';
import { HttpError } from './utils/errors.js';

const require = createRequire(import.meta.url);
const swaggerUiDirectory = require('swagger-ui-dist').getAbsoluteFSPath();
const swaggerAssets = new Map([
  ['swagger-ui.css', ['text/css; charset=utf-8', readFileSync(join(swaggerUiDirectory, 'swagger-ui.css'))]],
  ['swagger-ui-bundle.js', ['application/javascript; charset=utf-8', readFileSync(join(swaggerUiDirectory, 'swagger-ui-bundle.js'))]],
  ['swagger-ui-standalone-preset.js', ['application/javascript; charset=utf-8', readFileSync(join(swaggerUiDirectory, 'swagger-ui-standalone-preset.js'))]]
]);
const openApiDocument = readFileSync(new URL('../docs/openapi.json', import.meta.url));

function matchesSecret(value, expected) {
  const valueHash = createHash('sha256').update(value).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(valueHash, expectedHash);
}

function hasDocsAccess(authorization, docsAuth) {
  if (!docsAuth?.username) return true;
  if (typeof authorization !== 'string') return false;
  const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/.exec(authorization);
  if (!match) return false;
  const decoded = Buffer.from(match[1], 'base64');
  if (decoded.toString('base64').replace(/=+$/, '') !== match[1].replace(/=+$/, '')) return false;
  const separator = decoded.indexOf(0x3a);
  if (separator < 0) return false;
  const username = decoded.subarray(0, separator).toString('utf8');
  const password = decoded.subarray(separator + 1).toString('utf8');
  return matchesSecret(username, docsAuth.username) && matchesSecret(password, docsAuth.password);
}

function serveApiDocs(request, response, url, docsAuth) {
  if (request.method === 'GET' && url.pathname === '/docs') {
    response.writeHead(308, { Location: '/docs/' });
    response.end();
    return true;
  }
  if (request.method !== 'GET' || !hasDocsAccess(request.headers.authorization, docsAuth)) {
    response.setHeader('WWW-Authenticate', 'Basic realm="API documentation", charset="UTF-8"');
    response.writeHead(request.method === 'GET' ? 401 : 404);
    response.end(JSON.stringify({ error: { code: 'DOCS_AUTH_REQUIRED', message: 'API documentation is not available.' } }));
    return true;
  }
  if (url.pathname === '/docs/' || url.pathname === '/docs/index.html') {
    const nonce = randomBytes(16).toString('base64');
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Content-Security-Policy',
      `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'`);
    response.setHeader('X-Content-Type-Options', 'nosniff');
    const methods = docsAuth?.readOnly ? '["get","head","options"]' : '["get","post","put","patch","delete","options","head"]';
    response.writeHead(200);
    response.end(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>API documentation</title><link rel="stylesheet" href="/docs/swagger-ui.css"></head><body><div id="swagger-ui"></div><script src="/docs/swagger-ui-bundle.js"></script><script src="/docs/swagger-ui-standalone-preset.js"></script><script nonce="${nonce}">window.onload=()=>SwaggerUIBundle({url:"/docs/openapi.json",dom_id:"#swagger-ui",deepLinking:true,displayRequestDuration:true,supportedSubmitMethods:${methods},presets:[SwaggerUIBundle.presets.apis,SwaggerUIStandalonePreset],layout:"StandaloneLayout"});</script></body></html>`);
    return true;
  }
  if (url.pathname === '/docs/openapi.json') {
    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.writeHead(200);
    response.end(openApiDocument);
    return true;
  }
  const assetName = url.pathname.slice('/docs/'.length);
  const asset = swaggerAssets.get(assetName);
  if (!asset) {
    response.writeHead(404);
    response.end(JSON.stringify({ error: { code: 'NOT_FOUND', message: 'Documentation asset not found.' } }));
    return true;
  }
  response.setHeader('Content-Type', asset[0]);
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.writeHead(200);
  response.end(asset[1]);
  return true;
}

export function createApp({ service, contentService = null, verifyEvent, origin, corsOrigins = [], readinessCheck, docsAuth = null, s2sSecret = null, now = () => Math.floor(Date.now() / 1000), onError = console.error }) {
  const controller = createOfferController(service);
  const contentController = createContentController(contentService || new Proxy({}, { get: () => () => {
    throw new HttpError(501, 'CONTENT_NOT_CONFIGURED', 'The content layer is not available.');
  } }));
  return createServer({ requestTimeout: 15000, headersTimeout: 10000, maxHeaderSize: 16384 }, async (request, response) => {
    const requestOrigin = request.headers.origin;
    if (requestOrigin) response.setHeader('Vary', 'Origin');
    if (requestOrigin && corsOrigins.includes(requestOrigin)) {
      response.setHeader('Access-Control-Allow-Origin', requestOrigin);
      response.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
      response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Idempotency-Key, X-Purchase-Token, X-External-Credential');
      response.setHeader('Access-Control-Max-Age', '600');
    }

    if (request.method === 'OPTIONS') {
      response.writeHead(204);
      response.end();
      return;
    }

    response.setHeader('Content-Type', 'application/json; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    try {
      if (!request.url.startsWith('/') || request.url.startsWith('//')) throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid request URL.');
      const url = new URL(request.url, origin);
      if (url.pathname === '/docs' || url.pathname.startsWith('/docs/')) {
        serveApiDocs(request, response, url, docsAuth);
        return;
      }
      if (url.pathname === '/health/live' || url.pathname === '/health/ready') {
        if (request.method !== 'GET') throw new HttpError(404, 'NOT_FOUND', 'Endpoint not found.');
        if (url.pathname === '/health/live') {
          response.writeHead(200);
          response.end(JSON.stringify({ status: 'alive' }));
          return;
        }
        // Readiness is separate from liveness so a dependency outage does not restart the process.
        let ready = false;
        try {
          ready = typeof readinessCheck === 'function' && await readinessCheck();
        } catch (error) {
          onError(error);
        }
        if (!ready) {
          response.writeHead(503);
          response.end(JSON.stringify({ status: 'not_ready', error: 'Required dependencies are unavailable.' }));
          return;
        }
        response.writeHead(200);
        response.end(JSON.stringify({ status: 'ready' }));
        return;
      }
      const route = matchWebhookRoute(request.method, url.pathname) || matchOfferRoute(request.method, url.pathname)
        || matchPurchaseRoute(request.method, url.pathname)
        || matchDownloadRoute(request.method, url.pathname)
        || matchVideoRoute(request.method, url.pathname);
      if (!route) throw new HttpError(404, 'NOT_FOUND', 'Endpoint not found.');
      const chunks = [];
      let bytes = 0;
      for await (const chunk of request) {
        bytes += chunk.length;
        if (bytes > 65536) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request exceeds 64 KiB.');
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks);
      let body;
      if (request.method === 'POST' && rawBody.length) {
        try { body = JSON.parse(rawBody.toString('utf8')); } catch { throw new HttpError(400, 'VALIDATION_ERROR', 'Invalid JSON.'); }
      }
      if (route.action === 'lightningWebhook') {
        const result = await controller.lightningWebhook({ body, headers: request.headers, rawBody, digest: sha256(rawBody), provider: route.provider });
        response.writeHead(result.status);
        response.end(JSON.stringify(result.body));
        return;
      }
      const key = request.headers['idempotency-key'];
      const needsAuth = Boolean(route.auth || route.s2s || request.headers.authorization);
      if (request.method === 'POST' && (needsAuth || route.idempotency) && (typeof key !== 'string' || !/^[A-Za-z0-9_-]{16,128}$/.test(key))) {
        throw new HttpError(400, 'VALIDATION_ERROR', 'Idempotency-Key must contain 16–128 letters, numbers, underscores, or hyphens.');
      }
      if (request.method === 'POST' && rawBody.length && request.headers['content-type']?.split(';')[0].trim() !== 'application/json') {
        throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Use application/json.');
      }
      let pubkey;
      if (route.s2s) {
        if (!s2sSecret) throw new HttpError(503, 'S2S_AUTH_NOT_CONFIGURED', 'Service-to-service authentication is not configured.');
        if (!authenticateServiceToService(request.headers.authorization, s2sSecret)) {
          throw new HttpError(401, 'UNAUTHENTICATED', 'Service-to-service authentication required.');
        }
        pubkey = 'service';
      } else if (needsAuth) {
        pubkey = authenticate({ authorization: request.headers.authorization, method: request.method,
          url: origin + request.url, rawBody, idempotencyKey: key, verifyEvent, now: now() });
      }
      const result = await (route.scope === 'content' ? contentController : controller)[route.action]({
        id: route.id, pubkey, body, key, digest: sha256(rawBody),
        purchaseToken: request.headers['x-purchase-token'],
        externalCredential: request.headers['x-external-credential'],
        grantToken: route.token
      });
      response.writeHead(result.status);
      response.end(JSON.stringify(result.body));
    } catch (error) {
      const known = error instanceof HttpError;
      if (!known) onError(error);
      response.writeHead(known ? error.status : 503);
      response.end(JSON.stringify({ error: {
        code: known ? error.code : 'DEPENDENCY_UNAVAILABLE',
        message: known ? error.message : 'The service is temporarily unavailable.'
      } }));
    }
  });
}
