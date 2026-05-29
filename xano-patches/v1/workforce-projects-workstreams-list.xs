// GET /api:workforce/projects/{project_id}/workstreams
// Returns workstreams for a project and the linked PO agent (role=po).
// Seeds three default workstreams when none exist yet.
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
      value = $stream_rows.items
    }

    conditional {
      if (($stream_items|count) == 0) {
        var $defaults {
          value = [
            {
              slug         : "request-fulfilment"
              name         : "Request fulfilment"
              status       : "active"
              trigger_text : "PO invokes stream from change request"
              output_text  : "PO receives status report and next actions"
              position     : 0
              steps        : [
                {
                  id           : "intake"
                  name         : "Intake"
                  role_label   : "PO agent"
                  instruction  : "Parse request scope and create an execution brief for delivery steps."
                  tool_keys    : ["outlook", "gmail"]
                }
                {
                  id           : "implementation"
                  name         : "Implementation"
                  role_label   : "Builder agent"
                  instruction  : "Execute task and pass implementation notes to review."
                  tool_keys    : ["github", "mcp"]
                }
                {
                  id           : "report"
                  name         : "Review and report"
                  role_label   : "Communication agent"
                  instruction  : "Generate stakeholder-ready update and push summary back to PO."
                  tool_keys    : ["outlook", "mcp"]
                }
              ]
            }
            {
              slug         : "bugfix-triage"
              name         : "Bugfix triage"
              status       : "draft"
              trigger_text : "PO invokes stream from bug intake"
              output_text  : "Prioritised bugfix report to PO"
              position     : 1
              steps        : [
                {
                  id           : "classify"
                  name         : "Classify issue"
                  role_label   : "Communication agent"
                  instruction  : "Classify severity, reproduce context, and draft a triage record."
                  tool_keys    : ["outlook", "mcp"]
                }
                {
                  id           : "propose"
                  name         : "Propose fix path"
                  role_label   : "PO agent"
                  instruction  : "Choose implementation lane and assign target builder profile."
                  tool_keys    : ["mcp"]
                }
                {
                  id           : "handoff"
                  name         : "Handoff"
                  role_label   : "Builder agent"
                  instruction  : "Convert approved triage into concrete execution tasks."
                  tool_keys    : ["github"]
                }
              ]
            }
            {
              slug         : "feature-delivery"
              name         : "Feature delivery"
              status       : "paused"
              trigger_text : "PO invokes stream from roadmap item"
              output_text  : "Release summary and blueprint sync"
              position     : 2
              steps        : [
                {
                  id           : "scope"
                  name         : "Scope"
                  role_label   : "PO agent"
                  instruction  : "Break feature down into milestones and acceptance checks."
                  tool_keys    : ["mcp"]
                }
                {
                  id           : "build"
                  name         : "Build"
                  role_label   : "Builder agent"
                  instruction  : "Implement approved milestones and collect implementation artifacts."
                  tool_keys    : ["github", "mcp"]
                }
                {
                  id           : "sync"
                  name         : "Blueprint sync"
                  role_label   : "Communication agent"
                  instruction  : "Publish implementation summary and blueprint deltas for project communication."
                  tool_keys    : ["outlook", "gmail"]
                }
              ]
            }
          ]
        }

        foreach ($defaults) {
          each as $def {
            db.add project_workstreams {
              data = {
                id            : ""|uuid
                tenant_id     : $me.organisation_id
                project_id    : $input.project_id
                name          : $def.name
                slug          : $def.slug
                status        : $def.status
                trigger_text  : $def.trigger_text
                output_text   : $def.output_text
                steps         : $def.steps
                position      : $def.position
                last_active_at: null
                created_at    : now
                updated_at    : now
              }
            }
          }
        }

        db.query project_workstreams {
          where = $db.project_workstreams.project_id == $input.project_id && $db.project_workstreams.tenant_id == $me.organisation_id
          sort = {project_workstreams.position: "asc"}
          return = {type: "list", paging: {page: 1, per_page: 100}}
        } as $stream_rows

        var.update $stream_items {
          value = $stream_rows.items
        }
      }
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
            slug      : $po_agent_row|get:"slug"
            role      : $po_agent_row|get:"role"
            agent_type: "po"
            status    : $po_agent_row|get:"status"
          }
        }
      }
    }
  }

  response = {items: $stream_items, po_agent: $po_payload}
}
