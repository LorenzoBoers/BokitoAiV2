# Inbox Pin Architecture - Client-side Decoration

## Why this changed

The first iteration of the per-user pin system tried to decorate every
returned thread with `is_pinned` inside the Xano endpoints (`GET /inbox/threads`
and `GET /inbox/threads/{id}`) using inline pipe expressions of the form:

```xs
$threads.items|map:($$|set:"is_pinned":($pinned_ids|in:$$.id))
```

This produced a runtime error in Xano:

```
HTTP 400 ERROR_CODE_INPUT_ERROR
"1st operand must be one of these types: text, bool"
```

Root cause: the inline `|in:` filter inside a nested `|map:` returned a
non-bool value (null) when `$pinned_ids` was empty, which then made the
follow-up `|filter:$$.is_pinned == false` comparison fail because the
operand was null. Adding `|to_bool` did not resolve it (Xano still threw
the same error from another spot in the chain), and `array.map` /
`array.filter` statements ran into separate parser issues. Rather than
keep iterating against fragile syntax inside a hot path, we moved the
pin join client-side.

## Architecture (current)

| Concern | Owner | Endpoint / file |
|---|---|---|
| Persistent pin records (per user) | Xano | table `inbox_thread_pin` (id 79) |
| Set / unset pin | Xano | `POST /inbox/threads/{id}/pin` (id 234), `DELETE /inbox/threads/{id}/pin` (id 235) |
| List of pinned thread IDs for current user | Xano | **NEW** `GET /inbox/pins` (id 236) |
| List threads (with `view=pinned` join) | Xano | `GET /inbox/threads` (id 223) - simplified, no decoration |
| Get single thread | Xano | `GET /inbox/threads/{id}` (id 224) - simplified, no decoration |
| Decorate items with `isPinned` + sort pinned-first | Frontend | `useThreads` hook |
| Decorate detail thread with `isPinned` | Frontend | `useThreadDetail` hook |
| Optimistic add/remove pin in shared set | Frontend | `usePinnedIds` hook |

## Frontend changes

- `apps/dashboard/src/lib/inbox-api.ts`
  - Added `listPinnedThreadIds(token)` calling `GET /inbox/pins`.
  - `pinThread` / `unpinThread` no longer normalize the response (return `void`).
- `apps/dashboard/src/hooks/usePinnedIds.ts` (new)
  - Holds the user's pinned thread IDs as state, exposes `addPin`,
    `removePin`, `refresh` for optimistic updates.
- `apps/dashboard/src/hooks/useThreads.ts`
  - Accepts `pinnedIds: number[]` and decorates / sorts items locally.
  - Removed the dedicated `setThreadPinState` (pin state derives from
    `pinnedIds`).
- `apps/dashboard/src/hooks/useThreadDetail.ts`
  - Accepts `pinnedIds: number[]` and joins `isPinned` for the detail
    thread.
  - Exposes `error` for the parent to render.
  - `togglePin(currentPinned)` returns the next state and only does the
    server call; the parent updates the shared pin set optimistically.
- `apps/dashboard/src/pages/Communication.tsx`
  - Wires `usePinnedIds` into both `useThreads` and `useThreadDetail`.
  - `handleListTogglePin` and the new `handleDetailTogglePin` use
    `addPin`/`removePin` for optimistic updates and rollback.
- `apps/dashboard/src/components/inbox/ThreadDetail.tsx`
  - Receives `error` and `threadId` props and renders an explicit error
    state with a retry button when the detail fetch fails (instead of
    silently falling back to the "Selecteer een thread" placeholder).
  - New pin/unpin button in the header.

## Xano endpoints (post-fix)

- `GET /inbox/threads` (id 223): no `is_pinned` decoration. `view=pinned`
  fetches the user's pinned thread ids from `inbox_thread_pin` first and
  then filters `inbox_thread` by that id list. We avoid joins because
  Xano's join + inline pipe expressions hit type-resolution edge cases
  on this workspace.
- `GET /inbox/threads/{id}` (id 224): no `is_pinned` decoration; just
  thread + messages + events.
- `GET /inbox/pins` (id 236): `{ thread_ids: number[] }` for the current
  user, scoped to organisation.

## Second-round fix - inline `|to_int` in `where`

A follow-up bug surfaced after deploy: every endpoint that queried
`inbox_thread_pin` with `where = ... == ($auth.id|to_int)` returned

```
HTTP 400 ERROR_CODE_INPUT_ERROR
"1st operand must be one of these types: text, bool"
```

even though the same expression worked fine inside `db.get user`'s
`field_value`. The fix is to materialise `$auth.id|to_int` into a
variable up front, e.g.

```xs
var $user_id {
  value = $auth.id|to_int
}

db.query inbox_thread_pin {
  where = $db.inbox_thread_pin.user_id == $user_id && ...
}
```

This is now applied to:

- `GET /inbox/pins` (id 236)
- `GET /inbox/threads` (id 223) - including the `view=pinned` branch,
  which no longer uses a join at all (see above)
- `POST /inbox/threads/{id}/pin` (id 234)
- `DELETE /inbox/threads/{id}/pin` (id 235)

## Third-round fix - `|map:$$.field` returns nulls

After the where-clause fix, `GET /inbox/pins` returned `200` but with
`{ "thread_ids": [null, null] }` even though the underlying rows had
non-null `thread_id` values. The `|map:$$.field` filter form ran the
right number of iterations but `$$.field` resolved to null for each
element in this workspace.

Switched to the `array.map` statement (which uses `$this`) instead:

```xs
array.map ($rows) {
  by = $this.thread_id
} as $thread_ids
```

This is applied to:

- `GET /inbox/pins` (id 236) - mapping pin rows to thread_ids
- `GET /inbox/threads` (id 223) - mapping pin rows to pinned_thread_ids
  in the `view=pinned` branch
