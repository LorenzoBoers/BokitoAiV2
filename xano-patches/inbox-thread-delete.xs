// DELETE /api:integrations/inbox/threads/{thread_id}
//
// Permanently remove a thread and all related messages, events, and pin rows.
// Organisation-scoped; idempotent when the thread is already gone.
query "inbox/threads/{thread_id}" verb=DELETE {
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

    db.query inbox_message {
      where = $db.inbox_message.thread_id == $input.thread_id && $db.inbox_message.organisation_id == $me.organisation_id
      return = {type: "list"}
    } as $messages

    foreach ($messages) {
      each as $msg {
        db.del inbox_message {
          field_name = "id"
          field_value = $msg.id
        }
      }
    }

    db.query inbox_event {
      where = $db.inbox_event.thread_id == $input.thread_id && $db.inbox_event.organisation_id == $me.organisation_id
      return = {type: "list"}
    } as $events

    foreach ($events) {
      each as $evt {
        db.del inbox_event {
          field_name = "id"
          field_value = $evt.id
        }
      }
    }

    db.query inbox_thread_pin {
      where = $db.inbox_thread_pin.thread_id == $input.thread_id && $db.inbox_thread_pin.organisation_id == $me.organisation_id
      return = {type: "list"}
    } as $pins

    foreach ($pins) {
      each as $pin {
        db.del inbox_thread_pin {
          field_name = "id"
          field_value = $pin.id
        }
      }
    }

    db.del inbox_thread {
      field_name = "id"
      field_value = $input.thread_id
    }
  }

  response = {deleted: true, thread_id: $input.thread_id}
}
