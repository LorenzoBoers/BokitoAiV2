// GET /api:workforce/projects/{project_id}/workstreams
// Returns workstreams for a project and the linked PO agent (role=po).
query "projects/{project_id}/workstreams" verb=GET {
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

    var $proj_row {
      value = $proj_rows|first
    }

    var $linked_po_agent_id {
      value = $proj_row|get:"po_agent_id"
    }

    db.query project_workstreams {
      where = $db.project_workstreams.project_id == $input.project_id && $db.project_workstreams.tenant_id == $me.organisation_id
      sort = {project_workstreams.position: "asc"}
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $stream_rows

    var $stream_items {
      value = ($stream_rows|get:"items") != null ? ($stream_rows|get:"items") : []
    }

    var $po_agent_row {
      value = null
    }

    conditional {
      if ($linked_po_agent_id != null) {
        db.query agents {
          where = $db.agents.id == $linked_po_agent_id && $db.agents.tenant_id == $me.organisation_id && $db.agents.role == "po"
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $po_by_id_rows

        conditional {
          if (($po_by_id_rows|count) > 0) {
            var.update $po_agent_row {
              value = $po_by_id_rows|first
            }
          }
        }
      }
    }

    conditional {
      if ($po_agent_row == null) {
        db.query agents {
          where = $db.agents.project_id == $input.project_id && $db.agents.tenant_id == $me.organisation_id && $db.agents.role == "po"
          sort = {agents.updated_at: "desc"}
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $po_by_project_rows

        conditional {
          if (($po_by_project_rows|count) > 0) {
            var.update $po_agent_row {
              value = $po_by_project_rows|first
            }
          }
        }
      }
    }

    var $po_payload {
      value = null
    }

    var $po_agent_id {
      value = null
    }

    conditional {
      if ($po_agent_row != null) {
        var.update $po_agent_id {
          value = $po_agent_row|get:"id"
        }
      }
    }

    conditional {
      if ($po_agent_id != null) {
        var.update $po_payload {
          value = {
            id        : $po_agent_id
            name      : $po_agent_row|get:"name"
            slug      : null
            role      : $po_agent_row|get:"role"
            agent_type: "po"
            status    : ($po_agent_row|get:"is_active") == true ? "active" : "standby"
          }
        }
      }
    }
  }

  response = {items: $stream_items, po_agent: $po_payload}
}
