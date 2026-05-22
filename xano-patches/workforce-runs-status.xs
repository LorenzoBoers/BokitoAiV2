// GET /api:workforce/runs/{work_log_id}/status - end-user plain-language status (no raw events)
query "runs/{work_log_id}/status" verb=GET {
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

    db.query work_logs {
      where = $db.work_logs.id == $input.work_log_id && $db.work_logs.tenant_id == $me.organisation_id
      return = {type: "list"}
    } as $rows

    precondition (($rows|count) > 0) {
      error_type = "inputerror"
      error = "Run not found."
    }

    var $row {
      value = $rows|first
    }

    var $result {
      value = {
        state         : $row.status
        started_at    : $row.started_at
        task_subject  : $row.task_subject
        finished      : $row.finished_at != null
      }
    }
  }

  response = $result
}
