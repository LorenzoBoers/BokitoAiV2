# Postgres backup and restore

The prod stack (`docker-compose.prod.yml`) runs a `pg-backup` sidecar
(`prodrigestivill/postgres-backup-local`) that takes a nightly `pg_dump` at
03:00 UTC into the `bokito_pg_backups` volume.

Retention: 7 daily, 4 weekly, 3 monthly. Dumps are gzip-compressed SQL
(`*.sql.gz`), one file per run, grouped in `daily/`, `weekly/`, `monthly/`
subfolders.

## Inspect available backups

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec pg-backup \
  ls -lR /backups
```

To copy a dump off the VPS (recommended before risky operations):

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml cp \
  pg-backup:/backups/daily/ ./pg-backups-copy/
```

## Take an ad-hoc backup

Run this before every schema migration or deploy that touches data:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec pg-backup \
  /backup.sh
```

## Restore procedure

1. Stop the app so nothing writes during restore (keep postgres up):

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml stop api worker
```

2. Pick the dump and restore it. The dump contains `DROP`/`CREATE` for all
   objects, so it restores into the existing database:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml exec pg-backup \
  sh -c 'zcat /backups/daily/<FILE>.sql.gz | psql -h postgres -U $POSTGRES_USER -d $POSTGRES_DB'
```

3. Start the app again and verify:

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d api worker
curl -fsS https://app.bokito.ai/api/health/ready
```

4. Smoke check: log in on the dashboard, open Messages, confirm recent
   threads are present up to the backup timestamp.

## Disaster recovery (lost volume / new VPS)

1. Provision the VPS, clone the repo, copy `.env.prod` from your secret store.
2. `docker compose --env-file .env.prod -f docker-compose.prod.yml up -d postgres`
3. Copy the offsite dump onto the VPS, then restore it into the fresh
   database with the `psql` command above (step 2 of the restore procedure).
4. Bring up the rest of the stack (`up -d`).

## What is and is not covered

- Covered: the full Postgres database (all tenants, threads, settings).
- Not covered: Redis (ephemeral queue/fanout state; safe to lose),
  file uploads under `apps/api/data/uploads` when `STORAGE_BACKEND=local`
  (use S3/R2 in prod, or add the uploads path to your offsite copy),
  Caddy TLS material (re-issued automatically).

## Offsite copies

The sidecar writes to a local Docker volume only. Copy dumps offsite on a
schedule (cron on the VPS or your workstation) with the `docker compose cp`
command above, or mount an rclone remote. A backup that lives only on the
same disk as the database does not protect against disk loss.
