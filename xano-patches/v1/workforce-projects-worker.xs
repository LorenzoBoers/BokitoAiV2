// POST /api:workforce/projects/worker - worker-only project upsert for bootstrap seeding
query "projects/worker" verb=POST {
  api_group = "workforce"

  input {
    text worker_api_key
    uuid project_id
    uuid tenant_id
    text name
    text slug
    text autonomous_scope
  }

  stack {
    precondition ($input.worker_api_key == $env.XANO_WORKER_API_KEY) {
      error_type = "accessdenied"
      error = "Unauthorized worker."
    }

    db.query projects {
      where = $db.projects.id == $input.project_id
      return = {type: "list"}
    } as $existing_rows

    conditional {
      if (($existing_rows|count) > 0) {
        var $existing {
          value = $existing_rows|first
        }
      }

      else {
        db.add projects {
          data = {
            id              : $input.project_id
            tenant_id       : $input.tenant_id
            name            : $input.name
            slug            : $input.slug
            description     : ""
            autonomous_scope: $input.autonomous_scope
            autonomous_mode : true
            active_domains  : []
            token_budget_daily: 100000
            token_used_today: 0
            token_used_this_hour: 0
            cron_interval_minutes: 60
          }
        } as $existing
      }
    }
  }

  response = $existing
}
