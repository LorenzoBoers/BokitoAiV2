# Phase 8 - Self-build bootstrap

1. In FastAPI, create project with `is_self_hosted_bokito=true`, paste PRD sections as `pkb_sections` `intended_state` (internal bootstrap only; user-visible PKB stays plain language for customer projects).
2. Connect GitHub App installation for `BokitoAiV2` repo.
3. Apply Full-stack `agent_presets` seed to project agents.
4. Set `WORKER_INBOUND_SECRET` on FastAPI cron `po_heartbeat_dispatcher`.
5. Trigger manual `POST https://<worker>/agent/po/run` with project + PO agent ids.
6. Review first PR and merge after human approval (required for self-hosted project).
