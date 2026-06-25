# Autotrading tenant ops (not platform core)

These scripts are **operations-only** helpers for the autotrading MVP on the VPS.
They are not imported by FastAPI runtime code.

## Scope

- Bokito platform: generic agents, webhooks, MCP, projects (configure via dashboard UI).
- External trading repo (`/opt/trading`): MMXM engine, DeGiro execution, MCP sidecar, webhook bridge.

## Scripts

| Script | Purpose |
|--------|---------|
| `vps-setup-trading-project.py` | Legacy bootstrap via API container (`scripts.tenants.autotrading.bootstrap`) |
| `vps-setup-trading-bokito-bridge.py` | Enable Bokito webhook bridge on trading stack |
| `vps-setup-trading-mcp.py` | Register trading MCP on tenant |
| `vps-configure-trading-mcp-env.py` | Write MCP env on VPS |
| `vps-ensure-trading-network.py` | Reconnect `bokito_shared` Docker network |
| `vps-enable-trading-live.py` / `vps-disable-trading-live.py` | Toggle live execution on VPS |
| `vps-trading-webhook-smoke.py` / `vps-trading-mcp-probe.py` | Smoke tests |
| `vps-audit-autotrading.py` | Audit autotrading tenant state |

## Preferred setup path

Use the live Bokito dashboard (`/integrations/setup`, `/settings/mcp`, `/agenda`, `/settings/projects`)
to configure webhooks, MCP, agents, and projects. Copy credentials into the trading repo `.env`.

Bootstrap in `apps/api/scripts/tenants/autotrading/bootstrap.py` remains for idempotent ops recovery only.
