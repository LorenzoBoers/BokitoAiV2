// Xano endpoint: api:integrations/inbox/pins (id 236)
//
// Returns the IDs of all inbox threads pinned by the current user, scoped
// to their organisation. The dashboard uses this list to decorate thread
// list items with `is_pinned` and to sort pinned threads to the top of
// any list view, replacing the previous server-side decoration that hit
// type-fragile filter-expression bugs in Xano.
//
// Note: $auth.id|to_int is stored in a variable first because using a
// piped expression inline inside a db.query `where` clause causes a
// type-resolution error ("1st operand must be one of these types: text,
// bool") in Xano on this workspace. Also, the `|map:$$.field` filter
// form returns nulls in this workspace, so we use the `array.map`
// statement (with `$this`) instead.
query "inbox/pins" verb=GET {
  api_group = "integrations"
  auth = "user"

  input {
  }

  stack {
    var $user_id {
      value = $auth.id|to_int
    }

    db.get user {
      field_name = "id"
      field_value = $user_id
    } as $me

    precondition ($me != null && $me.organisation_id != null) {
      error_type = "accessdenied"
      error = "No organisation context."
    }

    db.query inbox_thread_pin {
      where = $db.inbox_thread_pin.user_id == $user_id && $db.inbox_thread_pin.organisation_id == $me.organisation_id
      sort = {inbox_thread_pin.id: "desc"}
      return = {type: "list"}
    } as $rows

    array.map ($rows) {
      by = $this.thread_id
    } as $thread_ids
  }

  response = {thread_ids: $thread_ids}
}
