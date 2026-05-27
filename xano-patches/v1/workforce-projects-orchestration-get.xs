// GET /api:workforce/projects/{project_id}/orchestration
query "projects/{project_id}/orchestration" verb=GET {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
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
    // in this tenant yet, so we return safe defaults.
    var $cfg {
      value = {
        id                : null
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
    }
  }

  response = $cfg
}
