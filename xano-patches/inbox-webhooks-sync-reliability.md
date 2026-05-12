# Xano: Webhooks + Reliability (Fase 5)

## Endpoints created

| ID  | Method | Path                           | Auth   | Notes |
|-----|--------|--------------------------------|--------|-------|
| 229 | POST   | /webhooks/microsoft            | public | Graph webhook validation + notification logging |
| 230 | GET    | /inbox/sync-status             | user   | Per-connection + per-folder sync observability |

## Task updated (id: 4)

`email/outlook_sync_inboxes` updated with:
- `debug.log` at run start/end with timestamp and connection count
- Per-folder `debug.log` showing `conn`, `folder_name`, `msgs` count
- Per-connection completion log with total message count
- Query now also processes connections with `status = 'error'` (removed the `status == 'active'` filter → uses `status != 'disconnected'`) so they get a retry on next run
- Body delta URL extended with `ccRecipients,body` select fields

## Frontend additions

| File | Change |
|------|--------|
| `apps/dashboard/src/lib/inbox-api.ts` | Added `SyncFolderStatus`, `SyncConnectionStatus` types + `getSyncStatus()` function |
| `apps/dashboard/src/components/inbox/SyncStatusPanel.tsx` | New component showing sync health per mailbox + folder |
| `apps/dashboard/src/pages/InboxSettings.tsx` | Imported + embedded `SyncStatusPanel` below mailbox table |

## Microsoft Graph webhook notes

- Endpoint: `https://api.bokito.ai/api:integrations/webhooks/microsoft`
- Validation: POST with `?validationToken=<token>` → responds with token as `text/plain`
- Notifications: POST with `{"value": [...]}` body → responds `{"received": true}`, logs via `debug.log`
- `clientState` check: compares against `$env.MICROSOFT_WEBHOOK_SECRET` (set this env var in Xano)
- Sync is handled by the scheduled task (runs every 15 min), not directly in the webhook handler

## Environment variables needed

| Variable | Usage |
|----------|-------|
| `MICROSOFT_WEBHOOK_SECRET` | Optional secret to verify Graph webhook `clientState` |
