# Inbox Thread Pin Endpoints

## Endpoints created (api:integrations)

| ID  | Method | Path                                | Auth | Notes |
|-----|--------|-------------------------------------|------|-------|
| 234 | POST   | /inbox/threads/{thread_id}/pin      | user | Idempotent: per-user pin |
| 235 | DELETE | /inbox/threads/{thread_id}/pin      | user | Idempotent: per-user unpin |

## Endpoints updated

- `GET /inbox/threads` (id 223): adds `view=pinned`. The branch fetches
  pinned thread ids from `inbox_thread_pin` for the current user first,
  then filters `inbox_thread` by that id list (no join). Other views are
  unchanged. No `is_pinned` decoration here — the dashboard fetches the
  pinned id list separately via `GET /inbox/pins` (id 236) and decorates
  client-side.
- `GET /inbox/threads/{thread_id}` (id 224): unchanged shape — no
  `is_pinned` decoration. The dashboard derives `isPinned` client-side.

## Xanoscript caveat

Both pin endpoints (234 / 235) and the pinned-list endpoint (236) and
the `view=pinned` branch in 223 store `$auth.id|to_int` in a `$user_id`
variable up front. Using `($auth.id|to_int)` inline inside a
`db.query` `where` clause triggers a runtime type-resolution error
("1st operand must be one of these types: text, bool") on this
workspace, even though the same expression works fine inside
`db.get user`'s `field_value`.

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
