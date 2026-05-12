# Inbox Thread Pin Endpoints

## Endpoints created (api:integrations)

| ID  | Method | Path                                | Auth | Notes |
|-----|--------|-------------------------------------|------|-------|
| 234 | POST   | /inbox/threads/{thread_id}/pin      | user | Idempotent: per-user pin |
| 235 | DELETE | /inbox/threads/{thread_id}/pin      | user | Idempotent: per-user unpin |

## Endpoints updated

- `GET /inbox/threads` (id 223): added `view=pinned`, joins `inbox_thread_pin` for current user, decorates each item with `is_pinned`, sorts pinned threads to top of every page.
- `GET /inbox/threads/{thread_id}` (id 224): adds `is_pinned` to the thread payload.

## Tables

- New `inbox_thread_pin` (id 79) with per-user unique index on `(user_id, thread_id)`.

## Frontend additions

| File | Change |
|------|--------|
| `apps/dashboard/src/lib/inbox-api.ts` | Added `pinThread`, `unpinThread`, `isPinned` field on `InboxThread`, `view='pinned'` in `ThreadFilters` |
| `apps/dashboard/src/hooks/useThreads.ts` | Added `setThreadPinState` for optimistic list updates with sort-on-pin-change |
| `apps/dashboard/src/hooks/useThreadDetail.ts` | Added `togglePin` callback with optimistic + rollback |
| `apps/dashboard/src/components/inbox/InboxSidebarNav.tsx` | Added "Gepind" entry with `Pin` icon under "Alle kanalen" |
| `apps/dashboard/src/pages/Communication.tsx` | Routing for `pinned` queue + list-level mark-read/unread/togglePin handlers |
| `apps/dashboard/src/components/inbox/ThreadIndicatorMenu.tsx` | New: dropdown indicator with contextual actions, `group-hover/thread:ring-1` reveal |
| `apps/dashboard/src/components/inbox/ThreadListItem.tsx` | Replaced static dot with `ThreadIndicatorMenu`, root uses `group/thread` |
| `apps/dashboard/src/components/inbox/ThreadList.tsx` | New props `onMarkRead`, `onMarkUnread`, `onTogglePin` forwarded to items |
