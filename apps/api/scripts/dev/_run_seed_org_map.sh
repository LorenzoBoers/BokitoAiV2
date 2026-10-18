#!/bin/bash
set -euo pipefail
sed -i 's/\r$//' /tmp/seed_org_map_fresh.py
cp /tmp/seed_org_map_fresh.py /opt/bokito-dev/apps/api/scripts/dev/_seed_org_map.py
sed -n '19,22p' /opt/bokito-dev/apps/api/scripts/dev/_seed_org_map.py
cd /opt/bokito-dev/apps/api
set -a
. ./.env
set +a
./.venv/bin/python scripts/dev/_seed_org_map.py
