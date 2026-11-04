CREATE TABLE IF NOT EXISTS download_grants (
  id uuid PRIMARY KEY,
  offer_id uuid NOT NULL,
  purchase_id uuid NOT NULL,
  license_event_id text NOT NULL,
  video_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  use_count integer NOT NULL DEFAULT 0,
  max_uses integer NOT NULL DEFAULT 5,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS download_grants_token_hash_idx ON download_grants(token_hash);
CREATE INDEX IF NOT EXISTS download_grants_purchase_idx ON download_grants(purchase_id);