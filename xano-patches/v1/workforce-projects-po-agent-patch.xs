// PATCH /api:workforce/projects/{project_id}/po-agent
// Link a PO-type agent to a project.
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

    db.query agents {
      where = $db.agents.id == $input.po_agent_id && $db.agents.tenant_id == $me.organisation_id && $db.agents.role == "po"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $agent_rows

    precondition (($agent_rows|count) > 0) {
      error_type = "inputerror"
      error = "PO agent not found or agent is not of type PO."
    }

    var $agent {
      value = $agent_rows|first
    }

    db.edit projects {
      field_name = "id"
      field_value = $input.project_id
      data = {po_agent_id: $input.po_agent_id, updated_at: now}
    } as $project

    db.edit agents {
      field_name = "id"
      field_value = $input.po_agent_id
      data = {project_id: $input.project_id, updated_at: now}
    } as $agent_updated
  }

  response = {
    project_id : $input.project_id
    po_agent_id: $input.po_agent_id
    po_agent   : {
      id        : $agent.id
      name      : $agent.name
      slug      : $agent.slug
      role      : $agent.role
      agent_type: "po"
      status    : $agent.status
    }
  }
}
