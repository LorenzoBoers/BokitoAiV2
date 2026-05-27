// GET /api:workforce/projects/{project_id}/usage/budget - portal user auth
query "projects/{project_id}/usage/budget" verb=GET {
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
        token_budget_daily : $budget_daily
        token_used_today   : $used_today
        token_used_this_hour: $used_hour
        remaining_today    : $remaining_today
        remaining_hour     : $remaining_hour
        blocked            : $blocked
      }
    }
  }

  response = $result
}
