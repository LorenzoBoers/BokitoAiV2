// POST /api:workforce/pkb/worker/list - worker / run token auth.
// Returns pkb_sections rows for a project, optionally filtered by layer.
// Used by the PO agent's read_pkb tool.
query "pkb/worker/list" verb=POST {
  api_group = "workforce"

  input {
    text worker_api_key?
    text auth_token?
    uuid project_id
    text layer?
  }

  stack {
    var $worker_ok {
      value = $input.worker_api_key != null && ($input.worker_api_key|strlen) > 0 && $input.worker_api_key == $env.XANO_WORKER_API_KEY
    }

    var $run_ok {
      value = $input.auth_token != null && ($input.auth_token|strlen) > 0
    }

    precondition ($worker_ok || $run_ok) {
      error_type = "accessdenied"
      error = "Unauthorized."
    }

    db.query pkb_sections {
      where = $db.pkb_sections.project_id == $input.project_id && $db.pkb_sections.layer ==? $input.layer
      sort = {pkb_sections.priority: "asc", pkb_sections.updated_at: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 50}}
    } as $rows
  }

  response = $rows
}
