// DELETE /api:workforce/projects/{project_id}/po-agent
// Clears the explicit PO link on the project. The agent row remains on the project.
query "projects/{project_id}/po-agent" verb=DELETE {
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

    var $project_row {
      value = $proj_rows|first
    }

    var $previous_po_id {
      value = ($project_row|get:"po_agent_id")
    }

    db.edit projects {
      field_name = "id"
      field_value = $input.project_id
      data = {po_agent_id: null, updated_at: now}
    } as $updated_project

    conditional {
      if ($previous_po_id != null) {
        db.edit agents {
          field_name = "id"
          field_value = $previous_po_id
          data = {is_active: false, updated_at: now}
        }
      }
    }
  }

  response = {
    project_id     : $input.project_id
    unlinked       : true
    setup_complete : false
  }
}
