# V1 backend verification checklist

## Phase 0 - Infrastructure

- [ ] SSH to VPS works
- [ ] Docker, Redis, Node 20, Ollama, PM2 installed
- [ ] Caddy serves `https://worker.bokito.ai` -> `localhost:3300`
- [ ] Cloudflare `worker` record is DNS-only (not proxied)
- [ ] `.env` on VPS complete; `WORKER_INBOUND_SECRET` matches Xano
- [ ] `curl https://worker.bokito.ai/health` -> `{ok:true}`

## Phase 2 - Worker plane

- [ ] `POST /api:workforce/runs/start` with JSON `worker_api_key` (matches `XANO_WORKER_API_KEY`) creates `work_logs` row
- [ ] Runtime dispatcher returns real `work_log_id` (not BullMQ job id)
- [ ] `POST /api:workforce/work_logs/{id}/events` accepts JSON `auth_token` equal to `work_log_id`
- [ ] `POST /api:workforce/runs/complete` finalizes status

## Phase 4 - Index / RAG

- [ ] Index worker upserts via `POST /index/chunks`
- [ ] Agent container embeds query via `host.docker.internal:11434`
- [ ] `POST /index/search` with embedding returns chunks (vector sort in Xano UI when pgvector ready)

## Phase 5 - Crons

- [ ] `po_heartbeat_dispatcher` POSTs to `WORKER_BASE_URL/agent/po/run` successfully
- [ ] Token reset crons scheduled

## Phase 9 - E2E

- [ ] Create project -> agents -> PO run -> work_log events -> task_result message
- [ ] Decision approve/defer/reject on unified `messages`
- [ ] Chat widget still works after messages unification
- [ ] Legacy orchestra endpoints removed (Phase 7)

## Known gaps (2026-05-23)

- `projects` table insert may fail with `INVALID TEXT REPRESENTATION` until optional UUID columns (e.g. `report_to_user_id`) allow null in Xano UI; use dashboard **Create project** or fix schema before worker seed
- Worker APIs use body auth (`worker_api_key`, `auth_token`); `$header` is unavailable when `auth = false`
- VPS deploy: use `bash scripts/deploy-runtime-vps.sh` after `git clone` (builds `@bokito/shared` first, sources `.env`, reloads Caddy)
- VPS SSH: password auth enabled for bootstrap; rotate root password and prefer SSH key-only after setup
- Messages unification (Phase 6) not executed - requires maintenance window
- Orchestra removal (Phase 7) not executed - pending E2E on V1 paths
- `index/search` vector similarity sort may need ivfflat index configured in Xano UI
