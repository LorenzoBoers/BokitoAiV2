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

    var $preferences {
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

    var $result {
      value = {
        project_id  : $input.project_id
        preferences: $preferences
      }
    }
  }

  response = $result
}
