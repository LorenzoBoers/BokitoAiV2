// Xano endpoint: api:integrations/inbox/threads/{thread_id}/mark-read (id 232)
//
// Modern read/unread tracking: when the user opens a thread the dashboard fires
// this endpoint silently to mark the thread as read for the team
// (`has_unread = false`). The frontend updates state optimistically; this call
// is the persistent confirmation. The endpoint is idempotent and safe to call
// even when the thread is already marked as read.
query "inbox/threads/{thread_id}/mark-read" verb=PATCH {
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
      data = {has_unread: false}
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
