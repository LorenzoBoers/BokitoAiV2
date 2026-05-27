// POST /api:workforce/runs/complete - worker or run token body auth
query "runs/complete" verb=POST {
  api_group = "workforce"

  input {
    text worker_api_key?
    text auth_token?
    uuid work_log_id
    enum status {
      values = ["completed", "failed"]
    }
    int token_input?
    int token_output?
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

    var $row {
      value = $rows|first
    }

    var $token_in {
      value = $input.token_input != null ? $input.token_input : 0
    }

    var $token_out {
      value = $input.token_output != null ? $input.token_output : 0
    }

    var $new_total {
      value = $token_in + $token_out
    }

    var $existing_total {
      value = $row.tokens_used != null ? $row.tokens_used : 0
    }

    var $tokens_used {
      value = $new_total > 0 ? $new_total : $existing_total
    }

    db.edit work_logs {
      field_name = "id"
      field_value = $input.work_log_id
      data = {
        status     : $input.status
        finished_at: now
        tokens_used: $tokens_used
        updated_at : now
      }
    } as $updated

    db.query projects {
      where = $db.projects.id == $row.project_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $proj_rows

    conditional {
      if (($proj_rows|count) > 0) {
        var $proj {
          value = $proj_rows|first
        }

        var $used_today {
          value = $proj.token_used_today != null ? $proj.token_used_today : 0
        }

        var $used_hour {
          value = $proj.token_used_this_hour != null ? $proj.token_used_this_hour : 0
        }

        var $delta {
          value = $tokens_used - $existing_total
        }

        var $delta_pos {
          value = $delta > 0 ? $delta : 0
        }

        db.edit projects {
          field_name = "id"
          field_value = $proj.id
          data = {
            token_used_today    : $used_today + $delta_pos
            token_used_this_hour: $used_hour + $delta_pos
            updated_at          : now
          }
        } as $proj_updated
      }
    }
  }

  response = {ok: true, work_log_id: $input.work_log_id, status: $input.status, tokens_used: $tokens_used}
}
