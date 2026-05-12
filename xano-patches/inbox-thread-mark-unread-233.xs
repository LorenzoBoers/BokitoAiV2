// Xano endpoint: api:integrations/inbox/threads/{thread_id}/mark-unread (id 233)
//
// Counterpart to mark-read. Lets a user manually flip a thread back to
// unread state from the thread detail view (similar to the pattern in
// HelpScout, Intercom, Linear). Sets `has_unread = true` on the thread for the
// team.
query "inbox/threads/{thread_id}/mark-unread" verb=PATCH {
  api_group = "integrations"
  auth = "user"

  input {
    int thread_id filters=min:1
  }

  stack {
    db.get user {
      field_name = "id"
      field_value = $auth.id|to_int
    } as $me

    precondition ($me != null && $me.organisation_id != null) {
      error_type = "accessdenied"
      error = "No organisation context."
    }

    db.query inbox_thread {
      where = $db.inbox_thread.id == $input.thread_id && $db.inbox_thread.organisation_id == $me.organisation_id
      sort = {inbox_thread.id: "asc"}
      return = {type: "list"}
    } as $thread_list

    precondition (($thread_list|count) > 0) {
      error_type = "inputerror"
      error = "Thread not found."
    }

    db.edit inbox_thread {
      field_name = "id"
      field_value = $input.thread_id
      data = {has_unread: true}
    }

    db.query inbox_thread {
      where = $db.inbox_thread.id == $input.thread_id
      sort = {inbox_thread.id: "asc"}
      return = {type: "list"}
    } as $final_list

    var $final_thread {
      value = $final_list|first
    }
  }

  response = $final_thread
}
