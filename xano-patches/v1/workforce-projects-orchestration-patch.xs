// PATCH /api:workforce/projects/{project_id}/orchestration
query "projects/{project_id}/orchestration" verb=PATCH {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    enum wake_cadence? {
      values = ["hourly", "daily", "weekly", "manual"]
    }
    enum autonomy_mode? {
      values = ["conservative", "balanced", "aggressive"]
    }
    enum hitl_sensitivity? {
      values = ["low", "medium", "high", "all"]
    }
    bool continuous_enabled?
  }

  stack {
    db.get user {
      field_name = "id"
      field_value = $auth.id
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

    db.query project_orchestration_config {
      where = $db.project_orchestration_config.project_id == $input.project_id && $db.project_orchestration_config.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $cfg_rows

    var $cfg {
      value = null
    }

    conditional {
      if (($cfg_rows|count) == 0) {
        db.add project_orchestration_config {
          data = {
            id                : ""|uuid
            tenant_id         : $me.organisation_id
            project_id        : $input.project_id
            wake_cadence      : "daily"
            autonomy_mode     : "balanced"
            hitl_sensitivity  : "medium"
            continuous_enabled: true
            next_po_wake_at   : now
            last_po_wake_at   : null
            created_at        : now
            updated_at        : now
          }
        } as $cfg_created

        var.update $cfg {
          value = $cfg_created
        }
      }
      else {
        var.update $cfg {
          value = $cfg_rows|first
        }
      }
    }

    var $next_wake {
      value = $cfg.next_po_wake_at
    }

    conditional {
      if ($input.wake_cadence != null) {
        conditional {
          if ($input.wake_cadence == "manual") {
            var.update $next_wake {
              value = null
            }
          }
          else {
            var.update $next_wake {
              value = now
            }
          }
        }
      }
    }

    db.edit project_orchestration_config {
      field_name = "id"
      field_value = $cfg.id
      data = {
        wake_cadence      : $input.wake_cadence != null ? $input.wake_cadence : $cfg.wake_cadence
        autonomy_mode     : $input.autonomy_mode != null ? $input.autonomy_mode : $cfg.autonomy_mode
        hitl_sensitivity  : $input.hitl_sensitivity != null ? $input.hitl_sensitivity : $cfg.hitl_sensitivity
        continuous_enabled: $input.continuous_enabled != null ? $input.continuous_enabled : $cfg.continuous_enabled
        next_po_wake_at   : $next_wake
        updated_at        : now
      }
    } as $updated
  }

  response = $updated
}
