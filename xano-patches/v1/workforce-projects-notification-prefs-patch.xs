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

    var $all {
      value = {
        items: $input.preferences != null ? $input.preferences : []
      }
    }

    var $result {
      value = {
        project_id  : $input.project_id
        preferences: $all.items
      }
    }
  }

  response = $result
}
