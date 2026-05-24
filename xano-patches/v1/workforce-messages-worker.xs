// POST /api:workforce/messages/worker - agent container run token body auth.
// Accepts an arbitrary message_type (defaults to task_result for backwards
// compat with postTaskResult). Used by the PO agent to write
// status_update and decision_request messages back to the user.
//
// IMPORTANT: Xano's `db.add` and `db.edit` apply column defaults for fields
// that are not explicitly set. The messages table has `default = ""` on
// nullable enums (to_type, status), nullable json (payload), etc. Empty
// string is invalid for those PostgreSQL types, causing 22P02 INVALID TEXT
// REPRESENTATION. Workaround: explicitly set every nullable column to a
// literal `null` (or valid value) in the initial db.add. Optional inputs
// are then layered on with db.edit conditionals.
//
// Also note: passing `$input.to_id` (an unset optional uuid input) to
// `data = {to_id: $input.to_id}` does NOT behave the same as a literal
// `null`. Use literal null in db.add and only db.edit when the input is
// actually present.
query "messages/worker" verb=POST {
  api_group = "workforce"

  input {
    text worker_api_key?
    text auth_token?
    uuid tenant_id
    uuid project_id
    uuid thread_id
    uuid from_id
    text body filters=trim|min:1
    text subject?
    text status?
    text message_type?
    text channel?
    text to_type?
    uuid to_id?
    text payload?
  }

  stack {
    var $worker_ok {
      value = $input.worker_api_key != null && ($input.worker_api_key|strlen) > 0 && $input.worker_api_key == $env.XANO_WORKER_API_KEY
    }

    var $run_ok {
      value = $input.auth_token != null && ($input.auth_token|strlen) > 0
    }

    precondition ($worker_ok || $run_ok) {
      error_type = "accessdenied"
      error = "Unauthorized."
    }

    var $subject {
      value = $input.subject != null ? $input.subject : ""
    }

    var $status_val {
      value = $input.status != null && ($input.status|strlen) > 0 ? $input.status : "done"
    }

    var $message_type {
      value = $input.message_type != null && ($input.message_type|strlen) > 0 ? $input.message_type : "task_result"
    }

    var $channel {
      value = $input.channel != null && ($input.channel|strlen) > 0 ? $input.channel : "internal"
    }

    db.add messages {
      data = {
        thread_id        : $input.thread_id
        tenant_id        : $input.tenant_id
        from_id          : $input.from_id
        from_type        : "agent"
        channel          : $channel
        message_type     : $message_type
        body             : $input.body
        body_html        : ""
        external_id      : ""
        subject          : $subject
        payload          : null
        status           : $status_val
        to_type          : null
        to_id            : null
        project_id       : $input.project_id
        parent_message_id: null
        resolved_at      : null
      }
    } as $msg

    conditional {
      if ($input.to_type != null && ($input.to_type|strlen) > 0) {
        db.edit messages {
          field_name = "id"
          field_value = $msg.id
          data = {to_type: $input.to_type}
        } as $msg
      }
    }

    conditional {
      if ($input.to_id != null) {
        db.edit messages {
          field_name = "id"
          field_value = $msg.id
          data = {to_id: $input.to_id}
        } as $msg
      }
    }

    conditional {
      if ($input.payload != null && ($input.payload|strlen) > 0) {
        var $payload_data {
          value = $input.payload|json_decode
        }

        db.edit messages {
          field_name = "id"
          field_value = $msg.id
          data = {payload: $payload_data}
        } as $msg
      }
    }
  }

  response = $msg
}
