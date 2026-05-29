// POST /api:workforce/projects/{project_id}/doc/change-requests
// User submits a change request for a project Blueprint page. On create this
// dispatches a PO heartbeat with deterministic project/workspace context.
query "projects/{project_id}/doc/change-requests" verb=POST {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    text body filters=trim|min:1
    text title?
    uuid target_page_id?
    int priority?=5
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

    db.add doc_change_requests {
      data = {
        id                 : ""|uuid
        tenant_id          : $me.organisation_id
        project_id         : $input.project_id
        target_page_id     : $input.target_page_id
        title              : $input.title
        body               : $input.body
        status             : "pending"
        priority           : $input.priority
        submitted_by_type  : "user"
        submitted_by_id    : $me.id|to_string
        linked_revision_ids: []
        created_at         : now
        updated_at         : now
      }
    } as $request

    db.query agents {
      where = $db.agents.tenant_id == $me.organisation_id && $db.agents.role == "po" && $db.agents.project_id == $input.project_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $project_po

    db.query agents {
      where = $db.agents.tenant_id == $me.organisation_id && $db.agents.role == "po"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $tenant_po

    var $po_id {
      value = ($project_po|count) > 0 ? ($project_po|first).id : (($tenant_po|count) > 0 ? ($tenant_po|first).id : null)
    }

    conditional {
      if ($po_id != null) {
        api.request {
          url = $env.WORKER_BASE_URL ~ "/agent/po/run"
          method = "POST"
          params = {
            project_id        : $input.project_id
            tenant_id         : $me.organisation_id
            po_agent_id       : $po_id
            trigger_message_id: $request.id
            blueprint_scope   : "project"
            target_page_id    : $input.target_page_id
          }
          headers = [
            "Content-Type: application/json"
            ("Authorization: Bearer " ~ $env.WORKER_INBOUND_SECRET)
          ]
          timeout = 10
        } as $dispatch_result
      }
    }
  }

  response = $request
}
