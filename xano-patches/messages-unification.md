# Messages table unification (Phase 1.2)

Apply after `messages` and `message_pin` tables exist per `v1-platform-tables.md`.

## Migration steps

1. For each `inbox_thread`, derive stable `thread_id` (uuid).
2. Copy `inbox_message` rows to `messages` with `channel='email'`, map direction to `from_type`.
3. Copy `inbox_event` to `messages` with `message_type` in (`note`, `status_update`), `from_type='system'`.
4. Copy chat `message` rows to `messages` with `channel='livechat'`, preserve `external_id`.
5. Copy `inbox_thread_pin` to `message_pin`.
6. Verify row counts, then drop legacy tables.

## Endpoint rebuild (Phase 1.5)

Rewrite `/inbox/*` and `/conversation/{id}/messages` to query `messages` while preserving response shapes for dashboard and chat-widget.
