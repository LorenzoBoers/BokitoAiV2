// POST /api:workforce/messages/worker - agent container run token body auth
query "messages/worker" verb=POST {
  api_group = "workforce"

  input {
    text worker_api_key?
    text auth_token?
    uuid tenant_id
    uuid project_id?
    uuid thread_id
    text from_type
    uuid from_id
    text to_type?
    uuid to_id?
    text channel
    text message_type
    text body filters=trim|min:1
    text subject?
    text status?
    json payload?
    uuid parent_message_id?
  }

  stack {
    var $worker_ok {
      value = $input.worker_api_key != null && $input.worker_api_key == $env.XANO_WORKER_API_KEY
    }

    var $run_ok {
      value = false
    }

    conditional {
      if ($input.auth_token != null) {
        db.query work_logs {
          where = $db.work_logs.id == $input.auth_token && $db.work_logs.status == "running"
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $run_rows

        var.update $run_ok {
          value = ($run_rows|count) > 0
        }
      }
    }

    precondition ($worker_ok || $run_ok) {
      error_type = "accessdenied"
      error = "Unauthorized."
    }

    var $message_status {
      value = $input.status != null ? $input.status : "done"
    }

    db.add messages {
      data = {
        tenant_id        : $input.tenant_id
        project_id       : $input.project_id
        thread_id        : $input.thread_id
        parent_message_id: $input.parent_message_id
        from_type        : $input.from_type
        from_id          : $input.from_id
        to_type          : $input.to_type
        to_id            : $input.to_id
        channel          : $input.channel
        message_type     : $input.message_type
        body             : $input.body
        subject          : $input.subject
        payload          : $input.payload
        status           : $message_status
      }
    } as $msg
  }

  response = $msg
}
