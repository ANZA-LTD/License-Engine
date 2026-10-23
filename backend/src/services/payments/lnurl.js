import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { HttpError } from '../../utils/errors.js';
import { decodeBolt11, hashZapRequest } from './bolt11.js';

const ADDRESS_PART = /^[A-Za-z0-9._+-]{1,64}$/;
const MAX_RESPONSE_BYTES = 65536;

function isPublicIpv4(address) {
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || octets.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = octets;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && (b === 168 || (b === 0 && (c === 0 || c === 2)) || (b === 88 && c === 99))) ||
    (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
    (a === 203 && b === 0 && c === 113) || a >= 240);
}

function publicHttpsUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new HttpError(502, 'LIGHTNING_ADDRESS_INVALID', 'The Lightning Address returned an invalid HTTPS URL.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || (url.port && url.port !== '443') ||
      !url.hostname.includes('.') || isIP(url.hostname) || /\.(localhost|local|internal|test|invalid|example)$/i.test(url.hostname)) {
    throw new HttpError(502, 'LIGHTNING_ADDRESS_INVALID', 'The Lightning Address returned an unsafe HTTPS URL.');
  }
  return url;
}

async function requestPublicJson(input, { lookupImpl = lookup, requestImpl = httpsRequest, timeoutMs = 5000 } = {}) {
  const url = publicHttpsUrl(String(input));
  let addresses;
  try { addresses = await lookupImpl(url.hostname, { all: true, family: 4, verbatim: true }); }
  catch { throw new HttpError(503, 'LIGHTNING_ADDRESS_UNAVAILABLE', 'The creator Lightning Address service could not be resolved.'); }
  if (!addresses.length || addresses.some(({ address }) => !isPublicIpv4(address))) {
    throw new HttpError(502, 'LIGHTNING_ADDRESS_INVALID', 'The creator Lightning Address resolved to a non-public address.');
  }
  return new Promise((resolve, reject) => {
    const request = requestImpl(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      lookup: (_hostname, _options, callback) => callback(null, addresses[0].address, 4),
      servername: url.hostname,
      timeout: timeoutMs
    }, response => {
      const chunks = [];
      let size = 0;
      response.on('data', chunk => {
        size += chunk.length;
        if (size > MAX_RESPONSE_BYTES) request.destroy(new Error('Response too large'));
        else chunks.push(chunk);
      });
      response.on('end', () => {
        if (response.statusCode < 200 || response.statusCode >= 300) {
          reject(new HttpError(502, 'LIGHTNING_ADDRESS_ERROR', 'The creator Lightning Address service returned an error.'));
          return;
        }
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch { reject(new HttpError(502, 'LIGHTNING_ADDRESS_ERROR', 'The creator Lightning Address service returned invalid JSON.')); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('Request timed out')));
    request.on('error', () => reject(new HttpError(503, 'LIGHTNING_ADDRESS_UNAVAILABLE', 'The creator Lightning Address service is unavailable.')));
    request.end();
  });
}

export function parseLightningAddress(input) {
  if (typeof input !== 'string' || input.length > 320) throw new HttpError(400, 'INVALID_LIGHTNING_ADDRESS', 'Enter a valid creator Lightning Address.');
  const parts = input.trim().split('@');
  if (parts.length !== 2 || !ADDRESS_PART.test(parts[0])) throw new HttpError(400, 'INVALID_LIGHTNING_ADDRESS', 'Enter a valid creator Lightning Address such as name@example.com.');
  let domain;
  try {
    const url = new URL(`https://${parts[1]}`);
    if (url.hostname !== parts[1].toLowerCase() || url.pathname !== '/' || url.port || url.search || url.hash || url.username || url.password ||
        !url.hostname.includes('.') || isIP(url.hostname) || /\.(localhost|local|internal|test|invalid|example)$/i.test(url.hostname)) throw new Error();
    domain = url.hostname;
  } catch { throw new HttpError(400, 'INVALID_LIGHTNING_ADDRESS', 'Enter a public domain in the creator Lightning Address.'); }
  return { address: `${parts[0]}@${domain}`, username: parts[0], domain };
}

export async function resolveLightningAddress(input, options) {
  const address = parseLightningAddress(input);
  const response = await requestPublicJson(`https://${address.domain}/.well-known/lnurlp/${encodeURIComponent(address.username)}`, options);
  const callback = publicHttpsUrl(response?.callback);
  if (response?.allowsNostr !== true || !/^[0-9a-f]{64}$/.test(String(response?.nostrPubkey || '')) ||
      !Number.isSafeInteger(response.minSendable) || !Number.isSafeInteger(response.maxSendable) ||
      response.minSendable < 1 || response.maxSendable < response.minSendable) {
    throw new HttpError(422, 'ZAPS_NOT_SUPPORTED', 'This creator Lightning Address does not advertise a valid NIP-57 Zap endpoint.');
  }
  return {
    address: address.address,
    callback: callback.toString(),
    nostr_pubkey: response.nostrPubkey,
    min_sendable: response.minSendable,
    max_sendable: response.maxSendable
  };
}

export async function requestZapInvoice({ endpoint, zapRequestJson, amountMsat, network }, options) {
  if (!Number.isSafeInteger(amountMsat) || amountMsat < endpoint.min_sendable || amountMsat > endpoint.max_sendable) {
    throw new HttpError(422, 'ZAP_AMOUNT_UNSUPPORTED', 'The creator Lightning Address does not accept the offer amount.');
  }
  const callback = publicHttpsUrl(endpoint.callback);
  callback.searchParams.set('amount', String(amountMsat));
  callback.searchParams.set('nostr', zapRequestJson);
  const response = await requestPublicJson(callback, options);
  if (typeof response?.pr !== 'string') throw new HttpError(502, 'LIGHTNING_INVOICE_INVALID', 'The creator Lightning Address did not return a Lightning invoice.');
  try {
    return {
      request: response.pr,
      ...decodeBolt11(response.pr, {
        network,
        amountMsat,
        descriptionHash: hashZapRequest(zapRequestJson)
      })
    };
  } catch (error) {
    throw new HttpError(502, 'LIGHTNING_INVOICE_INVALID', error.message);
  }
}
