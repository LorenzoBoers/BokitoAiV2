// DELETE /api:workforce/projects/{project_id}/repo - disconnect repo from project
query "projects/{project_id}/repo" verb=DELETE {
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

    db.edit projects {
      field_name = "id"
      field_value = $input.project_id
      data = {
        github_connection_id   : null
        github_repo_full_name  : null
        github_default_branch  : null
        repo_source            : "none"
        repo_connected_at      : null
        repo_index_status      : null
        repo_index_error       : null
        repo_indexed_at        : null
        updated_at             : now
      }
    } as $updated
  }

  response = $updated
}
