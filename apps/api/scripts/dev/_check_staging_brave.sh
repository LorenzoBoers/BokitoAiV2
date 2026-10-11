#!/usr/bin/env bash
set -euo pipefail
echo 'staging alembic:'
docker exec bokito-staging-postgres-1 psql -U bokito -d bokito -c 'select * from alembic_version;' || \
  docker exec bokito-staging-postgres-1 psql -U postgres -c '\l' | head
echo 'staging brave in running api:'
docker exec bokito-staging-api-1 printenv BRAVE_SEARCH_API_KEY | wc -c
grep -n BRAVE /opt/bokito/.env.staging | sed -E 's/=.+$/=***/'
