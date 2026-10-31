BEGIN;
-- Allow download grants to be issued for externally paid purchases that have no
-- Zap purchase record. purchase_id becomes nullable; external_reference records
-- the Payment Microservice purchase reference for audit and authorization.
ALTER TABLE download_grants ALTER COLUMN purchase_id DROP NOT NULL;
ALTER TABLE download_grants ADD COLUMN IF NOT EXISTS external_reference text;
CREATE INDEX IF NOT EXISTS download_grants_external_ref_idx ON download_grants(external_reference) WHERE external_reference IS NOT NULL;

-- Purchase-associated credentials issued by the Payment Microservice. Each
-- credential is an unguessable token bound to a specific offer and external
-- purchase, validated by the License Engine before issuing a download grant.
CREATE TABLE IF NOT EXISTS external_purchase_associations (
  id text PRIMARY KEY,
  offer_id text NOT NULL,
  external_reference text NOT NULL,
  credential_token_hash text NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);
CREATE INDEX IF NOT EXISTS external_purchase_associations_offer_idx ON external_purchase_associations(offer_id);
CREATE INDEX IF NOT EXISTS external_purchase_associations_token_idx ON external_purchase_associations(credential_token_hash);
COMMIT;
