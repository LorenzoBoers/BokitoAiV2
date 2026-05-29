// DELETE /api:workforce/projects/{project_id} - permanently remove a project
// Requires confirm_name to match the project name exactly (double opt-in).
query "projects/{project_id}" verb=DELETE {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    text confirm_name
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

    var $project {
      value = $proj_rows|first
    }

    precondition ($project.name == $input.confirm_name) {
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

    db.query project_orchestration_config {
      where = $db.project_orchestration_config.project_id == $input.project_id && $db.project_orchestration_config.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 10}}
    } as $orch_rows

    foreach ($orch_rows.items) {
      each as $orch {
        db.del project_orchestration_config {
          field_name = "id"
          field_value = $orch.id
        }
      }
    }

    db.query project_notification_preferences {
      where = $db.project_notification_preferences.project_id == $input.project_id && $db.project_notification_preferences.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $pref_rows

    foreach ($pref_rows.items) {
      each as $pref {
        db.del project_notification_preferences {
          field_name = "id"
          field_value = $pref.id
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
