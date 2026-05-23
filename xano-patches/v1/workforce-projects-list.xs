// GET /api:workforce/projects - list projects for logged-in organisation
query "projects" verb=GET {
  api_group = "workforce"
  auth = "user"

  input {
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
      where = $db.projects.tenant_id == $me.organisation_id
      sort = {projects.updated_at: "desc"}
      return = {type: "list"}
    } as $rows
  }

  response = $rows
}
