const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);

function headerValue(name) {
  if (name === 'Idempotency-Key') return '{{idempotencyKey}}';
  if (name === 'webhook-id') return '{{webhookId}}';
  if (name === 'webhook-timestamp') return '{{webhookTimestamp}}';
  if (name === 'webhook-signature') return '{{webhookSignature}}';
  return '';
}

function makeRequest(path, method, pathItem, operation, spec) {
  const parameters = [...(pathItem.parameters || []), ...(operation.parameters || [])];
  const pathParameters = parameters.filter(parameter => parameter.in === 'path');
  const headers = parameters.filter(parameter => parameter.in === 'header').map(parameter => ({
    key: parameter.name, value: headerValue(parameter.name), type: 'text', disabled: false
  }));
  const requiredNostrAuth = operation.security?.length === 1 && Boolean(operation.security[0].nostrAuth);
  if (requiredNostrAuth) headers.push({ key: 'Authorization', value: 'Nostr {{signedNip98Event}}', type: 'text' });
  for (const security of operation.security || []) {
    const schemeName = Object.keys(security)[0];
    const scheme = spec.components?.securitySchemes?.[schemeName];
    if (scheme?.type === 'apiKey' && scheme.in === 'header' && schemeName !== 'nostrAuth') {
      headers.push({ key: scheme.name, value: '{{webhookSignature}}', type: 'text' });
    }
  }

  let body;
  if (operation.requestBody) {
    const json = operation.requestBody.content?.['application/json'];
    if (json) {
      if (!headers.some(header => header.key.toLowerCase() === 'content-type')) {
        headers.push({ key: 'Content-Type', value: 'application/json', type: 'text' });
      }
      const example = json.example ?? Object.values(json.examples || {})[0]?.value ?? {};
      body = { mode: 'raw', raw: JSON.stringify(example, null, 2), options: { raw: { language: 'json' } } };
    }
  }

  const postmanPath = path.replace(/\{([^}]+)\}/g, ':$1');
  const url = {
    raw: `{{baseUrl}}${postmanPath}`,
    variable: pathParameters.map(parameter => ({
      key: parameter.name,
      value: path.includes('/videos/') ? '{{videoId}}' : '{{offerId}}'
    }))
  };
  return {
    name: operation.summary || operation.operationId,
    description: operation.description || '',
    request: {
      method: method.toUpperCase(),
      header: headers,
      ...(body ? { body } : {}),
      url
    }
  };
}

export function buildPostmanCollection(spec) {
  const groups = new Map();
  for (const [path, pathItem] of Object.entries(spec.paths)) {
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!methods.has(method)) continue;
      const tag = operation.tags?.[0] || 'API';
      if (!groups.has(tag)) groups.set(tag, []);
      groups.get(tag).push(makeRequest(path, method, pathItem, operation, spec));
    }
  }
  return {
    info: {
      name: spec.info.title,
      description: 'Generated from the repository OpenAPI contract. Replace placeholder variables before sending requests.',
      schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json'
    },
    item: [...groups].map(([name, item]) => ({ name, item })),
    variable: [
      { key: 'baseUrl', value: 'http://localhost:3000', type: 'string' },
      { key: 'offerId', value: 'replace-with-offer-id', type: 'string' },
      { key: 'videoId', value: 'replace-with-video-id', type: 'string' },
      { key: 'idempotencyKey', value: 'replace-with-a-unique-random-key', type: 'string' },
      { key: 'signedNip98Event', value: 'replace-with-base64-signed-event', type: 'string' },
      { key: 'webhookId', value: 'replace-with-provider-message-id', type: 'string' },
      { key: 'webhookTimestamp', value: 'replace-with-provider-timestamp', type: 'string' },
      { key: 'webhookSignature', value: 'replace-with-provider-signature', type: 'string' }
    ]
  };
}
