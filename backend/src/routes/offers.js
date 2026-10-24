export function matchOfferRoute(method, pathname) {
  if (method === 'POST' && pathname === '/api/offers') return { action: 'create', auth: true };
  if (method === 'GET' && pathname === '/api/offers') return { action: 'discover', auth: false };
  const match = /^\/api\/offers\/([A-Za-z0-9_-]{1,100})(\/(publish|payment|status|license))?$/.exec(pathname);
  if (!match) return null;
  if (method === 'GET' && !match[2]) return { action: 'get', id: match[1], auth: false };
  if (method === 'POST' && match[3] === 'payment') return { action: 'createPayment', id: match[1], auth: false, idempotency: true };
  if (method === 'GET' && match[3] === 'status') return { action: 'getStatus', id: match[1], auth: false };
if (method === 'GET' && match[3] === 'license') return { action: 'getLicense', id: match[1], auth: false };
  if (method === 'POST' && match[3] === 'publish') return { action: 'publish', id: match[1], auth: true };
  return null;
}

export function matchPurchaseRoute(method, pathname) {
  const match = /^\/api\/purchases\/([A-Za-z0-9_-]{1,100})(\/(status|download-grant))?$/.exec(pathname);
  if (method === 'GET' && match && match[3] === 'status') return { action: 'getPurchaseStatus', id: match[1], auth: false };
  if (method === 'POST' && match && match[3] === 'download-grant') return { action: 'issueDownloadGrant', id: match[1], auth: false, idempotency: true };
  return null;
}

export function matchDownloadRoute(method, pathname) {
  const match = /^\/api\/downloads\/([0-9a-f]{64})$/.exec(pathname);
  if (method === 'GET' && match) return { action: 'consumeDownloadGrant', token: match[1], auth: false };
  return null;
}
export function matchWebhookRoute(method, pathname) {
  if (method === 'POST' && (pathname === '/api/webhooks/lightning' || pathname === '/api/webhooks/speed/lightning')) {
    return { action: 'lightningWebhook', auth: false, provider: 'speed' };
  }
  return null;
}
