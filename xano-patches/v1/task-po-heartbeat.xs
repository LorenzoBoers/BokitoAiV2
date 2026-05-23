// Scheduled task: dispatch PO heartbeat runs to worker plane
task po_heartbeat_dispatcher {
  description = "Every 60 minutes POST worker /agent/po/run for autonomous projects with a PO agent"

  stack {
    db.query projects {
      where = $db.projects.autonomous_mode == true
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $active_projects

    foreach ($active_projects.items) {
      each as $proj {
        db.query agents {
          where = $db.agents.project_id == $proj.id && $db.agents.role == "po"
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
                project_id : $proj.id
                tenant_id  : $proj.tenant_id
                po_agent_id: $po.id
              }
              headers = [
                "Content-Type: application/json"
                ("Authorization: Bearer " ~ $env.WORKER_INBOUND_SECRET)
              ]
              timeout = 120
            } as $dispatch_result
          }
        }
      }
    }
  }

  schedule = [{starts_on: 2026-05-23 12:00:00+0000, freq: 3600}]

  history = "inherit"
}
