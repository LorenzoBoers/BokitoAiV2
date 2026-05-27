// Scheduled task: dispatch PO runs for projects due per orchestration config
task po_heartbeat_dispatcher {
  description = "Dispatch PO heartbeat when project_orchestration_config.continuous_enabled and next_po_wake_at <= now"

  stack {
    db.query project_orchestration_config {
      where = $db.project_orchestration_config.continuous_enabled == true && $db.project_orchestration_config.next_po_wake_at <= now
      return = {type: "list", paging: {page: 1, per_page: 100}}
    } as $due_configs

    foreach ($due_configs.items) {
      each as $cfg {
        db.query projects {
          where = $db.projects.id == $cfg.project_id
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $proj_rows

        conditional {
          if (($proj_rows|count) > 0) {
            var $proj {
              value = $proj_rows|first
            }

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

                var $next_wake {
                  value = now|add_hours_to_timestamp:24
                }

                conditional {
                  if ($cfg.wake_cadence == "hourly") {
                    var.update $next_wake {
                      value = now|add_hours_to_timestamp:1
                    }
                  }
                  elseif ($cfg.wake_cadence == "weekly") {
                    var.update $next_wake {
                      value = now|add_hours_to_timestamp:168
                    }
                  }
                  elseif ($cfg.wake_cadence == "manual") {
                    var.update $next_wake {
                      value = null
                    }
                  }
                }

                db.edit project_orchestration_config {
                  field_name = "id"
                  field_value = $cfg.id
                  data = {
                    last_po_wake_at: now
                    next_po_wake_at  : $next_wake
                    updated_at       : now
                  }
                } as $cfg_updated
              }
            }
          }
        }
      }
    }
  }

  schedule = [{starts_on: 2026-05-23 12:00:00+0000, freq: 3600}]

  history = "inherit"
}
