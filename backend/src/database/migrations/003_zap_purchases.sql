BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS offers_id_event_id_uq ON offers(id, event_id);
CREATE TABLE IF NOT EXISTS zap_purchases (
  id text PRIMARY KEY,
  offer_id text NOT NULL,
  offer_event_id text NOT NULL,
  creator_pubkey text NOT NULL CHECK (creator_pubkey ~ '^[0-9a-f]{64}$'),
  lightning_address text NOT NULL,
  receiver_pubkey text CHECK (receiver_pubkey IS NULL OR receiver_pubkey ~ '^[0-9a-f]{64}$'),
  callback_url text,
  min_sendable numeric(30, 0),
  max_sendable numeric(30, 0),
  amount_sats bigint NOT NULL CHECK (amount_sats > 0),
  amount_msat numeric(30, 0) NOT NULL CHECK (amount_msat > 0),
  network text NOT NULL CHECK (network IN ('mainnet', 'regtest')),
  idempotency_hash text NOT NULL CHECK (idempotency_hash ~ '^[0-9a-f]{64}$'),
  access_token_hash text NOT NULL CHECK (access_token_hash ~ '^[0-9a-f]{64}$'),
  zap_request_id text CHECK (zap_request_id IS NULL OR zap_request_id ~ '^[0-9a-f]{64}$'),
  zap_request_json text,
  zap_request jsonb,
  invoice_request text,
  payment_hash text UNIQUE CHECK (payment_hash IS NULL OR payment_hash ~ '^[0-9a-f]{64}$'),
  invoice_payee_pubkey text CHECK (invoice_payee_pubkey IS NULL OR invoice_payee_pubkey ~ '^[0-9a-f]{66}$'),
  invoice_issued_at bigint,
  invoice_expires_at bigint,
  status text NOT NULL CHECK (status IN ('creating', 'pending', 'verified', 'expired', 'failed')),
  receipt_event_id text UNIQUE CHECK (receipt_event_id IS NULL OR receipt_event_id ~ '^[0-9a-f]{64}$'),
  receipt_event jsonb,
  settled_at bigint,
  receipt_attempts integer NOT NULL DEFAULT 0 CHECK (receipt_attempts >= 0),
  next_receipt_check_at bigint NOT NULL DEFAULT 0,
  creation_lease_until bigint NOT NULL,
  created_at bigint NOT NULL,
  updated_at bigint NOT NULL,
  FOREIGN KEY (offer_id, offer_event_id) REFERENCES offers(id, event_id),
  UNIQUE (offer_id, idempotency_hash)
);
CREATE UNIQUE INDEX IF NOT EXISTS zap_purchases_one_active_idx
  ON zap_purchases(offer_id) WHERE status IN ('creating', 'pending');
CREATE INDEX IF NOT EXISTS zap_purchases_receipt_retry_idx
  ON zap_purchases(next_receipt_check_at) WHERE status = 'pending';
COMMIT;
