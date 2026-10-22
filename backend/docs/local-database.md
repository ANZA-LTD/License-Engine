# Local PostgreSQL with Docker Compose

Run commands from the repository root unless stated otherwise. No Supabase account is needed.

```bash
docker compose up -d --wait postgres
docker compose ps
```

The Compose service uses the official PostgreSQL 17 image, binds to `127.0.0.1:5432`, and stores data in the persistent `contentport_postgres_data` Docker volume. On the first startup with an empty volume, it creates the `contentport` database and runs the ordered SQL files in `src/database/migrations/` (`001_offers.sql` and `002_videos.sql`) to initialize the offer, outbox, video, and upload-session tables.

The configuration lives in the project; the database files live in Docker's volume, not in Git. The example credentials are for local development only.

## Backend connection

Copy `backend/.env.example` to `backend/.env` if you have not already created it. Its local-only database URL matches Compose:

```dotenv
DATABASE_URL=postgresql://contentport:change-me@localhost:5432/contentport
```

The PostgreSQL container does not need Node dependencies to start or initialize its tables. Running the backend still requires `npm install` in `backend/` and the other settings described in [Day 2](day-2.md). The example Nostr public key is a placeholder for local setup and is not an attestor signing key.

## Inspect and stop

```bash
# Open the database shell; enter \q to exit.
docker compose exec postgres psql -U contentport -d contentport

# List the application tables.
docker compose exec postgres psql -U contentport -d contentport -c '\dt'

# Stop the container while keeping its data.
docker compose stop postgres

# Restart it.
docker compose up -d --wait postgres
```

`docker compose down` also preserves the named volume. Adding `--volumes` deletes the stored database, so do not use that option when you want to keep your offers.

## Existing volumes and later migrations

Initialization scripts run only on an empty database volume. For an existing volume, or to verify/apply the schema through the backend migration runner, run this command after installing backend dependencies:

```bash
cd backend
npm run migrate
```

The runner records each SQL file's SHA-256 checksum in `backend_schema_migrations`.
It skips recorded, unchanged migrations and stops if an applied migration file
was edited; create a new numbered migration instead. Existing databases without
the history table are upgraded by reapplying the current idempotent migrations
once and recording them. The runner serializes concurrent migration attempts.

If port 5432 is already used by another database, change the Compose host port to `127.0.0.1:5433:5432` and the backend URL port to `5433`. Do not stop an unrelated database to free the port.

The Compose volume is persistent, not a disposable integration-test database.
PostgreSQL integration tests use `TEST_DATABASE_URL` and create a uniquely
named temporary schema that they drop afterward. Point that variable only at a
database where you are authorized to create and drop schemas; do not use a
production database.

Reference: [official PostgreSQL Docker image](https://hub.docker.com/_/postgres).
