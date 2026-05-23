// Create a new PKB section.
// When layer == "change_queue", immediately fire a PO heartbeat run on the
// worker plane so the user gets a response within seconds instead of waiting
// for the next heartbeat tick. The PO agent is looked up by project + role.
query pkb verb=POST {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    text layer
    text content filters=trim|min:1
    text title?
    text domain?
    int priority?=5
    text change_status?
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

    db.add pkb_sections {
      data = {
        tenant_id        : $me.organisation_id
        project_id       : $input.project_id
        layer            : $input.layer
        content          : $input.content
        title            : $input.title
        domain           : $input.domain
        priority         : $input.priority|default:5
        change_status    : $input.change_status
        submitted_by_type: "user"
        submitted_by_id  : $me.id|to_text
      }
    } as $section

    conditional {
      if ($input.layer == "change_queue") {
        db.query agents {
          where = $db.agents.project_id == $input.project_id && $db.agents.role == "po"
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $po_rows

        conditional {
          if (($po_rows|count) > 0) {
            var $po {
              value = $po_rows|first
            }

            api.request {
              url = $env.WORKER_BASE_URL ~ "/agent/po/run"
              method = "POST"
              params = {
                project_id : $input.project_id
                tenant_id  : $me.organisation_id
                po_agent_id: $po.id
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
    }
  }

  response = $section
}
