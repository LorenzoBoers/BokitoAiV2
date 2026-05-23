// POST /api:workforce/runs/context - worker body auth
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

    db.query pkb_sections {
      where = $db.pkb_sections.project_id == $input.project_id && $db.pkb_sections.layer == "change_queue" && $db.pkb_sections.change_status == "pending"
      sort = {pkb_sections.priority: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 5}}
    } as $queue_rows

    var $first_queue {
      value = ($queue_rows|count) > 0 ? ($queue_rows|first) : null
    }

    var $result {
      value = {
        agent_name   : $agent.name
        model        : $agent.model
        system_prompt: $agent.system_prompt
        max_loops    : $agent.max_loops
        tools        : $agent.tools
        report_to_id : $project.report_to_user_id
        subject      : $first_queue != null ? $first_queue.title : "Agent run"
        body         : $first_queue != null ? $first_queue.content : ""
        thread_id    : $input.work_log_id
      }
    }
  }

  response = $result
}
