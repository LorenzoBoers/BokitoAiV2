// POST /api:workforce/messages/worker - agent container run token body auth
query "messages/worker" verb=POST {
  api_group = "workforce"

  input {
    text worker_api_key?
    text auth_token?
    uuid tenant_id
    text project_id
    uuid thread_id
    uuid from_id
    text body filters=trim|min:1
    text subject?
    text status?
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

    var $message_status {
      value = $input.status != null && ($input.status|strlen) > 0 ? $input.status : "done"
    }

    db.add messages {
      data = {
        tenant_id    : $input.tenant_id
        thread_id    : $input.thread_id
        from_type    : "agent"
        from_id      : $input.from_id
        channel      : "internal"
        message_type : "task_result"
        body         : $input.body
      }
    } as $msg

    db.edit messages {
      field_name = "id"
      field_value = $msg.id
      data = {project_id: $input.project_id}
    } as $msg

    db.edit messages {
      field_name = "id"
      field_value = $msg.id
      data = {status: $message_status}
    } as $msg

    conditional {
      if ($input.subject != null && ($input.subject|strlen) > 0) {
        db.edit messages {
          field_name = "id"
          field_value = $msg.id
          data = {subject: $input.subject}
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
