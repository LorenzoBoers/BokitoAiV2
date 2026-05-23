// POST /api:workforce/index/search - embedding only; worker or run token body auth
query "index/search" verb=POST {
  api_group = "workforce"

  input {
    text worker_api_key?
    text auth_token?
    uuid project_id
    json embedding
    int top_k?=8
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
          where = $db.work_logs.id == $input.auth_token && $db.work_logs.project_id == $input.project_id && $db.work_logs.status == "running"
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

    precondition (($input.embedding|count) > 0) {
      error_type = "inputerror"
      error = "embedding is required."
    }

    var $limit {
      value = $input.top_k != null ? $input.top_k : 8
    }

    db.query index_chunks {
      where = $db.index_chunks.project_id == $input.project_id
      sort = {index_chunks.updated_at: "desc"}
      return = {
        type  : "list"
        paging: {page: 1, per_page: $limit}
      }
    } as $chunks
  }

  response = {results: $chunks, chunks: $chunks}
}
