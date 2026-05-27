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

    // Temporary fallback: table-backed orchestration config is not available
    // in this tenant yet, so patch returns an updated in-memory payload.
    var $cfg {
      value = {
        wake_cadence      : "daily"
        autonomy_mode     : "balanced"
        hitl_sensitivity  : "medium"
        continuous_enabled: true
        next_po_wake_at   : now
      }
    }

    var $updated {
      value = {
        id                : null
        tenant_id         : $me.organisation_id
        project_id        : $input.project_id
        wake_cadence      : $input.wake_cadence != null ? $input.wake_cadence : $cfg.wake_cadence
        autonomy_mode     : $input.autonomy_mode != null ? $input.autonomy_mode : $cfg.autonomy_mode
        hitl_sensitivity  : $input.hitl_sensitivity != null ? $input.hitl_sensitivity : $cfg.hitl_sensitivity
        continuous_enabled: $input.continuous_enabled != null ? $input.continuous_enabled : $cfg.continuous_enabled
        next_po_wake_at   : ($input.wake_cadence == "manual" ? null : now)
        last_po_wake_at   : null
        created_at        : now
        updated_at        : now
      }
    }
  }

  response = $updated
}
