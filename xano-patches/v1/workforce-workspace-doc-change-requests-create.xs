// POST /api:workforce/workspace/doc/change-requests
// User submits a change request for a project doc. Replaces the legacy
// pkb_sections.layer = change_queue write. On create, fires a PO heartbeat
// run on the worker plane so the user gets fast feedback.
query "workspace/doc/change-requests" verb=POST {
  api_group = "workforce"
  auth = "user"

  input {
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

    db.query workspace_docs {
      where = $db.workspace_docs.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $doc_rows

    precondition (($doc_rows|count) > 0) {
      error_type = "inputerror"
      error = "Workspace doc not found. GET /workspace/doc first."
    }

    var $workspace_doc_id {
      value = ($doc_rows|first)|get:"id"
    }

    db.add workspace_doc_change_requests {
      data = {
        id                 : ""|uuid
        tenant_id          : $me.organisation_id
        workspace_doc_id: $workspace_doc_id
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
      where = $db.agents.tenant_id == $me.organisation_id && $db.agents.role == "po"
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $tenant_po

    var $po_id {
      value = ($tenant_po.items|count) > 0 ? ($tenant_po.items|first).id : null
    }

    conditional {
      if ($po_id != null) {
        api.request {
          url = $env.WORKER_BASE_URL ~ "/agent/po/run"
          method = "POST"
          params = {
            tenant_id  : $me.organisation_id
            po_agent_id: $po_id
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
