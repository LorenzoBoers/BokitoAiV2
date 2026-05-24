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
- github_connection_id uuid nullable
- github_repo_full_name text nullable
- github_default_branch text default main
- repo_source enum default none (none, github_oauth, bokito_managed)
- repo_connected_at timestamp nullable
- repo_index_status enum (none, pending, queued, indexing, ready, error)
- repo_indexed_at timestamp nullable
- repo_index_error text nullable
- repo_last_commit_sha text nullable
- created_at, updated_at

## github_connections

- id uuid pk
- tenant_id uuid
- connected_by_user_id int
- github_user_id int
- github_login text
- access_token password/text internal
- refresh_token password/text internal nullable
- token_expires_at timestamp nullable
- scopes text
- status enum (active, revoked, error)
- created_at, updated_at

## github_oauth_states

- id uuid pk
- tenant_id uuid
- user_id int
- return_url text
- project_id uuid nullable
- expires_at timestamp

## pkb_sections (deprecated)

Replaced by `project_docs` + `doc_pages` + `doc_blocks` + `doc_change_requests`. No new writes after Slice 2 migration; rows kept readable for one release, then dropped.

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

## project_docs (block-based documentation)

One row per project. Wraps the page tree.

- id uuid pk
- tenant_id uuid
- project_id uuid (unique)
- title text (default: project name)
- created_at, updated_at

## doc_pages

A page in the project doc. Notion-style, can be nested.

- id uuid pk
- tenant_id uuid
- project_id uuid
- doc_id uuid ref project_docs
- parent_page_id uuid nullable (nested pages)
- title text
- slug text (url-safe, unique per project)
- icon text nullable (lucide icon name; no emoji per workspace rule)
- kind enum: overview | vision | features | brand | tech | marketing | operations | roadmap | log | notes | custom
- is_pinned bool default false
- is_locked bool default false (when true, agents cannot write blocks on this page)
- position int default 0 (sibling order)
- archived_at timestamp nullable (soft delete)
- created_at, updated_at

Index: (project_id, position), (project_id, slug unique).

## doc_blocks

A block on a page. Tree by `parent_block_id`. Order by `position` within siblings.

- id uuid pk
- tenant_id uuid
- project_id uuid
- page_id uuid ref doc_pages
- parent_block_id uuid nullable (toggle / list / callout children)
- type text (heading_1, heading_2, heading_3, paragraph, bullet_list_item, numbered_list_item, to_do, quote, callout, divider, code, image, embed, link_to_page, toggle, table)
- text json default [] (inline runs `[{ text, bold, italic, underline, strike, code, color, link }]`)
- props json default {} (type-specific: `{ checked }`, `{ tone, icon }`, `{ language }`, `{ url, alt }`, `{ rows, cols, cells }`)
- position int default 0
- created_by_type enum: user | agent
- created_by_id uuid nullable
- last_edited_by_type enum: user | agent
- last_edited_by_id uuid nullable
- created_at, updated_at

Index: (page_id, parent_block_id, position), (project_id).

## doc_block_revisions (audit trail)

Every create/update/delete/move on a block. Used to render the revision panel and revert.

- id uuid pk
- tenant_id uuid
- project_id uuid
- page_id uuid
- block_id uuid
- op enum: create | update | delete | move
- before json nullable (full block snapshot or null on create)
- after json nullable (full block snapshot or null on delete)
- actor_type enum: user | agent
- actor_id uuid nullable
- actor_label text (e.g. "Jane Smith" or "Builder")
- change_note text nullable (required when actor_type=agent)
- created_at

Index: (page_id, created_at desc), (block_id, created_at desc).

## doc_change_requests

Replaces `pkb_sections.layer = change_queue`. A request from the user (or eventually an agent) for a change to the doc. Triggers the PO heartbeat run on create.

- id uuid pk
- tenant_id uuid
- project_id uuid
- target_page_id uuid nullable (which page this proposes to change)
- title text nullable
- body text required
- status enum: pending | in_progress | implemented | blocked | rejected (default pending)
- priority int default 5
- submitted_by_type enum: user | agent
- submitted_by_id uuid nullable
- linked_revision_ids int8[] default {} (revisions made to fulfill the request)
- resolved_at timestamp nullable
- created_at, updated_at

Index: (project_id, status, created_at desc).

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

- id uuid pk
- project_id uuid nullable (null for tenant-wide doc chunks if used)
- tenant_id uuid
- connection_id uuid nullable (lineage for integration-sourced chunks)
- source_type text (repo_file, github_file, tenant_doc_section, ...)
- source_ref text (unique per project_id + source_ref for upsert)
- content text
- embedding vector(768)
- ivfflat index on embedding
- created_at, updated_at

## integration_hosts (brand / corporation logos)

- id uuid pk
- slug text unique (github, microsoft, google, bjorn_lunden, custom, smtp, ...)
- name text
- website_url text nullable
- logo image (Xano storage; public URL at read time)
- logo_dark image nullable
- brand_color text nullable (fallback badge)
- initials text nullable (fallback if image missing)
- sort_order int default 0
- created_at, updated_at

Seed rows: see `xano-patches/v1/integration-hosts-seed.md`. Upload logo images in Xano for each host before production.

## integration_providers (marketplace catalog)

- id uuid pk
- slug text unique (github, outlook, gmail, bjorn_lunden_mcp, ...)
- host_id uuid nullable ref integration_hosts
- name text
- description text
- category text
- auth_type enum: oauth2 | api_key | none
- capabilities json (repo_index, inbox_sync, mcp_tools, doc_index flags)
- status enum: available | coming_soon | deprecated
- oauth_config_key text nullable (env key group name, not secrets)
- logo_meta json nullable (initials, color; legacy fallback if host logo missing)
- sort_order int default 0
- created_at, updated_at

Seed rows: see `xano-patches/v1/integration-providers-seed.md`.

## integration_connections (tenant-owned, many per provider)

- id uuid pk
- tenant_id uuid
- provider_id uuid ref integration_providers
- external_account_id text (GitHub user id, Graph ms_user_id, etc.)
- display_name text
- credentials json internal (access_token, api_key, provider-specific fields)
- status enum: active | revoked | error
- connected_by_user_id int nullable
- metadata json nullable (scopes, avatar_url, ...)
- created_at, updated_at
- unique (tenant_id, provider_id, external_account_id)

## integration_oauth_states

- id uuid pk (state token)
- provider_slug text
- tenant_id uuid
- user_id int
- return_url text
- project_id uuid nullable
- expires_at timestamp

## integration_bindings

- id uuid pk
- tenant_id uuid
- connection_id uuid ref integration_connections
- binding_type text (project_repo, mailbox_primary, mcp_server)
- project_id uuid nullable
- config json (repo_full_name, default_branch, mcp_server_id, ...)
- status enum: active | revoked
- created_at, updated_at

## projects (additions)

- repo_binding_id uuid nullable ref integration_bindings
- github_connection_id remains for migration; prefer connection_id on repo PATCH + binding row

## user additions

- expo_push_token text
- expo_push_token_updated_at timestamp

## Crons (Step 1.6)

- tokens_reset_daily (00:00 UTC)
- tokens_reset_hourly
- po_heartbeat_dispatcher (60s) -> POST worker /agent/po/run with Bearer WORKER_INBOUND_SECRET
- decision_unsnooze_hourly -> clear resolved_at on expired decision_request rows
