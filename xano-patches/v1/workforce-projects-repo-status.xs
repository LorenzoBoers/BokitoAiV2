// GET /api:workforce/projects/{project_id}/repo/status
query "projects/{project_id}/repo/status" verb=GET {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
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

    db.query projects {
      where = $db.projects.id == $input.project_id && $db.projects.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $proj_rows

    precondition (($proj_rows|count) > 0) {
      error_type = "inputerror"
      error = "Project not found."
    }

    var $project {
      value = $proj_rows|first
    }
  }

  response = {
    github_repo_full_name: $project.github_repo_full_name
    github_default_branch: $project.github_default_branch
    repo_index_status    : $project.repo_index_status
    repo_index_error     : $project.repo_index_error
    repo_indexed_at      : $project.repo_indexed_at
  }
}
