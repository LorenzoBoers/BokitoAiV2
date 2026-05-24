// POST /api:workforce/projects/{project_id}/repo/reindex - queue repo indexing
query "projects/{project_id}/repo/reindex" verb=POST {
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

    precondition ($project.github_repo_full_name != null && ($project.github_repo_full_name|strlen) > 0) {
      error_type = "inputerror"
      error = "No repository linked to this project."
    }

    db.edit projects {
      field_name = "id"
      field_value = $input.project_id
      data = {
        repo_index_status: "queued"
        repo_index_error : null
        updated_at       : now
      }
    } as $updated

    api.request {
      url = $env.WORKER_BASE_URL ~ "/repo/reindex"
      method = "POST"
      headers = [{name: "Content-Type", value: "application/json"}, {name: "Authorization", value: "Bearer " ~ $env.WORKER_INBOUND_SECRET}]
      params = {}
      body = {
        tenant_id : $me.organisation_id
        project_id: $input.project_id
      }
    } as $worker_res
  }

  response = {ok: true, project: $updated}
}
