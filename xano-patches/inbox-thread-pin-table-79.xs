// Xano table: inbox_thread_pin (id 79)
//
// Per-user pin state for inbox threads. Each user has their own pinned set,
// independent of teammates. The (user_id, thread_id) pair is unique so
// re-pinning is safe and idempotent.
table "inbox_thread_pin" {
  auth = false

  schema {
    int id

    int user_id {
      table = "user"
    }

    int thread_id {
      table = "inbox_thread"
    }

    uuid organisation_id {
      table = "organisation"
    }

    timestamp created_at?=now
  }

  index = [
    {type: "primary", field: [{name: "id"}]}
    {type: "btree|unique", field: [{name: "user_id", op: "asc"}, {name: "thread_id", op: "asc"}]}
    {type: "btree", field: [{name: "user_id", op: "asc"}, {name: "organisation_id", op: "asc"}]}
  ]
}
