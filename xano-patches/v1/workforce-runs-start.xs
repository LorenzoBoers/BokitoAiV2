// POST /api:workforce/runs/start - worker body auth, create work_log
query "runs/start" verb=POST {
  api_group = "workforce"

  input {
    text worker_api_key
    uuid project_id
    uuid tenant_id
    uuid agent_id
    uuid run_id
    text task_subject?
  }

  stack {
    precondition ($input.worker_api_key == $env.XANO_WORKER_API_KEY) {
      error_type = "accessdenied"
      error = "Unauthorized worker."
    }

    db.add work_logs {
      data = {
        id          : $input.run_id
        project_id  : $input.project_id
        tenant_id   : $input.tenant_id
        agent_id    : $input.agent_id
        run_id      : $input.run_id
        task_subject: $input.task_subject != null ? $input.task_subject : "Agent run"
        status      : "running"
        events      : []
        tokens_used : 0
        started_at  : now
      }
    } as $log
  }

  response = {
    work_log_id: $log.id
    run_id     : $input.run_id
    run_token  : $input.run_id
  }
}
