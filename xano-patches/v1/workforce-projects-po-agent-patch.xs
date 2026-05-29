// PATCH /api:workforce/projects/{project_id}/po-agent
// Link an existing PO-type agent to a project (exclusive: one PO per project).
query "projects/{project_id}/po-agent" verb=PATCH {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    uuid po_agent_id
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

    var $current_po_id {
      value = ($project_row|get:"po_agent_id")
    }

    db.query agents {
      where = $db.agents.id == $input.po_agent_id && $db.agents.tenant_id == $me.organisation_id && $db.agents.role == "po"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $agent_rows

    precondition (($agent_rows|count) > 0) {
      error_type = "inputerror"
      error = "PO agent not found or agent is not of type PO."
    }

    var $agent_row {
      value = $agent_rows|first
    }

    var $agent_project_id {
      value = ($agent_row|get:"project_id")
    }

    precondition ($agent_project_id == null || $agent_project_id == $input.project_id) {
      error_type = "inputerror"
      error = "This PO agent is already assigned to another project."
    }

    db.query projects {
      where = $db.projects.po_agent_id == $input.po_agent_id && $db.projects.id != $input.project_id && $db.projects.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $other_project_rows

    precondition (($other_project_rows|count) == 0) {
      error_type = "inputerror"
      error = "This PO agent is already linked to another project."
    }

    conditional {
      if ($current_po_id != null && $current_po_id != $input.po_agent_id) {
        db.edit agents {
          field_name = "id"
          field_value = $current_po_id
          data = {is_active: false, updated_at: now}
        }
      }
    }

    db.edit projects {
      field_name = "id"
      field_value = $input.project_id
      data = {po_agent_id: $input.po_agent_id, updated_at: now}
    } as $updated_project

    db.edit agents {
      field_name = "id"
      field_value = $input.po_agent_id
      data = {project_id: $input.project_id, is_active: true, updated_at: now}
    } as $agent_updated
  }

  response = {
    project_id     : $input.project_id
    po_agent_id    : $input.po_agent_id
    setup_complete : true
    po_agent       : {
      id        : $agent_row.id
      name      : $agent_row.name
      slug      : null
      role      : $agent_row.role
      agent_type: "po"
      status    : "active"
    }
  }
}
