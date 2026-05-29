// POST /api:workforce/projects/{project_id}/po-agent
// Create a dedicated PO agent for this project and link it.
query "projects/{project_id}/po-agent" verb=POST {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    text name? filters=trim
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

    var $project_name {
      value = ($project_row|get:"name")
    }

    var $project_scope {
      value = ($project_row|get:"autonomous_scope")
    }

    var $po_name {
      value = $input.name != null && ($input.name|strlen) > 0 ? $input.name : ($project_name ~ " PO")
    }

    var $po_agent_id {
      value = ""|uuid
    }

    db.add agents {
      data = {
        id            : $po_agent_id
        tenant_id     : $me.organisation_id
        project_id    : $input.project_id
        name          : $po_name
        role          : "po"
        model         : "claude-sonnet-4"
        system_prompt : "You are the Product Owner for this project. North star: " ~ $project_scope
        max_loops     : 25
        tools         : []
        is_active     : true
        updated_at    : now
      }
    } as $created_agent

    db.edit projects {
      field_name = "id"
      field_value = $input.project_id
      data = {po_agent_id: $po_agent_id, updated_at: now}
    } as $updated_project
  }

  response = {
    project_id : $input.project_id
    po_agent_id: $po_agent_id
    po_agent   : {
      id        : $created_agent.id
      name      : $created_agent.name
      slug      : null
      role      : $created_agent.role
      agent_type: "po"
      status    : "active"
    }
    setup_complete: true
  }
}
