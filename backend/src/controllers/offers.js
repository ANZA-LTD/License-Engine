export function createOfferController(service) {
  return {
    create: context => service.create(context),
    get: context => service.get(context.id, context.pubkey),
    discover: context => service.discover(),
    publish: context => service.publish(context),
    createPayment: context => service.createPayment(context.id, context),
    getStatus: context => service.getStatus(context.id),
    getPurchaseStatus: context => service.getPurchaseStatus(context.id, context.purchaseToken),
    issueDownloadGrant: context => service.issueDownloadGrant(context.id, context.purchaseToken, context.externalCredential),
    consumeDownloadGrant: context => service.consumeDownloadGrant(context.grantToken),
    lightningWebhook: context => service.lightningWebhook(context),
    externalPaymentAttestation: context => service.externalPaymentAttestation(context)
  };
}
