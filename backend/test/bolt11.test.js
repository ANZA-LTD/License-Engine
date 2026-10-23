import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { bech32 } from '@scure/base';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { decodeBolt11, hashZapRequest } from '../src/services/payments/bolt11.js';

const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const privateKey = Buffer.from('11'.repeat(32), 'hex');
const paymentHash = '22'.repeat(32);
const descriptionHash = '33'.repeat(32);

function encodeWords(words, pad = false) {
  let accumulator = 0;
  let bits = 0;
  const bytes = [];
  for (const word of words) {
    accumulator = (accumulator << 5) | word;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
    accumulator &= (1 << bits) - 1;
  }
  if (pad && bits) bytes.push((accumulator << (8 - bits)) & 0xff);
  return Buffer.from(bytes);
}

function tagged(tag, bytes) {
  const words = bech32.toWords(bytes);
  return [alphabet.indexOf(tag), (words.length >> 5) & 31, words.length & 31, ...words];
}

function integerWords(value, length) {
  return Array.from({ length }, (_, index) => Number((BigInt(value) >> BigInt((length - index - 1) * 5)) & 31n));
}

function invoice({ amount = 5, timestamp = 1_700_000_000, hash = descriptionHash } = {}) {
  const hrp = `lnbc${amount}u`;
  const fields = [
    ...tagged('p', Buffer.from(paymentHash, 'hex')),
    ...tagged('h', Buffer.from(hash, 'hex')),
    ...tagged('n', Buffer.from(secp256k1.getPublicKey(privateKey))),
    alphabet.indexOf('x'), 0, 3, ...integerWords(3600, 3)
  ];
  const unsigned = [...integerWords(timestamp, 7), ...fields];
  const signingHash = sha256(Buffer.concat([Buffer.from(hrp), encodeWords(unsigned, true)]));
  const recoveredSignature = secp256k1.sign(signingHash, privateKey, { prehash: false, format: 'recovered' });
  const bolt11Signature = Buffer.concat([recoveredSignature.subarray(1), recoveredSignature.subarray(0, 1)]);
  return bech32.encode(hrp, [...unsigned, ...bech32.toWords(bolt11Signature)], 7089);
}

test('BOLT11 decoder verifies the invoice signature and exact Zap payment binding', () => {
  const requestJson = '{"kind":9734,"content":"license purchase"}';
  const hash = hashZapRequest(requestJson);
  const paymentRequest = invoice({ hash });
  const decoded = decodeBolt11(paymentRequest, {
    network: 'mainnet', amountMsat: 500_000, descriptionHash: hash, now: 1_700_000_100
  });
  assert.deepEqual(decoded, {
    network: 'mainnet', amount_msat: '500000', payment_hash: paymentHash,
    description_hash: hash, payee_pubkey: Buffer.from(secp256k1.getPublicKey(privateKey)).toString('hex'),
    timestamp: 1_700_000_000, expires_at: 1_700_003_600, signature_valid: true
  });
});

test('BOLT11 decoder rejects wrong network, amount, description hash, expiry and signatures', () => {
  const paymentRequest = invoice();
  const valid = { network: 'mainnet', amountMsat: 500_000, descriptionHash, now: 1_700_000_100 };
  assert.throws(() => decodeBolt11(paymentRequest, { ...valid, network: 'regtest' }), /network/);
  assert.throws(() => decodeBolt11(paymentRequest, { ...valid, amountMsat: 500_001 }), /amount/);
  assert.throws(() => decodeBolt11(paymentRequest, { ...valid, descriptionHash: '44'.repeat(32) }), /description hash/);
  assert.throws(() => decodeBolt11(paymentRequest, { ...valid, now: 1_700_003_600 }), /expired/);

  const { prefix, words } = bech32.decode(paymentRequest, 7089);
  const damaged = [...words];
  damaged[damaged.length - 104] ^= 1;
  assert.throws(() => decodeBolt11(bech32.encode(prefix, damaged, 7089), valid), /signature/);
});

test('Zap request hash is computed over the exact serialized event string', () => {
  assert.equal(hashZapRequest('{"a":1,"b":2}'), createHash('sha256').update('{"a":1,"b":2}').digest('hex'));
  assert.notEqual(hashZapRequest('{"a":1,"b":2}'), hashZapRequest('{"b":2,"a":1}'));
});
