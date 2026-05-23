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

    var $token_in {
      value = $input.token_input != null ? $input.token_input : 0
    }

    var $token_out {
      value = $input.token_output != null ? $input.token_output : 0
    }

    var $total_tokens {
      value = $token_in + $token_out
    }

    db.edit work_logs {
      field_name = "id"
      field_value = $input.work_log_id
      data = {
        status     : $input.status
        finished_at: now
        tokens_used: $total_tokens
        updated_at : now
      }
    } as $updated
  }

  response = {ok: true, work_log_id: $input.work_log_id, status: $input.status}
}
