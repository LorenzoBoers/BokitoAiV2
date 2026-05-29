// GET /api:workforce/projects/{project_id}/notifications/preferences
query "projects/{project_id}/notifications/preferences" verb=GET {
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

    db.query projects {
      where = $db.projects.id == $input.project_id && $db.projects.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 1}}
    } as $proj_rows

    precondition (($proj_rows|count) > 0) {
      error_type = "inputerror"
      error = "Project not found."
    }

    var $defaults {
      value = [
        {event_type: "decisions", channel: "desktop", enabled: true}
        {event_type: "decisions", channel: "email", enabled: true}
        {event_type: "decisions", channel: "mobile", enabled: true}
        {event_type: "updates", channel: "desktop", enabled: false}
        {event_type: "updates", channel: "email", enabled: true}
        {event_type: "updates", channel: "mobile", enabled: false}
        {event_type: "failures", channel: "desktop", enabled: true}
        {event_type: "failures", channel: "email", enabled: true}
        {event_type: "failures", channel: "mobile", enabled: true}
        {event_type: "tokens", channel: "desktop", enabled: false}
        {event_type: "tokens", channel: "email", enabled: true}
        {event_type: "tokens", channel: "mobile", enabled: false}
      ]
    }

    db.query project_notification_preferences {
      where = $db.project_notification_preferences.project_id == $input.project_id && $db.project_notification_preferences.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $existing

    conditional {
      if (($existing|count) == 0) {
        foreach ($defaults) {
          each as $row {
            db.add project_notification_preferences {
              data = {
                id        : ""|uuid
                tenant_id : $me.organisation_id
                project_id: $input.project_id
                event_type: $row.event_type
                channel   : $row.channel
                enabled   : $row.enabled
                created_at: now
                updated_at: now
              }
            }
          }
        }

        db.query project_notification_preferences {
          where = $db.project_notification_preferences.project_id == $input.project_id && $db.project_notification_preferences.tenant_id == $me.organisation_id
          return = {type: "list", paging: {page: 1, per_page: 200}}
        } as $existing
      }
    }

    var $preferences {
      value = $existing
    }

    var $result {
      value = {
        project_id  : $input.project_id
        preferences: $preferences
      }
    }
  }

  response = $result
}
