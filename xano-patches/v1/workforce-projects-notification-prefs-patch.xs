// PATCH /api:workforce/projects/{project_id}/notifications/preferences
query "projects/{project_id}/notifications/preferences" verb=PATCH {
  api_group = "workforce"
  auth = "user"

  input {
    uuid project_id
    json preferences
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

    var $items {
      value = $input.preferences != null ? $input.preferences : []
    }

    foreach ($items) {
      each as $pref {
        db.query project_notification_preferences {
          where = $db.project_notification_preferences.project_id == $input.project_id &&
            $db.project_notification_preferences.tenant_id == $me.organisation_id &&
            $db.project_notification_preferences.event_type == $pref.event_type &&
            $db.project_notification_preferences.channel == $pref.channel
          return = {type: "list", paging: {page: 1, per_page: 1}}
        } as $existing_row

        conditional {
          if (($existing_row|count) > 0) {
            db.edit project_notification_preferences {
              field_name = "id"
              field_value = ($existing_row|first).id
              data = {
                enabled: $pref.enabled == true
                updated_at: now
              }
            }
          }
          else {
            db.add project_notification_preferences {
              data = {
                id        : ""|uuid
                tenant_id : $me.organisation_id
                project_id: $input.project_id
                event_type: $pref.event_type
                channel   : $pref.channel
                enabled   : $pref.enabled == true
                created_at: now
                updated_at: now
              }
            }
          }
        }
      }
    }

    db.query project_notification_preferences {
      where = $db.project_notification_preferences.project_id == $input.project_id && $db.project_notification_preferences.tenant_id == $me.organisation_id
      return = {type: "list", paging: {page: 1, per_page: 200}}
    } as $saved_rows

    var $result {
      value = {
        project_id  : $input.project_id
        preferences: $saved_rows
      }
    }
  }

  response = $result
}
