# V1 platform tables (apply in Xano before enabling runtime)

Create these tables in the Xano workspace. All tenant-scoped rows use `tenant_id uuid` = `organisation.id`.

## projects

- id uuid pk
- tenant_id uuid
- name text
- slug text
- description text nullable
- autonomous_scope text required (min 30 chars on create)
- autonomous_mode bool default false
- active_domains text[] default {}
- is_self_hosted_bokito bool default false
- customer_messages_trigger_po bool default false
- token_budget_daily int default 100000
- token_used_today int default 0
- token_used_this_hour int default 0
- token_warning_sent_at timestamp nullable
- cron_interval_minutes int default 60
- report_to_user_id uuid nullable
- created_at, updated_at

## pkb_sections

- id uuid pk
- tenant_id, project_id uuid
- layer enum: current_state | intended_state | change_queue
- domain enum nullable: code | marketing | research | design | operations | other
- title text nullable
- content text
- status enum: draft | approved | deprecated
- change_status enum: pending | in_progress | implemented | blocked | pending_implementation | rejected
- submitted_by_type enum: user | agent
- submitted_by_id uuid nullable
- priority int default 5
- dependencies int8[]
- domain_meta json default {}
- last_implementation_request_at timestamp nullable
- resolved_at timestamp nullable
- created_at, updated_at

## agents, agent_presets, teams

Per PRD spec. agents.role enum matches RunConfigJson roles.

## messages (universal bus)

Per plan Section 6. See messages-unification.md for migration.

## message_pin

- user_id int
- message_id uuid
- tenant_id uuid

## work_logs

- id uuid pk
- project_id, tenant_id, agent_id
- run_id uuid
- status enum
- events json[]
- tokens_used int
- started_at, finished_at

## index_chunks

- embedding vector(768)
- ivfflat index on embedding

## user additions

- expo_push_token text
- expo_push_token_updated_at timestamp

## Crons (Step 1.6)

- tokens_reset_daily (00:00 UTC)
- tokens_reset_hourly
- po_heartbeat_dispatcher (60s) -> POST worker /agent/po/run with Bearer WORKER_INBOUND_SECRET
- decision_unsnooze_hourly -> clear resolved_at on expired decision_request rows
