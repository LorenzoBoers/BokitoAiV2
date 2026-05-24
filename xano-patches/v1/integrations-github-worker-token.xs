// POST /api:integrations/github/worker/token - worker-only fetch token for project repo
query "github/worker/token" verb=POST {
  api_group = "integrations"
  auth = "false"

  input {
    uuid tenant_id
    uuid project_id
    text worker_secret filters=trim
  }

  stack {
    precondition ($input.worker_secret == $env.WORKER_INBOUND_SECRET) {
      error_type = "accessdenied"
      error = "Invalid worker secret."
    }

    db.query projects {
      where = $db.projects.id == $input.project_id && $db.projects.tenant_id == $input.tenant_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $proj_rows

    precondition (($proj_rows|count) > 0) {
      error_type = "inputerror"
      error = "Project not found."
    }

    var $project {
      value = $proj_rows|first
    }

    precondition ($project.github_connection_id != null) {
      error_type = "inputerror"
      error = "Project has no GitHub connection."
    }

    db.get github_connections {
      field_name = "id"
      field_value = $project.github_connection_id
    } as $conn

    precondition ($conn != null && $conn.status == "active") {
      error_type = "inputerror"
      error = "GitHub connection inactive."
    }
  }

  response = {
    access_token         : $conn.access_token
    github_repo_full_name: $project.github_repo_full_name
    github_default_branch: $project.github_default_branch
  }
}
