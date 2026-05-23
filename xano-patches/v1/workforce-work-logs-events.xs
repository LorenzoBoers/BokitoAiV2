// POST /api:workforce/work_logs/{work_log_id}/events - run token or worker body auth
query "work_logs/{work_log_id}/events" verb=POST {
  api_group = "workforce"

  input {
    text worker_api_key?
    text auth_token?
    uuid work_log_id
    json events
  }

  stack {
    var $worker_ok {
      value = $input.worker_api_key != null && $input.worker_api_key == $env.XANO_WORKER_API_KEY
    }

    var $run_ok {
      value = $input.auth_token != null && $input.auth_token == ($input.work_log_id|to_text)
    }

    precondition ($worker_ok || $run_ok) {
      error_type = "accessdenied"
      error = "Unauthorized."
    }

    db.query work_logs {
      where = $db.work_logs.id == $input.work_log_id
      return = {type: "list"}
    } as $rows

    precondition (($rows|count) > 0) {
      error_type = "inputerror"
      error = "Run not found."
    }

    var $existing {
      value = $rows|first
    }

    var $incoming {
      value = $input.events != null ? $input.events : []
    }

    var $existing_events {
      value = $existing.events != null ? $existing.events : []
    }

    var $merged {
      value = $existing_events|merge:$incoming
    }

    db.edit work_logs {
      field_name = "id"
      field_value = $input.work_log_id
      data = {events: $merged, updated_at: now}
    } as $updated
  }

  response = {ok: true}
}
