// GET /api:workforce/projects/{project_id}/usage/summary?period=7d|30d|90d
query "projects/{project_id}/usage/summary" verb=GET {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    text period?
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

    var $project {
      value = $proj_rows|first
    }

    var $period_label {
      value = $input.period != null ? $input.period : "30d"
    }

    var $hours_back {
      value = $period_label == "7d" ? 168 : ($period_label == "90d" ? 2160 : 720)
    }

    var $since {
      value = now|add_hours_to_timestamp:(0 - $hours_back)
    }

    db.query work_logs {
      where = $db.work_logs.project_id == $input.project_id && $db.work_logs.tenant_id == $me.organisation_id && $db.work_logs.started_at >= $since
      return = {type: "list", paging: {page: 1, per_page: 500}}
    } as $logs

    var $total_runs {
      value = $logs|count
    }

    var $completed {
      value = 0
    }

    var $running {
      value = 0
    }

    var $failed {
      value = 0
    }

    var $tokens {
      value = 0
    }

    foreach ($logs.items) {
      each as $log {
        conditional {
          if ($log.status == "completed") {
            var.update $completed {
              value = $completed + 1
            }
          }
          elseif ($log.status == "running") {
            var.update $running {
              value = $running + 1
            }
          }
          elseif ($log.status == "failed") {
            var.update $failed {
              value = $failed + 1
            }
          }
        }

        var $tu {
          value = $log.tokens_used != null ? $log.tokens_used : 0
        }

        var.update $tokens {
          value = $tokens + $tu
        }
      }
    }

    var $budget_daily {
      value = $project.token_budget_daily != null ? $project.token_budget_daily : 100000
    }

    var $used_today {
      value = $project.token_used_today != null ? $project.token_used_today : 0
    }

    var $remaining_raw {
      value = $budget_daily - $used_today
    }

    var $remaining {
      value = $remaining_raw > 0 ? $remaining_raw : 0
    }

    var $result {
      value = {
        project_id            : $input.project_id
        period                : {start: $since, end: now, label: $period_label}
        total_runs            : $total_runs
        completed_runs        : $completed
        running_runs          : $running
        failed_runs           : $failed
        tokens_used           : $tokens
        tokens_used_today     : $used_today
        tokens_remaining_today: $remaining
      }
    }
  }

  response = $result
}
