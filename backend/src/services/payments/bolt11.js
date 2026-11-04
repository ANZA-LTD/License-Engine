import { createHash } from 'node:crypto';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { bech32 } from '@scure/base';

const TAGS = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const MAX_INVOICE_LENGTH = 7089;

function wordsToBytes(words, pad) {
  let accumulator = 0;
  let bits = 0;
  const bytes = [];
  for (const word of words) {
    if (!Number.isInteger(word) || word < 0 || word > 31) throw new TypeError('Invalid BOLT11 word.');
    accumulator = (accumulator << 5) | word;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
    accumulator &= (1 << bits) - 1;
  }
  if (pad) {
    if (bits) bytes.push((accumulator << (8 - bits)) & 0xff);
  } else if (bits >= 5 || ((accumulator << (8 - bits)) & 0xff) !== 0) {
    throw new TypeError('Non-canonical BOLT11 data.');
  }
  return Buffer.from(bytes);
}

function wordsToInteger(words) {
  return words.reduce((value, word) => (value << 5n) | BigInt(word), 0n);
}

function decodeAmountMsat(hrp) {
  const network = hrp.startsWith('lnbcrt') ? 'regtest'
    : hrp.startsWith('lnbc') ? 'mainnet'
      : hrp.startsWith('lntb') ? 'testnet' : null;
  if (!network) throw new TypeError('Unsupported BOLT11 network.');
  const amount = hrp.slice(network === 'regtest' ? 6 : 4);
  const match = /^(\d+)([munp])?$/.exec(amount);
  if (!match) throw new TypeError('BOLT11 invoice must have a fixed amount.');
  const digits = BigInt(match[1]);
  const unit = match[2];
  if (!unit) return { network, amountMsat: digits * 100_000_000_000n };
  if (unit === 'm') return { network, amountMsat: digits * 100_000_000n };
  if (unit === 'u') return { network, amountMsat: digits * 100_000n };
  if (unit === 'n') return { network, amountMsat: digits * 100n };
  if (digits % 10n !== 0n) throw new TypeError('BOLT11 amount is below millisatoshi precision.');
  return { network, amountMsat: digits / 10n };
}

function readTaggedFields(words) {
  const fields = new Map();
  for (let offset = 0; offset < words.length;) {
    if (offset + 3 > words.length) throw new TypeError('Truncated BOLT11 tagged field.');
    const tag = TAGS[words[offset]];
    const length = (words[offset + 1] << 5) | words[offset + 2];
    offset += 3;
    if (offset + length > words.length) throw new TypeError('Truncated BOLT11 tagged field.');
    const value = words.slice(offset, offset + length);
    offset += length;
    if (fields.has(tag)) throw new TypeError(`Duplicate BOLT11 ${tag} field.`);
    fields.set(tag, value);
  }
  return fields;
}

function requireHash(fields, tag) {
  const words = fields.get(tag);
  if (!words) throw new TypeError(`BOLT11 invoice is missing ${tag === 'p' ? 'payment hash' : 'description hash'}.`);
  const bytes = wordsToBytes(words, false);
  if (bytes.length !== 32) throw new TypeError('BOLT11 hash field must be 32 bytes.');
  return bytes.toString('hex');
}

export function decodeBolt11(paymentRequest, { network, amountMsat, descriptionHash, now = Math.floor(Date.now() / 1000) }) {
  if (typeof paymentRequest !== 'string' || paymentRequest.length < 90 || paymentRequest.length > MAX_INVOICE_LENGTH) {
    throw new TypeError('Invalid BOLT11 invoice length.');
  }
  let decoded;
  try { decoded = bech32.decode(paymentRequest, MAX_INVOICE_LENGTH); }
  catch { throw new TypeError('BOLT11 invoice has an invalid Bech32 encoding or checksum.'); }

  const hrp = decoded.prefix.toLowerCase();
  const words = decoded.words;
  if (words.length < 7 + 104) throw new TypeError('BOLT11 invoice is truncated.');
  const { network: invoiceNetwork, amountMsat: invoiceAmountMsat } = decodeAmountMsat(hrp);
  if (invoiceNetwork !== network) throw new TypeError('BOLT11 invoice network does not match the configured payment network.');
  if (invoiceAmountMsat !== BigInt(amountMsat)) throw new TypeError('BOLT11 invoice amount does not match the purchase.');

  const timestamp = Number(wordsToInteger(words.slice(0, 7)));
  const signatureWords = words.slice(-104);
  const fields = readTaggedFields(words.slice(7, -104));
  const paymentHash = requireHash(fields, 'p');
  const invoiceDescriptionHash = requireHash(fields, 'h');
  if (fields.has('d')) throw new TypeError('Zap invoices must use a description hash, not a plaintext description.');
  if (invoiceDescriptionHash !== descriptionHash) throw new TypeError('BOLT11 description hash does not match the Zap request.');

  const expiryWords = fields.get('x');
  const expiry = expiryWords ? Number(wordsToInteger(expiryWords)) : 3600;
  const expiresAt = timestamp + expiry;
  if (!Number.isSafeInteger(timestamp) || !Number.isSafeInteger(expiry) || expiry <= 0 ||
      timestamp > now + 60 || expiresAt <= now) {
    throw new TypeError('BOLT11 invoice is expired or has an invalid timestamp.');
  }

  const signature = wordsToBytes(signatureWords, false);
  if (signature.length !== 65 || signature[64] > 3) throw new TypeError('BOLT11 signature is malformed.');
  const signingData = Buffer.concat([Buffer.from(hrp, 'utf8'), wordsToBytes(words.slice(0, -104), true)]);
  const messageHash = sha256(signingData);
  const compactSignature = signature.subarray(0, 64);
  const recoveredSignature = Buffer.concat([signature.subarray(64), compactSignature]);
  let payeePubkey;
  try {
    payeePubkey = Buffer.from(secp256k1.recoverPublicKey(recoveredSignature, messageHash, { prehash: false })).toString('hex');
  } catch { throw new TypeError('BOLT11 signature is invalid.'); }
  if (!secp256k1.verify(compactSignature, messageHash, Buffer.from(payeePubkey, 'hex'),
    { prehash: false, lowS: false })) {
    throw new TypeError('BOLT11 signature is invalid.');
  }

  const taggedPayee = fields.get('n');
  if (taggedPayee && wordsToBytes(taggedPayee, false).toString('hex') !== payeePubkey) {
    throw new TypeError('BOLT11 payee tag does not match its signature.');
  }
  return {
    network: invoiceNetwork,
    amount_msat: invoiceAmountMsat.toString(),
    payment_hash: paymentHash,
    description_hash: invoiceDescriptionHash,
    payee_pubkey: payeePubkey,
    timestamp,
    expires_at: expiresAt,
    signature_valid: true
  };
}

export function hashZapRequest(zapRequestJson) {
  return createHash('sha256').update(zapRequestJson, 'utf8').digest('hex');
}
