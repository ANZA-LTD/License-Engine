BEGIN;
ALTER TABLE nostr_outbox DROP CONSTRAINT IF EXISTS nostr_outbox_offer_id_key;
CREATE INDEX IF NOT EXISTS nostr_outbox_offer_id_idx ON nostr_outbox(offer_id);
COMMIT;
