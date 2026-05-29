// POST /api:workforce/runs/context - worker body auth.
// Returns the agent config + project context the runner needs to assemble
// RUN_CONFIG_JSON. Includes project_name + autonomous_scope and the highest
// priority pending Blueprint change request for deterministic PO planning.
query "runs/context" verb=POST {
  api_group = "workforce"

  input {
    text worker_api_key
    uuid project_id
    uuid agent_id
    uuid work_log_id?
  }

  stack {
    precondition ($input.worker_api_key == $env.XANO_WORKER_API_KEY) {
      error_type = "accessdenied"
      error = "Unauthorized worker."
    }

    db.query agents {
      where = $db.agents.id == $input.agent_id && $db.agents.project_id == $input.project_id
      return = {type: "list"}
    } as $agent_rows

    precondition (($agent_rows|count) > 0) {
      error_type = "inputerror"
      error = "Agent not found."
    }

    var $agent {
      value = $agent_rows|first
    }

    db.query projects {
      where = $db.projects.id == $input.project_id
      return = {type: "list"}
    } as $proj_rows

    var $project {
      value = ($proj_rows|count) > 0 ? ($proj_rows|first) : null
    }

    db.query doc_change_requests {
      where = $db.doc_change_requests.project_id == $input.project_id && ($db.doc_change_requests.status == "pending" || $db.doc_change_requests.status == "in_progress")
      sort = {doc_change_requests.priority: "asc", doc_change_requests.created_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $queue_rows

    var $first_queue {
      value = ($queue_rows|count) > 0 ? ($queue_rows|first) : null
    }

    var $result {
      value = {
        agent_id                : $input.agent_id
        agent_name              : $agent.name
        model                   : $agent.model
        system_prompt           : $agent.system_prompt
        max_loops               : $agent.max_loops
        tools                   : $agent.tools
        report_to_id            : $project.report_to_user_id
        project_id              : $input.project_id
        project_name            : $project != null ? $project.name : ""
        project_autonomous_scope: $project != null ? $project.autonomous_scope : ""
        tenant_id               : $project != null ? $project.tenant_id : null
        subject                 : $first_queue != null ? ($first_queue.title != null ? $first_queue.title : "Blueprint change request") : "Agent run"
        body                    : $first_queue != null ? ($first_queue.body != null ? $first_queue.body : "") : ""
        blueprint_change_request_id: $first_queue != null ? $first_queue.id : null
        blueprint_change_scope  : $first_queue != null ? "project" : null
        blueprint_target_page_id: $first_queue != null ? $first_queue.target_page_id : null
        thread_id               : $input.work_log_id
      }
    }
  }

  response = $result
}
