// DELETE /api:workforce/projects/{project_id} - permanently remove a project
// Requires confirm_name to match the project name exactly (double opt-in).
// Compare name in db.query where — avoid $*name vars and |get:"name" (Xano mis-resolves them).
query "projects/{project_id}" verb=DELETE {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    text confirm_name filters=trim
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

    precondition ($input.confirm_name != null && ($input.confirm_name|strlen) > 0) {
      error_type = "inputerror"
      error = "Project name confirmation is required."
    }

    db.query projects {
      where = $db.projects.id == $input.project_id && $db.projects.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $proj_rows

    precondition (($proj_rows|count) > 0) {
      error_type = "inputerror"
      error = "Project not found."
    }

    db.query projects {
      where = $db.projects.id == $input.project_id && $db.projects.tenant_id == $me.organisation_id && $db.projects.name == $input.confirm_name
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $match_rows

    precondition (($match_rows|count) > 0) {
      error_type = "inputerror"
      error = "Project name does not match."
    }

    db.query project_workstreams {
      where = $db.project_workstreams.project_id == $input.project_id
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $workstreams

    foreach ($workstreams.items) {
      each as $ws {
        db.del project_workstreams {
          field_name = "id"
          field_value = $ws.id
        }
      }
    }

    db.query agents {
      where = $db.agents.project_id == $input.project_id && $db.agents.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $agent_rows

    foreach ($agent_rows.items) {
      each as $agent {
        db.edit agents {
          field_name = "id"
          field_value = $agent.id
          data = {
            project_id : null
            updated_at : now
          }
        }
      }
    }

    db.del projects {
      field_name = "id"
      field_value = $input.project_id
    }
  }

  response = {
    deleted    : true
    project_id : $input.project_id
  }
}
