// GET /api:workforce/work_logs/{work_log_id}/events - read run events for admin UI
query "work_logs/{work_log_id}/events" verb=GET {
  api_group = "workforce"
  auth = "user"

  input {
    uuid work_log_id
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

    db.get work_logs {
      field_name = "id"
      field_value = $input.work_log_id
    } as $row

    precondition ($row != null && $row.tenant_id == $me.organisation_id) {
      error_type = "inputerror"
      error = "Run not found."
    }

    var $events {
      value = $row.events != null ? $row.events : []
    }

    var $status {
      value = $row.status
    }

    var $task_subject {
      value = $row.task_subject
    }

    var $started_at {
      value = $row.started_at
    }

    var $finished_at {
      value = $row.finished_at
    }

    var $tokens_used {
      value = $row.tokens_used
    }
  }

  response = {
    events      : $events
    status      : $status
    task_subject: $task_subject
    started_at  : $started_at
    finished_at : $finished_at
    tokens_used : $tokens_used
  }
}
