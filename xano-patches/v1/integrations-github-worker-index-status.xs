// POST /api:integrations/github/worker/index-status - worker updates project index status
query "github/worker/index-status" verb=POST {
  api_group = "integrations"
  auth = "false"

  input {
    uuid tenant_id
    uuid project_id
    text worker_secret filters=trim
    text status filters=trim
    text error? filters=trim
    int chunk_count?
    text repo_last_commit_sha? filters=trim
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

    var $indexed_at {
      value = $input.status == "ready" ? now : null
    }

    db.edit projects {
      field_name = "id"
      field_value = $input.project_id
      data = {
        repo_index_status   : $input.status
        repo_index_error    : $input.error
        repo_indexed_at     : $indexed_at
        repo_last_commit_sha: $input.repo_last_commit_sha
        updated_at          : now
      }
    } as $updated
  }

  response = {ok: true, project: $updated}
}
