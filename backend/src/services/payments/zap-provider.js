import { resolveLightningAddress, requestZapInvoice } from './lnurl.js';
import { createZapRequest } from './zap.js';
import { createZapReceiptRetriever } from '../nostr/zap-retriever.js';

export function createZapPaymentProvider({ network, relays, WebSocketImpl, fetchOptions }) {
  const retrieveReceipts = createZapReceiptRetriever({ WebSocketImpl });
  return {
    name: 'lnurl-nip57',
    async createRequest({ lightningAddress, amountSats, offerEventId, now }) {
      const amountMsat = amountSats * 1000;
      if (!Number.isSafeInteger(amountMsat)) throw new TypeError('Offer amount exceeds Lightning millisatoshi precision.');
      const endpoint = await resolveLightningAddress(lightningAddress, fetchOptions);
      const zapRequest = createZapRequest({
        receiverPubkey: endpoint.nostr_pubkey,
        amountMsat,
        relays,
        offerEventId,
        now
      });
      return { endpoint, zapRequest, amountMsat };
    },
    async requestInvoice({ endpoint, zapRequestJson, amountMsat }) {
      return requestZapInvoice({ endpoint, zapRequestJson, amountMsat, network }, fetchOptions);
    },
    findReceipts: retrieveReceipts
  };
}
