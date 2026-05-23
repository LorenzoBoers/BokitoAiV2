// GET /api:workforce/projects/{project_id}/budget - worker query auth
query "projects/{project_id}/budget" verb=GET {
  api_group = "workforce"

  input {
    text worker_api_key
    uuid project_id
  }

  stack {
    precondition ($input.worker_api_key == $env.XANO_WORKER_API_KEY) {
      error_type = "accessdenied"
      error = "Unauthorized worker."
    }

    db.query projects {
      where = $db.projects.id == $input.project_id
      return = {type: "list"}
    } as $rows

    precondition (($rows|count) > 0) {
      error_type = "inputerror"
      error = "Project not found."
    }

    var $project {
      value = $rows|first
    }

    var $budget_daily {
      value = $project.token_budget_daily != null ? $project.token_budget_daily : 100000
    }

    var $used_today {
      value = $project.token_used_today != null ? $project.token_used_today : 0
    }

    var $used_hour {
      value = $project.token_used_this_hour != null ? $project.token_used_this_hour : 0
    }

    var $remaining_today_raw {
      value = $budget_daily - $used_today
    }

    var $remaining_hour_raw {
      value = 50000 - $used_hour
    }

    var $remaining_today {
      value = $remaining_today_raw > 0 ? $remaining_today_raw : 0
    }

    var $remaining_hour {
      value = $remaining_hour_raw > 0 ? $remaining_hour_raw : 0
    }

    var $blocked {
      value = $remaining_today_raw <= 0 || $remaining_hour_raw <= 0
    }

    var $result {
      value = {
        remaining_today: $remaining_today
        remaining_hour : $remaining_hour
        blocked        : $blocked
      }
    }
  }

  response = $result
}
